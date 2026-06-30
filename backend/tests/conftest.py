"""
Pytest 配置：
- 用 sqlite 内存数据库（每个测试全新）
- 用 LocalStorage（/tmp）替代 S3
- 用 monkeypatch 注入环境变量
- 提供 fixture: client (FastAPI TestClient), db, storage
- **关键**：monkeypatch lifespan 内的 init_db 和 storage 初始化，
  避免它们覆盖 conftest 已注入的 sqlite engine / LocalStorage
"""
import os
import sys
import pytest

# 确保 backend/ 在路径里
BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)


@pytest.fixture(scope="function", autouse=True)
def _set_test_env(monkeypatch, tmp_path):
    """每个测试：注入测试用环境变量，指向临时目录"""
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("TEST_DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("REDIS_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("CELERY_BROKER_URL", "redis://localhost:6379/0")
    monkeypatch.setenv("CELERY_RESULT_BACKEND", "redis://localhost:6379/1")
    monkeypatch.setenv("S3_ENDPOINT", "http://localhost:9000")
    monkeypatch.setenv("S3_BUCKET", "wordgame-test")
    monkeypatch.setenv("MAX_UPLOAD_SIZE_MB", "200")
    monkeypatch.setenv("APP_DEBUG", "true")
    # spaCy 模型如果未安装，lemma 测试会自动 fallback


@pytest.fixture(scope="function")
def db_engine():
    """每个测试一个全新的 sqlite 内存 DB（用 StaticPool 让所有连接共享同一个内存库）"""
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool
    from app.database import Base
    from app import models  # noqa: F401 触发模型注册

    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,  # 关键：所有连接共享同一个内存库
        future=True,
    )
    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture(scope="function")
def db_session(db_engine):
    """每个测试一个 Session"""
    from sqlalchemy.orm import sessionmaker
    Session = sessionmaker(bind=db_engine, autoflush=False, autocommit=False, future=True)
    session = Session()
    yield session
    session.close()


@pytest.fixture(scope="function")
def storage():
    """LocalStorage 实例（指向临时目录）"""
    from app.storage import LocalStorage
    s = LocalStorage(base_dir="/tmp/wordgame-test-storage")
    yield s
    import shutil
    if os.path.exists("/tmp/wordgame-test-storage"):
        shutil.rmtree("/tmp/wordgame-test-storage", ignore_errors=True)


@pytest.fixture(scope="function")
def app(db_engine, storage, monkeypatch):
    """FastAPI app 实例，DB + storage 已注入；lifespan 内的副作用被禁用"""
    # 1. 替换全局 engine（必须在 lifespan 之前）
    from sqlalchemy.orm import sessionmaker
    import app.database as db_module
    db_module.engine = db_engine
    TestSession = sessionmaker(bind=db_engine, autoflush=False, autocommit=False, future=True)
    db_module.SessionLocal = TestSession

    # 1.5 worker 模块也是 import SessionLocal 后缓存了引用，必须一并替换
    import sys
    for mod_name, mod in list(sys.modules.items()):
        if mod and mod_name.startswith("app.") and hasattr(mod, "SessionLocal"):
            mod.SessionLocal = TestSession
        if mod and mod_name.startswith("app.") and hasattr(mod, "engine"):
            mod.engine = db_engine

    # 2. 替换 init_db 为 no-op（conftest 已建好表）
    monkeypatch.setattr("app.database.init_db", lambda: None)
    monkeypatch.setattr("app.main.init_db", lambda: None)

    # 3. 注入 storage（必须在 lifespan 之前）
    from app.storage import init_storage
    init_storage(storage)

    # 4. 把 lifespan 里的 S3Storage / LocalStorage 初始化短路掉
    #    避免 lifespan 重新连接 S3 或创建新 LocalStorage 覆盖 conftest 的
    monkeypatch.setattr("app.main.S3Storage", lambda **kw: storage)
    monkeypatch.setattr("app.main.LocalStorage", lambda *a, **kw: storage)
    # 也 patch lifespan 内的 init_storage 调用（直接 no-op）
    # 简单做法：替换 lifespan 函数本身
    from contextlib import asynccontextmanager

    @asynccontextmanager
    async def noop_lifespan(app):
        yield  # 不做任何事

    monkeypatch.setattr("app.main.app.router.lifespan_context", noop_lifespan)

    # 5. 引入 app 并 yield
    from app.main import app as fastapi_app
    yield fastapi_app

    # teardown：还原（虽然 pytest 自动 teardown 整个进程，但保险起见）
    import app.storage as storage_module
    storage_module._storage = None


@pytest.fixture(scope="function")
def client(app):
    """FastAPI TestClient"""
    from fastapi.testclient import TestClient
    with TestClient(app) as c:
        yield c


# ==================== Auth fixtures（task #36） ====================

@pytest.fixture(scope="function")
def test_account_data():
    """测试账号数据（每测试独立，避免冲突）"""
    import secrets
    return {
        "username": f"u{secrets.token_hex(4)}",
        "password": "testpass123",
    }


@pytest.fixture(scope="function")
def auth_account(client, test_account_data):
    """注册一个测试账号 + 默认 profile，返回 (Account, dict{headers})"""
    r = client.post("/api/auth/register", json=test_account_data)
    assert r.status_code == 201, f"注册失败: {r.text}"
    data = r.json()
    token = data["token"]
    headers = {"Authorization": f"Bearer {token}"}
    return {
        "account": data["account"],
        "profile": data["profile"],
        "token": token,
        "headers": headers,
    }


@pytest.fixture(scope="function")
def auth_headers(auth_account):
    """仅返回 Authorization header"""
    return auth_account["headers"]


@pytest.fixture(scope="function")
def second_account(client):
    """第二个独立账号（用于 ownership 测试）"""
    import secrets
    data = {
        "username": f"v{secrets.token_hex(4)}",
        "password": "testpass456",
    }
    r = client.post("/api/auth/register", json=data)
    assert r.status_code == 201
    d = r.json()
    return {
        "account": d["account"],
        "profile": d["profile"],
        "token": d["token"],
        "headers": {"Authorization": f"Bearer {d['token']}"},
    }


# ==================== OCR fixtures（task #59） ====================

@pytest.fixture(scope="session")
def sample_png_path():
    """OCR fixture PNG 绝对路径（如果不存在则自动生成）"""
    import subprocess
    from pathlib import Path
    fixture = Path(__file__).parent / "fixtures" / "sample_words.png"
    if not fixture.exists():
        gen_script = Path(__file__).parent / "fixtures" / "generate_sample_image.py"
        subprocess.run([sys.executable, str(gen_script), str(fixture)], check=True)
    return str(fixture)


@pytest.fixture(scope="session")
def sample_jpg_path():
    """OCR fixture JPG 绝对路径"""
    import subprocess
    from pathlib import Path
    fixture = Path(__file__).parent / "fixtures" / "sample_words.jpg"
    if not fixture.exists():
        gen_script = Path(__file__).parent / "fixtures" / "generate_sample_image.py"
        subprocess.run([sys.executable, str(gen_script), str(fixture)], check=True)
    return str(fixture)


@pytest.fixture(scope="function")
def sample_png(sample_png_path):
    """PNG fixture 字节内容（每次都从磁盘读，避免内存缓存问题）"""
    return open(sample_png_path, 'rb').read()


@pytest.fixture(scope="function")
def sample_jpg(sample_jpg_path):
    """JPG fixture 字节内容"""
    return open(sample_jpg_path, 'rb').read()


@pytest.fixture(scope="function")
def blank_png():
    """空白图片（OCR 应返回空字符串）"""
    from io import BytesIO
    from PIL import Image
    img = Image.new('RGB', (200, 200), 'white')
    buf = BytesIO()
    img.save(buf, format='PNG')
    return buf.getvalue()