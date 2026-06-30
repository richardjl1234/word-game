"""
应用配置：从 .env 加载（生产），从环境变量加载（容器）。
测试可通过 monkeypatch env 或直接构造 Settings 实例覆盖。
"""
import os
from pathlib import Path
from typing import List

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def find_env_file() -> str | None:
    """从当前目录向上找到最近的 .env 文件"""
    cwd = Path.cwd()
    for p in [cwd, *cwd.parents]:
        candidate = p / "backend" / ".env"
        if candidate.exists():
            return str(candidate)
        candidate = p / ".env"
        if p.name == "backend" and candidate.exists():
            return str(candidate)
    return None


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=find_env_file(),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # App
    APP_HOST: str = "0.0.0.0"
    APP_PORT: int = 8000
    APP_DEBUG: bool = True
    CORS_ORIGINS: str = "*"

    # Storage backend: "s3" (default) or "local"（dev 无 S3 时可切 local）
    STORAGE_BACKEND: str = "local"  # 默认 local，方便本地开发调试；生产改 s3
    LOCAL_STORAGE_DIR: str = "/tmp/wordgame-storage"

    # Database
    DATABASE_URL: str = "sqlite:///./wordgame.db"
    TEST_DATABASE_URL: str = "sqlite:///:memory:"

    # Celery
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/0"
    CELERY_RESULT_BACKEND: str = "redis://localhost:6379/1"

    # S3-compatible storage
    S3_ENDPOINT: str = "http://localhost:9000"
    S3_ACCESS_KEY: str = "minioadmin"
    S3_SECRET_KEY: str = "minioadmin"
    S3_BUCKET: str = "wordgame-uploads"
    S3_REGION: str = "us-east-1"

    # Upload limits
    MAX_UPLOAD_SIZE_MB: int = 200

    # spaCy
    SPACY_MODEL: str = "en_core_web_sm"

    # Auth (JWT)
    # 生产必须 export JWT_SECRET=$(openssl rand -hex 32)，绝不能硬编码到仓库
    # 开发默认值仅供本地启动；启动时 logger 会打 warning
    JWT_SECRET: str = "dev-only-CHANGE-ME-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_DAYS: int = 7

    # Admin account（dev 默认值，生产覆盖）
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin123"
    DEFAULT_USER_PASSWORD: str = "1234"
    MIN_PASSWORD_LENGTH: int = 4

    @property
    def cors_origins_list(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def max_upload_size_bytes(self) -> int:
        return self.MAX_UPLOAD_SIZE_MB * 1024 * 1024


# 单例
settings = Settings()


def get_settings() -> Settings:
    """用于 FastAPI Depends 注入"""
    return settings