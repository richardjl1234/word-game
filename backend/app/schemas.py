"""
Pydantic schemas（API 请求/响应）
"""
from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


# ==================== Auth（注册/登录） ====================

class RegisterRequest(BaseModel):
    """注册账号（需要 admin token）"""
    username: str = Field(..., description="昵称（账号凭证，账号内唯一）")
    password: str = Field(..., min_length=4, description="密码（至少 4 位）")


class LoginRequest(BaseModel):
    """登录账号"""
    username: str = Field(...)
    password: str = Field(...)


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    username: str
    role: str = "user"
    must_change_password: bool = False
    created_at: datetime
    last_login_at: Optional[datetime] = None


class PlayerProfileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    account_id: str
    nickname: str
    avatar: str = "🦊"
    created_at: datetime
    last_played_at: Optional[datetime] = None


class AuthResponse(BaseModel):
    """register / login 返回：token + 当前账号 + 当前玩家档案"""
    token: str
    token_type: str = "bearer"
    account: AccountResponse
    profile: PlayerProfileResponse
    must_change_password: bool = False


class ChangePasswordRequest(BaseModel):
    """修改密码"""
    old_password: str = Field(...)
    new_password: str = Field(..., min_length=4)


class MeResponse(BaseModel):
    """GET /api/auth/me 返回"""
    account: AccountResponse
    profiles: List[PlayerProfileResponse]
    current_profile: Optional[PlayerProfileResponse] = None


# ==================== Admin User Management ====================

class AdminCreateAccountRequest(BaseModel):
    """Admin 创建新 Account"""
    username: str = Field(..., min_length=2, max_length=20)
    password: str = Field(default="1234", min_length=4)


class AdminAccountResponse(BaseModel):
    """Admin 看到的 Account（不含密码 hash）"""
    model_config = ConfigDict(from_attributes=True)
    id: str
    username: str
    role: str = "user"
    must_change_password: bool = False
    created_at: datetime
    last_login_at: Optional[datetime] = None
    profile_count: int = 0


# ==================== Player Profile CRUD ====================

class PlayerProfileCreate(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=20)
    avatar: str = Field(default="🦊", max_length=8)


class PlayerProfileUpdate(BaseModel):
    nickname: Optional[str] = Field(None, min_length=1, max_length=20)
    avatar: Optional[str] = Field(None, max_length=8)


# ==================== Job ====================

class JobCreateRequest(BaseModel):
    """上传时可附带的元数据（通常由 multipart form 提供，这里用于文档化）"""
    user_id: Optional[str] = Field(None, description="前端用户 ID（legacy，老 API 兼容）")
    target_library_id: Optional[str] = Field(None, description="目标词库 ID，新建则留空")


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    account_id: Optional[str] = None
    player_id: Optional[str] = None
    user_id: Optional[str] = None  # legacy
    target_library_id: Optional[str] = None

    source_filename: str
    source_type: str
    source_size_bytes: int
    storage_key: str = ""

    status: str
    current_stage: Optional[str] = None
    progress: int = 0

    result: Optional[Dict[str, Any]] = None
    error_message: Optional[str] = None

    created_at: datetime
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None


class JobListResponse(BaseModel):
    jobs: List[JobResponse]
    total: int


# ==================== Library ====================

class LibraryCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=30)
    source: str = "manual"


class LibraryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    is_default: bool
    source: str
    word_count: int
    level_count: int
    created_at: datetime
    account_id: Optional[str] = None
    player_id: Optional[str] = None


class WordAddRequest(BaseModel):
    """向词库批量添加单词"""
    words: List[Dict[str, Any]] = Field(..., description="[{word, meaning, difficulty, ...}]")


class WordAddResponse(BaseModel):
    added: int
    skipped: int
    total: int


# ==================== Health ====================

class HealthResponse(BaseModel):
    status: str
    version: str
    db: bool
    redis: bool
    s3: bool