"""
数据模型：
- Job: 一次文件上传的处理任务（追踪 status / progress / 当前阶段）
- Library: 自定义词库元数据（前端 librariesManager 镜像）
- Word: 词库中的单词/短语条目（含 audio 状态）

约束：
- Library.word 唯一约束（library_id + word）
- Job.current_stage 用 enum
"""
import enum
import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Integer, Text, DateTime, Enum, ForeignKey,
    UniqueConstraint, Index, JSON, Boolean
)
from sqlalchemy.orm import relationship

from .database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class JobStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class JobStage(str, enum.Enum):
    """处理阶段（与 plan pipeline 对应）"""
    TEXT_EXTRACT = "text_extract"   # PDF/DOCX/TXT 提取
    ASR = "asr"                      # 音频转文字（暂缓）
    OCR = "ocr"                      # 图片转文字（暂缓）
    LLM = "llm"                      # LLM 提取单词/短语（暂缓）
    LEMMA = "lemma"                  # spaCy 词形还原
    TTS = "tts"                      # 批量生成音频（暂缓）
    DONE = "done"


class AudioStatus(str, enum.Enum):
    PENDING = "pending"
    GENERATING = "generating"
    READY = "ready"
    FAILED = "failed"


class Account(Base):
    """登录账号（凭证）

    - username: 登录昵称（唯一）
    - password_hash: bcrypt 哈希后的密码
    - 一个账号下可有多个 PlayerProfile（家长账号下多个孩子）
    """
    __tablename__ = "accounts"

    id = Column(String, primary_key=True)            # "acc_<base36ts>_<rand>"
    username = Column(String, nullable=False, unique=True, index=True)
    password_hash = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_login_at = Column(DateTime, nullable=True)

    profiles = relationship("PlayerProfile", back_populates="account",
                             cascade="all, delete-orphan")


class PlayerProfile(Base):
    """玩家档案（账号下的具体玩家）

    - nickname: 显示名（账号内唯一）
    - avatar: emoji 头像
    - last_played_at: 最近一次玩游戏的时间
    - 跨设备登录同一账号时所有 profile 都会显示
    """
    __tablename__ = "player_profiles"

    id = Column(String, primary_key=True)            # "p_<base36ts>_<rand>"
    account_id = Column(String, ForeignKey("accounts.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    nickname = Column(String, nullable=False)
    avatar = Column(String, default="🦊")
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    last_played_at = Column(DateTime, nullable=True)

    account = relationship("Account", back_populates="profiles")

    __table_args__ = (
        UniqueConstraint("account_id", "nickname", name="uq_profile_account_nickname"),
    )


class Job(Base):
    """一次上传文件的处理任务"""
    __tablename__ = "jobs"

    id = Column(String, primary_key=True, default=_uuid)
    # 新：归属账号 + 玩家档案（auth 启用后必填）
    account_id = Column(String, ForeignKey("accounts.id", ondelete="SET NULL"),
                        nullable=True, index=True)
    player_id = Column(String, ForeignKey("player_profiles.id", ondelete="SET NULL"),
                       nullable=True, index=True)
    # 老：保留兼容（老 E2E / 老 API）
    user_id = Column(String, nullable=True, index=True)

    target_library_id = Column(String, nullable=True, index=True)

    # 源文件信息
    source_filename = Column(String, nullable=False)
    source_type = Column(String, nullable=False)  # 'mp3' | 'pdf' | 'docx' | 'txt' | 'image'
    source_size_bytes = Column(Integer, nullable=False, default=0)
    storage_key = Column(String, nullable=False)  # S3 路径

    # 处理状态
    status = Column(Enum(JobStatus), default=JobStatus.PENDING, nullable=False, index=True)
    current_stage = Column(Enum(JobStage), nullable=True)
    progress = Column(Integer, default=0)  # 0-100

    # 结果 / 错误
    result = Column(JSON, nullable=True)         # 提取出的文本、词列表等
    error_message = Column(Text, nullable=True)

    # 时间戳
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)

    __table_args__ = (
        Index("ix_jobs_account_created", "account_id", "created_at"),
    )


class Library(Base):
    """自定义词库元数据"""
    __tablename__ = "libraries"

    id = Column(String, primary_key=True, default=_uuid)
    # 新：归属账号 + 玩家档案（auth 启用后必填）
    account_id = Column(String, ForeignKey("accounts.id", ondelete="SET NULL"),
                        nullable=True, index=True)
    player_id = Column(String, ForeignKey("player_profiles.id", ondelete="SET NULL"),
                       nullable=True, index=True)
    # 老：保留兼容
    user_id = Column(String, nullable=True, index=True)

    name = Column(String, nullable=False)
    is_default = Column(Boolean, default=False)
    source = Column(String, default="manual")  # 'manual' | 'import:pdf' | ...

    word_count = Column(Integer, default=0)
    level_count = Column(Integer, default=1)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    words = relationship("Word", back_populates="library", cascade="all, delete-orphan")

    __table_args__ = (
        UniqueConstraint("account_id", "name", name="uq_library_account_name"),
        UniqueConstraint("user_id", "name", name="uq_library_user_name"),
    )


class Word(Base):
    """词库中的单词/短语条目"""
    __tablename__ = "words"

    id = Column(String, primary_key=True, default=_uuid)
    library_id = Column(String, ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False, index=True)

    word = Column(String, nullable=False)
    meaning = Column(String, nullable=False)
    difficulty = Column(Integer, default=5)
    position = Column(Integer, nullable=False, default=0)  # 在词库内的位置（用于 50 词/关切片）

    # Audio 路径和状态
    audio_en = Column(String, default="")
    audio_zh = Column(String, default="")
    audio_en_status = Column(Enum(AudioStatus), default=AudioStatus.PENDING)
    audio_zh_status = Column(Enum(AudioStatus), default=AudioStatus.PENDING)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    library = relationship("Library", back_populates="words")

    __table_args__ = (
        UniqueConstraint("library_id", "word", name="uq_word_library_word"),
        Index("ix_word_library_position", "library_id", "position"),
    )