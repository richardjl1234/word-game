"""
Pipeline dispatcher + 完整 5 步链路（task #32）：
- txt/pdf/docx → text_extract → word_extract → meaning_lookup → add_to_library → tts

设计：
- `dispatch_pipeline(job_id, source_type)` 是 FastAPI BackgroundTasks 的入口（同步）
- `run_full_pipeline(job_id)` 是完整链路（同步，逐步更新 Job 状态）
- 完整链路用 BackgroundTasks 异步执行，HTTP 请求立即返回 job_id
- mp3/image 占位逻辑保留（task #13/#15 选型后扩展）

注意：所有 DB 操作通过 _get_session() 动态取 SessionLocal（避免测试 fixture 替换 engine 后缓存失效）
"""
import io
import logging
from datetime import datetime
from typing import List, Tuple

from ..models import Job, JobStatus, JobStage, Library, Word, AudioStatus
from ..storage import get_storage

logger = logging.getLogger(__name__)


def _get_session():
    """动态取 SessionLocal（让测试 monkeypatch 生效）"""
    from .. import database
    return database.SessionLocal()


def update_job_status(job_id: str, *, status: JobStatus | None = None,
                      current_stage: JobStage | None = None,
                      progress: int | None = None,
                      result: dict | None = None,
                      error_message: str | None = None):
    """worker 内部更新 job 状态"""
    with _get_session() as db:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            logger.warning(f"Job {job_id} 不存在")
            return
        if status is not None:
            job.status = status
        if current_stage is not None:
            job.current_stage = current_stage
        if progress is not None:
            job.progress = progress
        if result is not None:
            # 注意：JSON column 默认不跟踪 in-memory dict 修改
            # 必须创建新 dict 赋值，让 SQLAlchemy 检测到 attribute 变化
            existing = job.result or {}
            job.result = {**existing, **result}
        if error_message is not None:
            job.error_message = error_message
        if status == JobStatus.PROCESSING and not job.started_at:
            job.started_at = datetime.utcnow()
        if status in (JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED):
            job.completed_at = datetime.utcnow()
        db.commit()


def dispatch_pipeline(job_id: str, source_type: str):
    """
    派发 pipeline：当前用同步路径（run_full_pipeline 立即执行）
    Celery 选型后可改为 .delay()
    """
    if source_type in ("pdf", "docx", "txt"):
        # 同步路径：直接调用完整链路
        # 若要异步，改为 celery_task.delay(job_id)
        run_full_pipeline(job_id, source_type)
    elif source_type in ("mp3", "wav", "m4a"):
        # 占位：等 ASR 选型（task #13）
        update_job_status(
            job_id,
            status=JobStatus.PENDING,
            current_stage=None,
            error_message="ASR 引擎未选型（task #13 暂缓），请稍后再试",
        )
    elif source_type == "image":
        # 占位：等 OCR 选型（task #15）
        update_job_status(
            job_id,
            status=JobStatus.PENDING,
            current_stage=None,
            error_message="OCR 引擎未选型（task #15 暂缓），请稍后再试",
        )
    else:
        raise ValueError(f"不支持的 source_type: {source_type}")


def run_full_pipeline(job_id: str, source_type: str):
    """
    完整 5 步链路：
    1. text_extract：从 storage 取文件 → 纯文本
    2. word_extract：从文本提取英文单词（lemma + 去重）
    3. meaning_lookup：批量查中文释义（来自 words.json 词典）
    4. add_to_library：把单词+meaning 写入目标词库
    5. tts_batch：后台批量生成 mp3（无 API key 时占位）
    """
    try:
        update_job_status(job_id, status=JobStatus.PROCESSING, current_stage=JobStage.TEXT_EXTRACT, progress=5)

        # 取出 job 的 target_library_id（用于后续 TTS 回填限定范围）
        with _get_session() as db:
            job = db.query(Job).filter(Job.id == job_id).first()
            target_library_id = job.target_library_id if job else None

        # ---- 1. text_extract ----
        text = _step_text_extract(job_id, source_type)
        if text is None:
            return  # 失败已记录
        update_job_status(job_id, result={"text_length": len(text), "text_preview": text[:200]})
        logger.info(f"[{job_id}] text_extract done: {len(text)} chars")

        # ---- 2. word_extract ----
        update_job_status(job_id, current_stage=JobStage.LEMMA, progress=25)
        from .word_extract import extract_words
        words = extract_words(text)
        if not words:
            update_job_status(
                job_id,
                status=JobStatus.COMPLETED,
                current_stage=JobStage.DONE,
                progress=100,
                result={"extracted_words": [], "added_count": 0, "message": "未提取到任何英文单词"},
            )
            return
        update_job_status(job_id, result={"extracted_count": len(words), "words_sample": words[:20]})
        logger.info(f"[{job_id}] word_extract done: {len(words)} unique words")

        # ---- 3. meaning_lookup ----
        from ..services.dictionary import lookup_batch
        meanings = lookup_batch(words)
        known = {w: m for w, m in meanings.items() if m}
        unknown = [w for w, m in meanings.items() if not m]
        update_job_status(
            job_id,
            result={"known_count": len(known), "unknown_count": len(unknown), "unknown_words": unknown[:30]},
        )
        logger.info(f"[{job_id}] meaning_lookup: {len(known)} known, {len(unknown)} unknown")

        # ---- 4. add_to_library ----
        if not known:
            update_job_status(
                job_id,
                status=JobStatus.COMPLETED,
                current_stage=JobStage.DONE,
                progress=90,
                result={"added_count": 0, "message": "所有提取的单词都不在词典里"},
            )
            return

        added_count = _step_add_to_library(job_id, known)
        update_job_status(job_id, result={"added_count": added_count})
        logger.info(f"[{job_id}] add_to_library done: {added_count} words")

        # ---- 5. tts_batch ----
        update_job_status(job_id, current_stage=JobStage.TTS, progress=70)
        tts_results = _step_tts_batch(known, target_library_id=target_library_id)
        update_job_status(
            job_id,
            result={
                "tts_generated": len(tts_results),
                "tts_keys_sample": list(tts_results.items())[:5],
            },
        )
        logger.info(f"[{job_id}] tts_batch done: {len(tts_results)} audios")

        # ---- 完成 ----
        update_job_status(
            job_id,
            status=JobStatus.COMPLETED,
            current_stage=JobStage.DONE,
            progress=100,
        )
    except Exception as e:
        logger.exception(f"[{job_id}] pipeline 失败: {e}")
        update_job_status(
            job_id,
            status=JobStatus.FAILED,
            error_message=str(e)[:500],
        )


def _step_text_extract(job_id: str, source_type: str) -> str | None:
    """从 storage 取文件 → 纯文本"""
    from .text_extract import _extract_pdf, _extract_docx, _extract_txt

    with _get_session() as db:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            logger.error(f"Job {job_id} 不存在")
            return None
        storage_key = job.storage_key

    try:
        storage = get_storage()
        content = storage.download(storage_key)
    except Exception as e:
        update_job_status(job_id, status=JobStatus.FAILED, error_message=f"下载文件失败: {e}")
        return None

    try:
        if source_type == "pdf":
            return _extract_pdf(content)
        elif source_type == "docx":
            return _extract_docx(content)
        elif source_type == "txt":
            return _extract_txt(content)
        else:
            update_job_status(job_id, status=JobStatus.FAILED, error_message=f"未知 source_type: {source_type}")
            return None
    except Exception as e:
        update_job_status(job_id, status=JobStatus.FAILED, error_message=f"文本提取失败: {e}")
        return None


def _step_add_to_library(job_id: str, words_meanings: dict) -> int:
    """把 words_meanings 写入目标词库"""
    with _get_session() as db:
        job = db.query(Job).filter(Job.id == job_id).first()
        if not job:
            return 0
        target_lib_id = job.target_library_id

    if not target_lib_id:
        logger.info(f"[{job_id}] 无 target_library_id，跳过入库")
        return 0

    with _get_session() as db:
        lib = db.query(Library).filter(Library.id == target_lib_id).first()
        if not lib:
            logger.warning(f"[{job_id}] 目标词库不存在: {target_lib_id}")
            return 0
        if lib.is_default:
            logger.warning(f"[{job_id}] 默认词库只读，跳过入库")
            return 0

        existing = {w.word.lower() for w in lib.words}
        added = 0
        next_pos = max([w.position for w in lib.words] + [-1]) + 1

        for word, meaning in words_meanings.items():
            if word.lower() in existing:
                continue
            w = Word(
                library_id=target_lib_id,
                word=word,
                meaning=meaning,
                difficulty=5,
                position=next_pos,
                audio_en="",  # TTS 阶段回填
                audio_zh="",
                audio_en_status=AudioStatus.PENDING,
                audio_zh_status=AudioStatus.PENDING,
            )
            db.add(w)
            existing.add(word.lower())
            next_pos += 1
            added += 1

        # 更新词库元数据
        from ..routers.libraries import _calc_level_count
        from ..models import Library as LibModel
        lib_obj = db.query(LibModel).filter(LibModel.id == target_lib_id).first()
        if lib_obj:
            lib_obj.word_count = next_pos
            lib_obj.level_count = _calc_level_count(next_pos)
        db.commit()
        return added


def _step_tts_batch(words_meanings: dict, *, target_library_id: str | None = None) -> dict:
    """
    批量生成 mp3：每个词生成英文 + 中文释义
    返回 {word_lang: storage_key}
    target_library_id：限定只更新当前词库的 word（避免命中其他库的同名词）
    """
    from .tts import generate_one

    storage = get_storage()
    results = {}
    items = []
    for word, meaning in words_meanings.items():
        items.append((word, "en"))
        items.append((meaning, "zh"))

    total = len(items)
    for i, (text, lang) in enumerate(items):
        try:
            ok, key_or_err = generate_one(text, lang, storage=storage)
            if ok:
                results[f"{text}__{lang}"] = key_or_err
                # 更新对应 word 的 audio_en / audio_zh（限定到当前词库）
                if lang == "en":
                    _update_word_audio(text, audio_en=key_or_err, audio_en_status=AudioStatus.READY, library_id=target_library_id)
                else:
                    _update_meaning_audio(text, audio_zh=key_or_err, audio_zh_status=AudioStatus.READY, library_id=target_library_id)
        except Exception as e:
            logger.warning(f"TTS 失败 ({text}, {lang}): {e}")

    return results


def _update_word_audio(word: str, *, audio_en: str = "", audio_en_status=None, library_id: str | None = None):
    """回填单词的 audio_en 字段（限定到指定词库，避免跨库误更新）"""
    with _get_session() as db:
        q = db.query(Word).filter(Word.word == word.lower())
        if library_id:
            q = q.filter(Word.library_id == library_id)
        w = q.first()
        if w:
            if audio_en:
                w.audio_en = audio_en
            if audio_en_status:
                w.audio_en_status = audio_en_status
            db.commit()


def _update_meaning_audio(meaning: str, *, audio_zh: str = "", audio_zh_status=None, library_id: str | None = None):
    """回填 meaning 对应 word 的 audio_zh 字段（限定到指定词库）"""
    with _get_session() as db:
        q = db.query(Word).filter(Word.meaning == meaning)
        if library_id:
            q = q.filter(Word.library_id == library_id)
        w = q.first()
        if w:
            if audio_zh:
                w.audio_zh = audio_zh
            if audio_zh_status:
                w.audio_zh_status = audio_zh_status
            db.commit()