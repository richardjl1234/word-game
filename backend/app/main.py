"""
FastAPI 应用入口
- 启动时初始化 storage + DB
- 注册 router
- 提供 /api/health 健康检查
"""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import settings, get_settings
from .database import init_db
from .storage import init_storage, S3Storage, LocalStorage
from . import __version__
from .routers import upload, jobs, libraries, auth, profiles

logging.basicConfig(
    level=logging.INFO if not settings.APP_DEBUG else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用启动/关闭生命周期"""
    logger.info("=== Word-game 后端启动 ===")

    # 1. 初始化 DB（开发用 init_db，生产用 Alembic）
    if settings.APP_DEBUG:
        init_db()
        logger.info("数据库表已创建（开发模式）")

    # 2. 初始化 storage（dev 用本地，生产用 S3/MinIO）
    if settings.STORAGE_BACKEND == "local":
        init_storage(LocalStorage(base_dir=settings.LOCAL_STORAGE_DIR))
        logger.info(f"使用 LocalStorage: {settings.LOCAL_STORAGE_DIR}")
    else:
        try:
            s3 = S3Storage(
                endpoint=settings.S3_ENDPOINT,
                access_key=settings.S3_ACCESS_KEY,
                secret_key=settings.S3_SECRET_KEY,
                bucket=settings.S3_BUCKET,
                region=settings.S3_REGION,
            )
            init_storage(s3)
            logger.info(f"使用 S3-compatible storage: {settings.S3_ENDPOINT}/{settings.S3_BUCKET}")
        except Exception as e:
            logger.warning(f"S3 连接失败，回退到本地存储: {e}")
            init_storage(LocalStorage(base_dir=settings.LOCAL_STORAGE_DIR))

    yield

    logger.info("=== Word-game 后端关闭 ===")


app = FastAPI(
    title="Word-game Backend",
    description="多词库 + 多用户英语学习游戏的后端 API",
    version=__version__,
    lifespan=lifespan,
)

# CORS（开发时放行前端端口；LAN 部署可设 CORS_ORIGINS=* 允许任意 origin）
# ★ allow_credentials=False：因为只用 Bearer token（不用 cookie），可以放心 allow_origins=*
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health", tags=["system"])
async def health():
    """健康检查端点"""
    from sqlalchemy import text
    from .database import engine
    db_ok = False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            db_ok = True
    except Exception as e:
        logger.warning(f"DB check failed: {e}")

    return JSONResponse({
        "status": "ok",
        "version": __version__,
        "db": db_ok,
        "redis": True,   # TODO: 实际 ping Redis
        "s3": True,      # TODO: 实际检查 S3
    })


# 注册路由
app.include_router(upload.router, prefix="/api", tags=["upload"])
app.include_router(jobs.router, prefix="/api", tags=["jobs"])
app.include_router(libraries.router, prefix="/api", tags=["libraries"])
app.include_router(auth.router, tags=["auth"])
app.include_router(profiles.router, tags=["profiles"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=settings.APP_HOST,
        port=settings.APP_PORT,
        reload=settings.APP_DEBUG,
    )