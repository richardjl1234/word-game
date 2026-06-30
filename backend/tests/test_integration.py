"""
端到端集成测试：
- 上传 TXT 文件 → 直接同步调用 extract_text_sync → 拿到文本
- 文本 → lemma → 单词列表
"""
import io
import pytest


class TestEndToEnd:
    def test_txt_upload_to_extracted_text(self, client, db_session, storage):
        """
        完整流程：上传 TXT → 后端存到 storage → 直接调 extract_text_sync 读 storage → 拿到文本
        """
        from app.models import Job
        from app.workers.text_extract import extract_text_sync

        # 1. 上传
        content = b"Hello world. There are some books on the table. The cat is sleeping."
        files = {"file": ("sample.txt", io.BytesIO(content), "text/plain")}
        data = {"user_id": "u_e2e_001"}
        r = client.post("/api/upload", files=files, data=data)
        assert r.status_code == 201
        job_id = r.json()["id"]

        # 2. 同步调 worker（绕过 celery broker）
        text = extract_text_sync(job_id)
        assert "Hello world" in text
        assert "books" in text
        assert "cat" in text

    def test_text_to_lemma_pipeline(self):
        """
        文本 → lemma 验证（演示 LLM 输出后的处理逻辑）
        假设 LLM 输出 ["books", "running", "went", "in spite of", "Apple"]
        """
        from app.workers.lemma import lemmatize_words_sync

        # 模拟 LLM 输出
        llm_output = ["books", "running", "went", "in spite of", "Apple"]
        result = lemmatize_words_sync(llm_output)

        # books → book（spaCy）/ books fallback（小写化）
        books_entry = next(r for r in result if r["original"] == "books")
        assert books_entry["lemma"] == "book", f"expected 'book', got '{books_entry['lemma']}'"

        # running → run
        run_entry = next(r for r in result if r["original"] == "running")
        assert run_entry["lemma"] == "run"

        # 短语不变
        phrase_entry = next(r for r in result if r["original"] == "in spite of")
        assert phrase_entry["lemma"] == "in spite of"

        # Apple 是专有名词 → Apple
        apple_entry = next(r for r in result if r["original"] == "Apple")
        # spaCy 会把 Apple lemma 成 apple（小写），但 POS_PROPN 时我们返回原值
        assert apple_entry["lemma"] == "Apple", f"expected 'Apple', got '{apple_entry['lemma']}'"

    def test_docx_upload_then_words_added_to_library(self, client, db_session, auth_headers):
        """完整链路：上传 DOCX → 创建词库 → 调 lemma 处理假设 LLM 输出 → 加入词库

        task #36：用 JWT（auth_headers fixture）
        """
        from docx import Document
        from app.workers.lemma import lemmatize_words_sync
        from app.models import Library

        # 1. 创建 docx
        doc = Document()
        doc.add_paragraph("There are many books in this library.")
        buf = io.BytesIO()
        doc.save(buf)
        buf.seek(0)

        # 2. 上传（form user_id 兼容；不传 target_library_id 因为是分别创建的）
        files = {"file": ("doc.docx", buf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        data = {"user_id": "u_e2e_doc_legacy"}  # 兼容老 API
        r = client.post("/api/upload", files=files, data=data)
        assert r.status_code == 201
        job_id = r.json()["id"]

        # 3. 创建目标词库（用 JWT）
        lib_id = client.post(
            "/api/libraries",
            json={"name": "Doc提取测试"},
            headers=auth_headers,
        ).json()["id"]

        # 4. 模拟 LLM 输出
        llm_output = ["books", "library", "in spite of"]
        lemmatized = lemmatize_words_sync(llm_output)
        words = [
            {"word": r["lemma"], "meaning": f"释义：{r['lemma']}"}
            for r in lemmatized
        ]

        # 5. 批量加入词库
        r2 = client.post(f"/api/libraries/{lib_id}/words", json={"words": words}, headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["added"] == 3

        # 6. 验证词库状态
        lib = client.get(f"/api/libraries/{lib_id}", headers=auth_headers).json()
        assert lib["word_count"] == 3
        assert lib["level_count"] == 1

        # 7. 验证单词列表（位置排序）
        words_resp = client.get(f"/api/libraries/{lib_id}/words", headers=auth_headers).json()
        assert len(words_resp) == 3
        word_strs = [w["word"] for w in words_resp]
        assert word_strs[0] == "book"
        assert "library" in word_strs
        assert "in spite of" in word_strs