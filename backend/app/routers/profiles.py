"""
玩家档案 CRUD：
- GET    /api/accounts/{account_id}/profiles     列出该账号下所有玩家档案
- POST   /api/accounts/{account_id}/profiles     创建新玩家档案（昵称账号内唯一）
- PATCH  /api/profiles/{profile_id}              修改昵称/头像
- DELETE /api/profiles/{profile_id}              删除（至少保留一个）
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import auth as auth_core
from ..database import get_db
from ..models import Account, PlayerProfile
from ..schemas import PlayerProfileCreate, PlayerProfileResponse, PlayerProfileUpdate

logger = logging.getLogger(__name__)
router = APIRouter()


def _check_ownership(profile_id: str, account: Account, db: Session) -> PlayerProfile:
    """校验 profile 属于当前账号，返回 ORM 对象"""
    p = db.query(PlayerProfile).filter(PlayerProfile.id == profile_id).first()
    if not p:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="玩家档案不存在")
    if p.account_id != account.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权操作其他账号的玩家档案")
    return p


@router.get(
    "/api/accounts/{account_id}/profiles",
    response_model=list[PlayerProfileResponse],
)
def list_profiles(
    account_id: str,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    if account_id != account.id and account.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权查看其他账号的档案")
    profiles = (
        db.query(PlayerProfile)
        .filter(PlayerProfile.account_id == account_id)
        .order_by(PlayerProfile.created_at.asc())
        .all()
    )
    return [PlayerProfileResponse.model_validate(p) for p in profiles]


@router.post(
    "/api/accounts/{account_id}/profiles",
    response_model=PlayerProfileResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_profile(
    account_id: str,
    payload: PlayerProfileCreate,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    if account_id != account.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="无权在其他账号下创建档案")

    nickname = (payload.nickname or "").strip()
    if not nickname:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="昵称不能为空")
    if len(nickname) > 20:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="昵称长度不能超过 20")

    p = PlayerProfile(
        id=auth_core.gen_player_id(),
        account_id=account.id,
        nickname=nickname,
        avatar=payload.avatar or "🦊",
    )
    db.add(p)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"昵称「{nickname}」在该账号下已存在",
        )
    db.refresh(p)
    logger.info(f"玩家档案创建：account={account.id} profile={p.id} nickname={nickname}")
    return PlayerProfileResponse.model_validate(p)


@router.patch("/api/profiles/{profile_id}", response_model=PlayerProfileResponse)
def update_profile(
    profile_id: str,
    payload: PlayerProfileUpdate,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    p = _check_ownership(profile_id, account, db)
    if payload.nickname is not None:
        new_nick = payload.nickname.strip()
        if not new_nick:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="昵称不能为空")
        if len(new_nick) > 20:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="昵称长度不能超过 20")
        p.nickname = new_nick
    if payload.avatar is not None:
        p.avatar = payload.avatar
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"昵称「{payload.nickname}」在该账号下已存在",
        )
    db.refresh(p)
    return PlayerProfileResponse.model_validate(p)


@router.delete("/api/profiles/{profile_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profile(
    profile_id: str,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    p = _check_ownership(profile_id, account, db)
    # 至少保留一个 profile
    cnt = db.query(PlayerProfile).filter(PlayerProfile.account_id == account.id).count()
    if cnt <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="至少保留一个玩家档案",
        )
    db.delete(p)
    db.commit()
    return None


@router.post("/api/profiles/{profile_id}/touch", response_model=PlayerProfileResponse)
def touch_profile(
    profile_id: str,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    """前端切换玩家档案时调用，更新 last_played_at"""
    p = _check_ownership(profile_id, account, db)
    p.last_played_at = datetime.utcnow()
    db.commit()
    db.refresh(p)
    return PlayerProfileResponse.model_validate(p)
