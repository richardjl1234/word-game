"""
测试完整 5 步 pipeline：text → words → meanings → library → tts
使用 app fixture（conftest 已 monkeypatch 好 engine / storage / lifespan）
"""
import io
import time
import pytest

from app.models import Job, JobStatus, JobStage, Library, Word
from app.services.dictionary import load_dictionary
from app.workers.pipeline import run_full_pipeline, dispatch_pipeline


@pytest.fixture(autouse=True)
def _ensure_dict_loaded():
    """确保词典已加载（测试间共享缓存）"""
    load_dictionary()


class TestFullPipeline:
    """完整 pipeline 端到端测试（同步执行，不依赖 BackgroundTasks）

    task #36：Library 用 account_id + user_id mirror；上传用 form user_id 兼容老 API
    """
    def test_txt_pipeline_full_success(self, app, client, storage, db_session, auth_headers):
        """
        上传 txt → text → words → meanings → library → tts（占位）→ done
        """
        user_id = "u_pipeline_test"
        # 1. 创建词库
        lib = Library(
            account_id=None,           # 直接 ORM 创建，无 JWT 账号
            user_id=user_id,           # legacy 兼容
            name=f"Pipeline测试-{int(time.time())}",
            is_default=False,
            source="import:txt",
        )
        db_session.add(lib)
        db_session.commit()
        lib_id = lib.id

        # 2. 上传 txt 到 storage
        text = "I have three books and a red apple. The children were running quickly. The cat ate the mouse."
        storage_key = f"uploads/{user_id}/test.txt"
        storage.upload(storage_key, text.encode("utf-8"), content_type="text/plain")

        # 3. 通过 API 上传（触发 BackgroundTasks pipeline；form user_id 兼容）
        files = {"file": ("test.txt", text.encode("utf-8"), "text/plain")}
        data = {"user_id": user_id, "target_library_id": lib_id}
        resp = client.post("/api/upload", files=files, data=data)
        assert resp.status_code == 201, resp.text
        job_id = resp.json()["id"]

        # 4. 等 BackgroundTasks pipeline 完成
        import time as t
        for _ in range(20):
            r = client.get(f"/api/jobs/{job_id}", headers=auth_headers)
            j = r.json()
            if j["status"] in ("completed", "failed"):
                break
            t.sleep(0.2)

        # 5. 验证结果
        r = client.get(f"/api/jobs/{job_id}", headers=auth_headers)
        j = r.json()
        assert j["status"] == "completed", f"pipeline failed: {j.get('error_message')}"
        assert j["progress"] == 100
        assert j["current_stage"] == "done"
        result = j["result"]
        assert result["added_count"] > 0
        assert result["known_count"] > 0

        # 验证词库单词（直接通过 ORM 查，因为 GET /api/libraries/{id}/words 需要 JWT）
        db_session.expire_all()
        word_objs = db_session.query(Word).filter(Word.library_id == lib_id).all()
        word_strs = {w.word for w in word_objs}
        assert "book" in word_strs  # books → book
        assert "child" in word_strs  # children → child
        assert "cat" in word_strs
        assert "apple" in word_strs
        assert "i" not in word_strs
        assert "the" not in word_strs

        # TTS 可能因 config.js 解析失败而跳过（TD-008），不限死必须成功
        words_with_audio = [w for w in word_objs if w.audio_en]
        if len(words_with_audio) == 0:
            import logging
            logging.getLogger(__name__).warning("TTS 未生成 audio_en；不影响 pipeline 功能性验证")

    def test_txt_pipeline_empty_text(self, app, client, storage, db_session, auth_headers):
        """空文本应快速完成，无单词添加"""
        user_id = "u_pipeline_empty"
        lib = Library(user_id=user_id, account_id=None, name=f"Empty-{int(time.time())}")
        db_session.add(lib)
        db_session.commit()

        text = "你好世界 12345 @#$%"
        files = {"file": ("empty.txt", text.encode("utf-8"), "text/plain")}
        data = {"user_id": user_id, "target_library_id": lib.id}
        resp = client.post("/api/upload", files=files, data=data)
        assert resp.status_code == 201
        job_id = resp.json()["id"]

        import time as t
        for _ in range(20):
            r = client.get(f"/api/jobs/{job_id}", headers=auth_headers)
            if r.json()["status"] in ("completed", "failed"):
                break
            t.sleep(0.2)

        r = client.get(f"/api/jobs/{job_id}", headers=auth_headers)
        j = r.json()
        assert j["status"] == "completed"
        assert j["result"]["added_count"] == 0

    def test_txt_pipeline_no_target_library(self, app, client, storage, db_session, auth_headers):
        """无 target_library_id 应仍能跑 pipeline，单词不入库"""
        text = "apple banana cherry"
        files = {"file": ("test.txt", text.encode("utf-8"), "text/plain")}
        data = {"user_id": "u_pipeline_no_lib"}
        resp = client.post("/api/upload", files=files, data=data)
        assert resp.status_code == 201
        job_id = resp.json()["id"]

        import time as t
        for _ in range(20):
            r = client.get(f"/api/jobs/{job_id}", headers=auth_headers)
            if r.json()["status"] in ("completed", "failed"):
                break
            t.sleep(0.2)

        r = client.get(f"/api/jobs/{job_id}", headers=auth_headers)
        j = r.json()
        assert j["status"] == "completed"
        assert j["result"]["extracted_count"] >= 3

    def test_txt_pipeline_dedup_in_library(self, app, client, storage, db_session, auth_headers):
        """已存在词应被跳过"""
        user_id = "u_pipeline_dedup"
        lib = Library(user_id=user_id, account_id=None, name=f"Dedup-{int(time.time())}")
        db_session.add(lib)
        db_session.commit()
        db_session.add(Word(library_id=lib.id, word="book", meaning="书", position=0))
        db_session.commit()

        text = "I have a book and a pen. Another book on the desk."
        files = {"file": ("test.txt", text.encode("utf-8"), "text/plain")}
        data = {"user_id": user_id, "target_library_id": lib.id}
        resp = client.post("/api/upload", files=files, data=data)
        job_id = resp.json()["id"]

        import time as t
        for _ in range(20):
            r = client.get(f"/api/jobs/{job_id}", headers=auth_headers)
            if r.json()["status"] in ("completed", "failed"):
                break
            t.sleep(0.2)

        r = client.get(f"/api/jobs/{job_id}", headers=auth_headers)
        j = r.json()
        assert j["status"] == "completed"
        assert j["result"]["added_count"] >= 1
        assert j["result"]["known_count"] >= 2

        # 通过 ORM 验证 book 只入库一次
        db_session.expire_all()
        words = db_session.query(Word).filter(Word.library_id == lib.id).all()
        book_count = sum(1 for w in words if w.word == "book")
        assert book_count == 1