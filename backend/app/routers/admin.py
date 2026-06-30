"""
Admin 用户管理 API（仅 admin 可访问）

- GET    /api/admin/accounts                  列出所有 Account
- POST   /api/admin/accounts                  创建新 Account
- DELETE /api/admin/accounts/{id}             删除 Account（含 Profile + Library）
- POST   /api/admin/accounts/{id}/reset-password  重置密码为默认值
"""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import auth as auth_core
from ..config import settings
from ..database import get_db
from ..models import Account, PlayerProfile
from ..schemas import (
    AdminAccountResponse,
    AdminCreateAccountRequest,
    PlayerProfileResponse,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin", tags=["admin"])


def _ensure_username(username: str) -> str:
    try:
        return auth_core.validate_username(username)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/accounts", response_model=list[AdminAccountResponse])
def list_accounts(
    admin: Account = Depends(auth_core.get_current_admin),
    db: Session = Depends(get_db),
):
    """列出所有 Account（含 profile_count）"""
    accounts = db.query(Account).order_by(Account.created_at).all()
    result = []
    for acc in accounts:
        profile_count = (
            db.query(PlayerProfile)
            .filter(PlayerProfile.account_id == acc.id)
            .count()
        )
        resp = AdminAccountResponse.model_validate(acc)
        resp.profile_count = profile_count
        result.append(resp)
    return result


@router.post("/accounts", response_model=AdminAccountResponse, status_code=201)
def create_account(
    payload: AdminCreateAccountRequest,
    admin: Account = Depends(auth_core.get_current_admin),
    db: Session = Depends(get_db),
):
    """创建新 Account（含初始密码 + 默认 Profile）"""
    username = _ensure_username(payload.username.strip())
    password = payload.password or settings.DEFAULT_USER_PASSWORD
    auth_core.validate_password_strength(password)

    if db.query(Account).filter(Account.username == username).first():
        raise HTTPException(status_code=409, detail=f"昵称「{username}」已被占用")

    account = Account(
        id=auth_core.gen_account_id(),
        username=username,
        password_hash=auth_core.hash_password(password),
        role="user",
        must_change_password=True,
    )
    db.add(account)
    db.flush()

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
        logger.exception(f"创建账号失败：{e}")
        raise HTTPException(status_code=409, detail="昵称已被占用")

    db.refresh(account)
    logger.info(f"Admin 创建账号：username={username} account_id={account.id}")
    return AdminAccountResponse(
        id=account.id,
        username=account.username,
        role=account.role,
        must_change_password=account.must_change_password,
        created_at=account.created_at,
        last_login_at=account.last_login_at,
        profile_count=1,
    )


@router.delete("/accounts/{account_id}", status_code=204)
def delete_account(
    account_id: str,
    admin: Account = Depends(auth_core.get_current_admin),
    db: Session = Depends(get_db),
):
    """删除 Account（不能删自己）"""
    if account_id == admin.id:
        raise HTTPException(status_code=400, detail="不能删除自己的账号")

    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    # 先删 profiles（cascade）
    db.query(PlayerProfile).filter(
        PlayerProfile.account_id == account.id
    ).delete()
    # 删 account（Library 的 account_id 会被 SET NULL）
    db.delete(account)
    db.commit()
    logger.info(f"Admin 删除账号：account_id={account_id}")


@router.post("/accounts/{account_id}/reset-password", status_code=200)
def reset_password(
    account_id: str,
    admin: Account = Depends(auth_core.get_current_admin),
    db: Session = Depends(get_db),
):
    """重置密码为默认值 + 设 must_change_password=True"""
    account = db.query(Account).filter(Account.id == account_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="账号不存在")

    account.password_hash = auth_core.hash_password(settings.DEFAULT_USER_PASSWORD)
    account.must_change_password = True
    db.commit()
    logger.info(f"Admin 重置密码：account_id={account_id}")
    return {"detail": f"密码已重置为默认值，{account.username} 下次登录需修改密码"}
