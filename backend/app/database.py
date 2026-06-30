"""
SQLAlchemy 引擎 + Session 管理。
- 生产：Postgres（DATABASE_URL）
- 测试：sqlite（TEST_DATABASE_URL，可被 conftest 覆盖）
- 异步用 aiosqlite（测试用），生产用 psycopg2 同步驱动即可（FastAPI 同步 ORM 也够用）
"""
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker, Session
from typing import Generator

from .config import settings


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


def init_db():
    """创建所有表（开发用，生产用 Alembic 迁移）"""
    # 确保模型被注册
    from . import models  # noqa: F401
    Base.metadata.create_all(bind=engine)


def reset_for_tests():
    """测试用：drop 所有表 + 重建"""
    from . import models  # noqa: F401
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)