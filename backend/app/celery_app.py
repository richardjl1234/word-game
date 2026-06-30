"""
Celery 应用实例。
- broker: Redis（队列）
- result_backend: Redis（结果存储）
- task modules: workers.text_extract, workers.lemma 等

启动 worker：
    celery -A app.celery_app worker --loglevel=info --concurrency=4
"""
import os
from celery import Celery

from .config import settings


celery_app = Celery(
    "wordgame",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=[
        "app.workers.text_extract",
        "app.workers.lemma",
        # 后续接入：app.workers.asr / app.workers.ocr / app.workers.llm / app.workers.tts
    ],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=600,          # 10 分钟硬超时
    task_soft_time_limit=540,     # 9 分钟软超时
    worker_max_tasks_per_child=200,  # 防止内存泄漏
    worker_prefetch_multiplier=1,
    # 任务路由（按类型分队列，便于监控 / 扩缩容）
    task_routes={
        "app.workers.text_extract.*": {"queue": "text_extract"},
        "app.workers.lemma.*": {"queue": "lemma"},
    },
    # 默认队列
    task_default_queue="default",
)