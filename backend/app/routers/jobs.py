"""
Job 状态查询（★ 已加固：需要 JWT 鉴权）

- GET  /api/jobs/{id}    查单个 Job（普通用户只能查自己的；admin 可查所有）
- GET  /api/jobs         列 Job（普通用户列自己的；admin 列所有）
- DELETE /api/jobs/{id}  取消 Job（普通用户只能取消自己的；admin 可取消所有）
"""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc

from .. import auth as auth_core
from ..database import get_db
from ..models import Account, Job, JobStatus
from ..schemas import JobResponse, JobListResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/jobs/{job_id}", response_model=JobResponse)
def get_job(
    job_id: str,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job 不存在: {job_id}")
    # 普通用户只能看自己的 job；admin 可看所有
    if account.role != "admin" and job.account_id and job.account_id != account.id:
        raise HTTPException(status_code=403, detail="无权访问此 Job")
    return job


@router.get("/jobs", response_model=JobListResponse)
def list_jobs(
    account: Account = Depends(auth_core.get_current_account),
    user_id: Optional[str] = Query(None, description="按用户过滤（仅 admin 可用）"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(Job)
    if account.role == "admin":
        if user_id:
            q = q.filter(Job.user_id == user_id)
    else:
        q = q.filter(Job.account_id == account.id)
    total = q.count()
    jobs = q.order_by(desc(Job.created_at)).limit(limit).offset(offset).all()
    return JobListResponse(jobs=jobs, total=total)


@router.delete("/jobs/{job_id}", status_code=204)
def cancel_job(
    job_id: str,
    account: Account = Depends(auth_core.get_current_account),
    db: Session = Depends(get_db),
):
    """取消/删除 Job（仅允许 pending/processing 状态取消）"""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job 不存在")
    if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
        raise HTTPException(status_code=409, detail=f"Job 已结束 ({job.status.value})，无法取消")
    # 普通用户只能取消自己的 job
    if account.role != "admin" and job.account_id and job.account_id != account.id:
        raise HTTPException(status_code=403, detail="无权取消此 Job")
    job.status = JobStatus.CANCELLED
    job.completed_at = datetime.utcnow()
    db.commit()
    return None
