"""
GET /api/jobs/{id} — 查询 Job 状态/进度/结果
GET /api/jobs?user_id=... — 列用户的所有 Job
"""
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import desc

from ..database import get_db
from ..models import Job, JobStatus
from ..schemas import JobResponse, JobListResponse

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/jobs/{job_id}", response_model=JobResponse)
def get_job(job_id: str, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail=f"Job 不存在: {job_id}")
    return job


@router.get("/jobs", response_model=JobListResponse)
def list_jobs(
    user_id: Optional[str] = Query(None, description="按用户过滤"),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    q = db.query(Job)
    if user_id:
        q = q.filter(Job.user_id == user_id)
    total = q.count()
    jobs = q.order_by(desc(Job.created_at)).limit(limit).offset(offset).all()
    return JobListResponse(jobs=jobs, total=total)


@router.delete("/jobs/{job_id}", status_code=204)
def cancel_job(job_id: str, db: Session = Depends(get_db)):
    """取消/删除 Job（仅允许 pending/processing 状态取消）"""
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job 不存在")
    if job.status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
        raise HTTPException(status_code=409, detail=f"Job 已结束 ({job.status.value})，无法取消")
    job.status = JobStatus.CANCELLED
    job.completed_at = datetime.utcnow()
    db.commit()
    return None