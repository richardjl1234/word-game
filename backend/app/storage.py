"""
S3-compatible 存储抽象：
- 生产：MinIO / AWS S3 / 阿里 OSS（任意 S3 兼容服务）
- 测试：本地文件系统或 moto mock

API：
- upload(key, fileobj) -> str  (返回 storage_key)
- download(key) -> bytes
- delete(key) -> bool
- presigned_url(key, expires=3600) -> str  （可选）
"""
import io
import logging
from typing import Optional

logger = logging.getLogger(__name__)


class StorageBackend:
    """抽象基类"""
    def upload(self, key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
        raise NotImplementedError

    def download(self, key: str) -> bytes:
        raise NotImplementedError

    def delete(self, key: str) -> bool:
        raise NotImplementedError

    def exists(self, key: str) -> bool:
        raise NotImplementedError


class LocalStorage(StorageBackend):
    """本地文件系统实现，用于测试 / 无 S3 场景"""
    def __init__(self, base_dir: str = "/tmp/wordgame-storage"):
        import os
        self.base_dir = base_dir
        os.makedirs(self.base_dir, exist_ok=True)
        logger.info(f"LocalStorage 初始化: {self.base_dir}")

    def _path(self, key: str) -> str:
        import os
        # 防止 path traversal
        safe_key = key.replace("..", "_").lstrip("/")
        return os.path.join(self.base_dir, safe_key)

    def upload(self, key: str, data: bytes, content_type: str = "") -> str:
        path = self._path(key)
        import os
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "wb") as f:
            f.write(data)
        return key

    def download(self, key: str) -> bytes:
        with open(self._path(key), "rb") as f:
            return f.read()

    def delete(self, key: str) -> bool:
        import os
        path = self._path(key)
        if os.path.exists(path):
            os.remove(path)
            return True
        return False

    def exists(self, key: str) -> bool:
        import os
        return os.path.exists(self._path(key))


class S3Storage(StorageBackend):
    """S3-compatible 实现（MinIO / AWS / 阿里 OSS）"""
    def __init__(self, endpoint: str, access_key: str, secret_key: str, bucket: str, region: str = "us-east-1"):
        import boto3
        from botocore.client import Config
        self.bucket = bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=endpoint,
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region,
            config=Config(signature_version="s3v4"),
        )
        self._ensure_bucket()
        logger.info(f"S3Storage 初始化: {endpoint}/{bucket}")

    def _ensure_bucket(self):
        """检查 / 创建 bucket；任一步失败都抛异常让调用方决定是否 fallback"""
        try:
            self.client.head_bucket(Bucket=self.bucket)
            return
        except Exception as head_err:
            logger.debug(f"head_bucket 失败: {head_err}")
        # 尝试创建
        try:
            self.client.create_bucket(Bucket=self.bucket)
            logger.info(f"创建 bucket: {self.bucket}")
        except Exception as create_err:
            raise RuntimeError(
                f"S3 bucket 不可用 ({self.bucket}@{self.bucket}): {create_err}"
            ) from create_err

    def upload(self, key: str, data: bytes, content_type: str = "") -> str:
        kwargs = {"Bucket": self.bucket, "Key": key, "Body": data}
        if content_type:
            kwargs["ContentType"] = content_type
        self.client.put_object(**kwargs)
        return key

    def download(self, key: str) -> bytes:
        obj = self.client.get_object(Bucket=self.bucket, Key=key)
        return obj["Body"].read()

    def delete(self, key: str) -> bool:
        try:
            self.client.delete_object(Bucket=self.bucket, Key=key)
            return True
        except Exception as e:
            logger.warning(f"删除失败 {key}: {e}")
            return False

    def exists(self, key: str) -> bool:
        try:
            self.client.head_object(Bucket=self.bucket, Key=key)
            return True
        except Exception:
            return False


# 全局实例（在 main.py 启动时初始化）
_storage: Optional[StorageBackend] = None


def init_storage(backend: StorageBackend):
    """在应用启动时调用，注入全局实例"""
    global _storage
    _storage = backend


def get_storage() -> StorageBackend:
    if _storage is None:
        raise RuntimeError("Storage 未初始化，请先调用 init_storage()")
    return _storage