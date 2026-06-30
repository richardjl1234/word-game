"""
SQLAlchemy 引擎 + Session 管理。
- 生产：Postgres（DATABASE_URL）
- 测试：sqlite（TEST_DATABASE_URL，可被 conftest 覆盖）
- 异步用 aiosqlite（测试用），生产用 psycopg2 同步驱动即可（FastAPI 同步 ORM 也够用）
"""
import logging
from typing import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker, Session

from .config import settings

logger = logging.getLogger(__name__)


def _make_engine(url: str | None = None):
    """根据 URL 创建引擎。SQLite 需要特殊参数。"""
    target = url or settings.DATABASE_URL
    connect_args = {}
    if target.startswith("sqlite"):
        connect_args["check_same_thread"] = False
    return create_engine(target, connect_args=connect_args, future=True)


engine = _make_engine()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine, future=True)
Base = declarative_base()


def get_db() -> Generator[Session, None, None]:
    """FastAPI Depends：每个请求一个 Session，结束自动 close"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def _has_column(connection, table: str, column: str) -> bool:
    """检查表是否存在某列（兼容 SQLite + Postgres）"""
    if engine.dialect.name == "sqlite":
        rows = connection.execute(
            text(f"PRAGMA table_info({table})")
        ).fetchall()
        return any(row[1] == column for row in rows)
    else:
        rows = connection.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = :table AND column_name = :column"
            ),
            {"table": table, "column": column},
        ).fetchall()
        return len(rows) > 0


def _ensure_schema():
    """迁移：为 accounts 表新增 role / must_change_password 列（如果不存在）"""
    from . import models  # noqa: F401

    with engine.begin() as conn:
        if not _has_column(conn, "accounts", "role"):
            logger.info("迁移：accounts 表新增 role 列")
            conn.execute(text("ALTER TABLE accounts ADD COLUMN role VARCHAR DEFAULT 'user' NOT NULL"))
        if not _has_column(conn, "accounts", "must_change_password"):
            logger.info("迁移：accounts 表新增 must_change_password 列")
            conn.execute(text("ALTER TABLE accounts ADD COLUMN must_change_password BOOLEAN DEFAULT 0 NOT NULL"))


def _seed_admin():
    """首次启动时创建默认 admin 账号（仅非测试模式）"""
    from . import auth as auth_core
    from . import models  # noqa: F401

    if settings.DATABASE_URL == "sqlite:///:memory:":
        return  # 测试模式跳过

    with SessionLocal() as db:
        existing = db.query(models.Account).filter(
            models.Account.username == settings.ADMIN_USERNAME
        ).first()
        if existing:
            logger.info(f"Admin 账号 '{settings.ADMIN_USERNAME}' 已存在，跳过创建")
            return

        admin = models.Account(
            id=auth_core.gen_account_id(),
            username=settings.ADMIN_USERNAME,
            password_hash=auth_core.hash_password(settings.ADMIN_PASSWORD),
            role="admin",
            must_change_password=True,
        )
        db.add(admin)
        db.commit()
        logger.info(f"✅ Admin 账号自动创建: username='{settings.ADMIN_USERNAME}', password='{settings.ADMIN_PASSWORD}'（请修改生产密码）")


def init_db():
    """创建所有表 + schema 迁移 + seed admin（开发用，生产用 Alembic 迁移）"""
    # 确保模型被注册
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _ensure_schema()
    _seed_admin()


def reset_for_tests():
    """测试用：drop 所有表 + 重建"""
    from . import models  # noqa: F401
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)