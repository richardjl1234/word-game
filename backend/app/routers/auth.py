"""
认证路由：
- POST /api/auth/register  注册（昵称 + 密码）→ 返回 JWT + 默认 PlayerProfile
- POST /api/auth/login     登录 → 返回 JWT + 最近一次玩的 PlayerProfile
- GET  /api/auth/me        当前账号 + 所有 profiles
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import auth as auth_core
from ..database import get_db
from ..models import Account, PlayerProfile
from ..schemas import (
    AccountResponse,
    AuthResponse,
    LoginRequest,
    MeResponse,
    PlayerProfileResponse,
    RegisterRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/auth", tags=["auth"])


def _ensure_username(username: str) -> str:
    try:
        return auth_core.validate_username(username)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def _latest_profile(db: Session, account_id: str) -> PlayerProfile | None:
    return (
        db.query(PlayerProfile)
        .filter(PlayerProfile.account_id == account_id)
        .order_by(PlayerProfile.last_played_at.desc().nullslast(), PlayerProfile.created_at.asc())
        .first()
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    username = _ensure_username(payload.username.strip())
    password = payload.password
    if len(password) < 6:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="密码至少 6 位")

    # 检查 username 唯一
    if db.query(Account).filter(Account.username == username).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"昵称「{username}」已被占用")

    account = Account(
        id=auth_core.gen_account_id(),
        username=username,
        password_hash=auth_core.hash_password(password),
    )
    db.add(account)
    db.flush()  # 拿到 account.id

    # 创建默认 PlayerProfile
    profile = PlayerProfile(
        id=auth_core.gen_player_id(),
        account_id=account.id,
        nickname=username,
        avatar="🦊",
    )
    db.add(profile)

    try:
        db.commit()
    except IntegrityError as e:
        db.rollback()
        logger.exception(f"注册失败：{e}")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="昵称已被占用")

    db.refresh(account)
    db.refresh(profile)
    token = auth_core.create_access_token(account.id, account.username)
    logger.info(f"账号注册成功：username={username} account_id={account.id}")
    return AuthResponse(
        token=token,
        account=AccountResponse.model_validate(account),
        profile=PlayerProfileResponse.model_validate(profile),
    )


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    username = payload.username.strip()
    password = payload.password

    account = db.query(Account).filter(Account.username == username).first()
    if not account or not auth_core.verify_password(password, account.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="昵称或密码错误")

    # 更新 last_login_at
    account.last_login_at = datetime.utcnow()

    # 取最近一次玩的 profile
    profile = _latest_profile(db, account.id)
    if not profile:
        # 极端 case：账号存在但 profile 全被删了，自动恢复一个
        profile = PlayerProfile(
            id=auth_core.gen_player_id(),
            account_id=account.id,
            nickname=account.username,
            avatar="🦊",
        )
        db.add(profile)
        db.commit()
        db.refresh(profile)

    db.commit()
    db.refresh(account)
    db.refresh(profile)
    token = auth_core.create_access_token(account.id, account.username)
    logger.info(f"账号登录成功：username={username} account_id={account.id}")
    return AuthResponse(
        token=token,
        account=AccountResponse.model_validate(account),
        profile=PlayerProfileResponse.model_validate(profile),
    )


@router.get("/me", response_model=MeResponse)
def me(account: Account = Depends(auth_core.get_current_account), db: Session = Depends(get_db)):
    profiles = (
        db.query(PlayerProfile)
        .filter(PlayerProfile.account_id == account.id)
        .order_by(PlayerProfile.created_at.asc())
        .all()
    )
    latest = _latest_profile(db, account.id)
    return MeResponse(
        account=AccountResponse.model_validate(account),
        profiles=[PlayerProfileResponse.model_validate(p) for p in profiles],
        current_profile=PlayerProfileResponse.model_validate(latest) if latest else None,
    )
