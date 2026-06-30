"""
认证核心：密码 hash + JWT 签发解码 + 当前账号 Depends。

- JWT_SECRET 从环境变量加载（生产必须 export JWT_SECRET=$(openssl rand -hex 32)）
- 默认开发密钥仅供本地启动，启动时打 WARNING
- 密码 bcrypt（passlib）
- Token 有效期 7 天（可配）
"""
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from .config import settings
from .database import get_db
from .models import Account

logger = logging.getLogger(__name__)

# bcrypt rounds 默认 12；测试时可通过 monkeypatch 降到 4 加速
_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# 启动时检查 JWT_SECRET 是否用默认值（仅警告，不阻断开发）
_DEFAULT_SECRET_MARKERS = ("CHANGE-ME", "dev-only")


def _warn_if_using_default_secret():
    if any(m in settings.JWT_SECRET for m in _DEFAULT_SECRET_MARKERS):
        logger.warning(
            "⚠️ JWT_SECRET 使用了默认值！生产环境必须 export JWT_SECRET=$(openssl rand -hex 32)"
        )


_warn_if_using_default_secret()


# ---------- 密码 ----------

def hash_password(plain: str) -> str:
    return _pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pwd_context.verify(plain, hashed)
    except Exception:
        return False


def validate_username(username: str) -> str:
    """校验 username：2-20 字符，允许中文/字母/数字/下划线/连字符"""
    if not (2 <= len(username) <= 20):
        raise ValueError("用户名长度需在 2-20 之间")
    if not re.match(r"^[\w一-鿿\-]+$", username, flags=re.UNICODE):
        raise ValueError("用户名仅支持中英文/字母/数字/下划线/连字符")
    return username


# ---------- JWT ----------

def create_access_token(account_id: str, username: str, role: str = "user") -> str:
    """签发 JWT（HS256，payload: sub=account_id, name=username, role=role, exp=now+expire_days）"""
    expire = datetime.now(timezone.utc) + timedelta(days=settings.JWT_EXPIRE_DAYS)
    payload = {
        "sub": account_id,
        "name": username,
        "role": role,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
    }
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    """解码 JWT；过期/无效返回 None"""
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        logger.info("JWT expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.info(f"JWT invalid: {e}")
        return None


# ---------- FastAPI Depends ----------

# auto_error=False 让前端可以不带 token 调用公开端点（如 /register, /login）
_bearer_scheme = HTTPBearer(auto_error=False)


def _extract_token(request: Request, creds: Optional[HTTPAuthorizationCredentials]) -> Optional[str]:
    if creds and creds.scheme.lower() == "bearer" and creds.credentials:
        return creds.credentials
    # 备用：从 query 参数 ?token=xxx（用于 EventSource / 直接链接）
    qp = request.query_params.get("token")
    if qp:
        return qp
    return None


def get_current_account(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> Account:
    """FastAPI Depends：解析 Authorization: Bearer <token> → 返回 Account ORM

    用法：
        @router.get("/me")
        def me(account: Account = Depends(get_current_account)):
            return {"id": account.id, "username": account.username}
    """
    token = _extract_token(request, creds)
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录：缺少 Authorization Bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(token)
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录：token 无效或已过期",
            headers={"WWW-Authenticate": "Bearer"},
        )
    account_id = payload.get("sub")
    if not account_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token 缺少 sub 字段")
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="账号不存在")
    return account


def get_current_account_optional(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> Optional[Account]:
    """可选版本：未登录不抛错，返回 None"""
    token = _extract_token(request, creds)
    if not token:
        return None
    payload = decode_token(token)
    if not payload:
        return None
    account_id = payload.get("sub")
    if not account_id:
        return None
    return db.query(Account).filter(Account.id == account_id).first()


def get_current_admin(
    account: Account = Depends(get_current_account),
) -> Account:
    """FastAPI Depends：仅允许 admin 角色的用户通过"""
    if account.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="需要管理员权限",
        )
    return account


def validate_password_strength(password: str) -> str:
    """密码强度校验：至少 MIN_PASSWORD_LENGTH 位"""
    if len(password) < settings.MIN_PASSWORD_LENGTH:
        raise ValueError(f"密码长度至少 {settings.MIN_PASSWORD_LENGTH} 位")
    return password


# ---------- ID 生成 ----------

def _gen_id(prefix: str) -> str:
    """生成 acc_/p_ 前缀的 ID（与前端 usersManager 风格一致）"""
    import secrets
    import time
    ts = hex(int(time.time() * 1000))[2:]
    rand = secrets.token_hex(3)
    return f"{prefix}_{ts}_{rand}"


def gen_account_id() -> str:
    return _gen_id("acc")


def gen_player_id() -> str:
    return _gen_id("p")
