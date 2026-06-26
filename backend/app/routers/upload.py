"""
POST /api/upload — 接收 multipart 文件上传，存到 storage，创建 Job，触发后台 pipeline

鉴权（task #36 启用）：
- 优先从 JWT 解析 account_id / player_id
- 兼容老 form user_id（warning 后写入 legacy user_id 列，新列 account_id 留空）
"""
import logging
import uuid

from fastapi import (
    APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile, status,
)
from sqlalchemy.orm import Session

from .. import auth as auth_core
from ..config import settings
from ..database import get_db
from ..models import Account, Job, JobStatus
from ..schemas import JobResponse
from ..storage import get_storage

router = APIRouter()
logger = logging.getLogger(__name__)


# 允许的文件类型（按扩展名）
ALLOWED_EXTENSIONS = {
    # 文档（pipeline 完整支持：text → words → meanings → library → tts）
    ".pdf": "pdf", ".docx": "docx", ".txt": "txt",
    # 音频（task #13 ASR 选型后扩展）
    ".mp3": "mp3", ".wav": "wav", ".m4a": "m4a",
    # 图片（task #15 OCR 选型后扩展）
    ".jpg": "image", ".jpeg": "image", ".png": "image", ".webp": "image",
}


def _detect_source_type(filename: str) -> str:
    """根据扩展名返回 source_type"""
    import os
    ext = os.path.splitext(filename)[1].lower()
    return ALLOWED_EXTENSIONS.get(ext, "unknown")


def _resolve_account(request: Request, db: Session) -> tuple[Account | None, str | None]:
    """优先 JWT；fallback 老 form user_id（写入 legacy 列 + warning）"""
    creds = auth_core._extract_token(request, None)  # 仅 header/query，不解 creds
    # 重新走完整 Depends 路径有点重，直接复用核心函数
    from fastapi.security import HTTPAuthorizationCredentials
    auth_header = request.headers.get("authorization")
    creds_obj = None
    if auth_header and auth_header.lower().startswith("bearer "):
        creds_obj = HTTPAuthorizationCredentials(scheme="bearer", credentials=auth_header[7:].strip())

    token = auth_core._extract_token(request, creds_obj)
    if token:
        payload = auth_core.decode_token(token)
        if payload and payload.get("sub"):
            account = db.query(Account).filter(Account.id == payload["sub"]).first()
            if account:
                return account, None
    return None, None


@router.post("/upload", response_model=JobResponse, status_code=201)
async def upload_file(
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(..., description="源文件（mp3/pdf/docx/txt/image 等）"),
    user_id: str | None = Form(None, description="【legacy】前端用户 ID；新代码用 JWT"),
    target_library_id: str | None = Form(None, description="目标词库 ID（新建可留空）"),
    db: Session = Depends(get_db),
):
    """
    接收文件上传：
    1. 校验大小和类型
    2. 鉴权（JWT 优先 → account_id；fallback 老 form user_id → 写 legacy 列）
    3. 存到 storage（local 或 S3）
    4. 创建 Job 记录（status=pending）
    5. 立即返回 job_id（不等 pipeline 完成）
    6. 后台异步执行 pipeline：text → words → meanings → library → tts
    7. 前端轮询 GET /api/jobs/{id} 查看进度
    """
    # 1. 鉴权
    account, _ = _resolve_account(request, db)
    legacy_user_id = user_id
    account_id: str | None = account.id if account else None
    player_id: str | None = None  # 未来从 body 或 query 传入
    if not account and not legacy_user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="未登录：缺少 Authorization Bearer token（或 form user_id）",
        )
    if account:
        logger.debug(f"upload: JWT auth account={account.id}")
    elif legacy_user_id:
        logger.warning(
            f"upload: legacy form user_id={legacy_user_id}（无 JWT）；写入 user_id 列，account_id 留空"
        )

    # 2. 类型校验
    source_type = _detect_source_type(file.filename or "")
    if source_type == "unknown":
        raise HTTPException(
            status_code=400,
            detail=f"不支持的文件类型。允许：{', '.join(ALLOWED_EXTENSIONS.keys())}",
        )

    # 3. 读文件内容
    content = await file.read()
    size = len(content)
    if size > settings.max_upload_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=f"文件过大 ({size / 1024 / 1024:.1f}MB)，最大 {settings.MAX_UPLOAD_SIZE_MB}MB",
        )
    if size == 0:
        raise HTTPException(status_code=400, detail="空文件")

    # 4. 存到 storage
    storage = get_storage()
    owner_id = account_id or legacy_user_id or "anonymous"
    storage_key = f"uploads/{owner_id}/{uuid.uuid4()}/{file.filename}"
    try:
        storage.upload(storage_key, content, content_type=file.content_type or "application/octet-stream")
    except Exception as e:
        logger.error(f"Storage upload 失败: {e}")
        raise HTTPException(status_code=500, detail=f"文件存储失败: {e}")

    # 5. 创建 Job
    job = Job(
        account_id=account_id,
        player_id=player_id,
        user_id=legacy_user_id,
        target_library_id=target_library_id,
        source_filename=file.filename or "unknown",
        source_type=source_type,
        source_size_bytes=size,
        storage_key=storage_key,
        status=JobStatus.PENDING,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    # 6. 派发后台 pipeline（FastAPI BackgroundTasks 异步执行）
    from ..workers.pipeline import dispatch_pipeline
    background_tasks.add_task(dispatch_pipeline, job.id, source_type)

    logger.info(
        f"Job 创建: id={job.id} type={source_type} size={size}B "
        f"account={account_id} user={legacy_user_id} target_lib={target_library_id}"
    )
    return job
