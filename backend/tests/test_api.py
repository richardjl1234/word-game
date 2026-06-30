"""
API 路由测试：upload + jobs + libraries

task #36 后：
- /api/libraries* 和 /api/upload 需要 JWT 鉴权（auth_headers fixture）
- 老 form user_id 仍兼容（写入 legacy user_id 列），测试保留
"""
import io
import pytest


class TestHealth:
    def test_health(self, client):
        r = client.get("/api/health")
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert "version" in data


class TestUpload:
    def test_upload_txt_success_legacy_user(self, client, storage):
        """上传 TXT（用 form user_id 兼容老前端）"""
        content = b"Hello world. There are some books."
        files = {"file": ("test.txt", io.BytesIO(content), "text/plain")}
        data = {"user_id": "u_test_001"}
        r = client.post("/api/upload", files=files, data=data)
        assert r.status_code == 201, f"upload failed: {r.text}"
        body = r.json()
        assert body["source_type"] == "txt"
        assert body["source_filename"] == "test.txt"
        assert body["source_size_bytes"] == len(content)
        assert body["status"] in ("pending", "processing", "completed")
        assert body["user_id"] == "u_test_001"  # legacy 列写入
        assert "id" in body

    def test_upload_txt_success_with_jwt(self, client, storage, auth_headers, auth_account):
        """用 JWT 上传（推荐）"""
        content = b"Hello world."
        files = {"file": ("test.txt", io.BytesIO(content), "text/plain")}
        r = client.post("/api/upload", files=files, headers=auth_headers)
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["account_id"] == auth_account["account"]["id"]
        assert body["user_id"] is None  # 没传 form user_id

    def test_upload_pdf_success(self, client):
        """上传 PDF（仅校验路由，PDF 内容由 worker 处理）"""
        pdf_bytes = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\nxref\n0 1\n0000000000 65535 f\n%%EOF"
        files = {"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")}
        data = {"user_id": "u_test_002"}
        r = client.post("/api/upload", files=files, data=data)
        assert r.status_code == 201
        assert r.json()["source_type"] == "pdf"

    def test_upload_docx_success(self, client):
        """上传 DOCX"""
        from docx import Document
        doc = Document()
        doc.add_paragraph("Test content")
        buf = io.BytesIO()
        doc.save(buf)
        buf.seek(0)
        files = {"file": ("test.docx", buf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        data = {"user_id": "u_test_003"}
        r = client.post("/api/upload", files=files, data=data)
        assert r.status_code == 201
        assert r.json()["source_type"] == "docx"

    def test_upload_unsupported_type(self, client, auth_headers):
        files = {"file": ("test.exe", io.BytesIO(b"fake"), "application/octet-stream")}
        r = client.post("/api/upload", files=files, headers=auth_headers)
        assert r.status_code == 400
        assert "不支持" in r.json()["detail"]

    def test_upload_empty_file(self, client, auth_headers):
        files = {"file": ("empty.txt", io.BytesIO(b""), "text/plain")}
        r = client.post("/api/upload", files=files, headers=auth_headers)
        assert r.status_code == 400
        assert "空" in r.json()["detail"]

    def test_upload_missing_auth(self, client):
        """既无 JWT 也无 form user_id → 401"""
        files = {"file": ("test.txt", io.BytesIO(b"hello"), "text/plain")}
        r = client.post("/api/upload", files=files)
        assert r.status_code == 401


class TestJobs:
    """★ task #72：jobs 端点已加 JWT 鉴权，需要 auth_headers"""

    def test_get_job_success(self, client, auth_headers):
        files = {"file": ("test.txt", io.BytesIO(b"hello"), "text/plain")}
        r = client.post("/api/upload", files=files, headers=auth_headers)
        job_id = r.json()["id"]
        r2 = client.get(f"/api/jobs/{job_id}", headers=auth_headers)
        assert r2.status_code == 200
        assert r2.json()["id"] == job_id

    def test_get_job_not_found(self, client, auth_headers):
        r = client.get("/api/jobs/nonexistent-id", headers=auth_headers)
        assert r.status_code == 404

    def test_list_jobs_auth_required(self, client):
        """jobs 端点无 token 应返回 401"""
        r = client.get("/api/jobs")
        assert r.status_code == 401, r.text

    def test_list_jobs_by_account(self, client, auth_headers):
        """列出当前账号下的 jobs"""
        files = {"file": ("test.txt", io.BytesIO(b"hello word-game"), "text/plain")}
        client.post("/api/upload", files=files, headers=auth_headers)
        r = client.get("/api/jobs", headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["total"] >= 1
        assert len(body["jobs"]) >= 1


class TestLibraries:
    """task #36：所有端点需要 JWT，list 是当前账号下所有"""
    def test_create_library(self, client, auth_headers):
        r = client.post(
            "/api/libraries",
            json={"name": "人教版初一", "source": "manual"},
            headers=auth_headers,
        )
        assert r.status_code == 201, r.text
        body = r.json()
        assert body["name"] == "人教版初一"
        assert body["is_default"] is False
        assert body["word_count"] == 0
        assert body["level_count"] == 1

    def test_create_library_requires_auth(self, client):
        r = client.post("/api/libraries", json={"name": "x"})
        assert r.status_code == 401

    def test_create_library_duplicate_name(self, client, auth_headers):
        client.post("/api/libraries", json={"name": "BBC"}, headers=auth_headers)
        r = client.post("/api/libraries", json={"name": "BBC"}, headers=auth_headers)
        assert r.status_code == 409

    def test_list_libraries(self, client, auth_headers):
        client.post("/api/libraries", json={"name": "A"}, headers=auth_headers)
        client.post("/api/libraries", json={"name": "B"}, headers=auth_headers)
        r = client.get("/api/libraries", headers=auth_headers)
        assert r.status_code == 200
        assert len(r.json()) == 2

    def test_list_libraries_isolated_per_account(self, client, auth_headers, second_account):
        """A 的词库不应出现在 B 的列表里"""
        client.post("/api/libraries", json={"name": "A-lib"}, headers=auth_headers)
        client.post("/api/libraries", json={"name": "B-lib"}, headers=second_account["headers"])
        libs_a = client.get("/api/libraries", headers=auth_headers).json()
        libs_b = client.get("/api/libraries", headers=second_account["headers"]).json()
        assert len(libs_a) == 1 and libs_a[0]["name"] == "A-lib"
        assert len(libs_b) == 1 and libs_b[0]["name"] == "B-lib"

    def test_add_words(self, client, auth_headers):
        lib_id = client.post("/api/libraries", json={"name": "测试"}, headers=auth_headers).json()["id"]
        words = [{"word": f"word{i}", "meaning": f"单词{i}"} for i in range(60)]
        r = client.post(f"/api/libraries/{lib_id}/words", json={"words": words}, headers=auth_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["added"] == 60
        assert body["skipped"] == 0
        assert body["total"] == 60

        words2 = [{"word": f"extra{i}", "meaning": f"额外{i}"} for i in range(50)]
        r2 = client.post(f"/api/libraries/{lib_id}/words", json={"words": words2}, headers=auth_headers)
        assert r2.json()["total"] == 110

        dup_words = [{"word": "word0", "meaning": "重复"}]
        r3 = client.post(f"/api/libraries/{lib_id}/words", json={"words": dup_words}, headers=auth_headers)
        assert r3.json()["added"] == 0
        assert r3.json()["skipped"] == 1

    def test_get_library_level_count(self, client, auth_headers):
        lib_id = client.post("/api/libraries", json={"name": "Level测试"}, headers=auth_headers).json()["id"]
        words = [{"word": f"w{i}", "meaning": ""} for i in range(49)]
        client.post(f"/api/libraries/{lib_id}/words", json={"words": words}, headers=auth_headers)
        assert client.get(f"/api/libraries/{lib_id}", headers=auth_headers).json()["level_count"] == 1
        client.post(f"/api/libraries/{lib_id}/words", json={"words": [{"word": "w49", "meaning": ""}]}, headers=auth_headers)
        assert client.get(f"/api/libraries/{lib_id}", headers=auth_headers).json()["level_count"] == 1

    def test_delete_library(self, client, auth_headers):
        lib_id = client.post("/api/libraries", json={"name": "to-delete"}, headers=auth_headers).json()["id"]
        r = client.delete(f"/api/libraries/{lib_id}", headers=auth_headers)
        assert r.status_code == 204
        r2 = client.get(f"/api/libraries/{lib_id}", headers=auth_headers)
        assert r2.status_code == 404

    def test_other_account_cannot_access_library(self, client, auth_headers, second_account):
        """B 不能访问 A 创建的词库"""
        lib_id = client.post("/api/libraries", json={"name": "私密"}, headers=auth_headers).json()["id"]
        # B 尝试读 → 403
        r = client.get(f"/api/libraries/{lib_id}", headers=second_account["headers"])
        assert r.status_code == 403
        # B 尝试删 → 403
        r2 = client.delete(f"/api/libraries/{lib_id}", headers=second_account["headers"])
        assert r2.status_code == 403
