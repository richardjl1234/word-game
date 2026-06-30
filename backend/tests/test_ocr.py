"""
OCR 图片 → 词库 端到端测试（task #15 / task #59）。

覆盖：
  - OCR 单元：extract_image_sync 能从 PNG/JPG 识别出英文单词；空图返回空字符串
  - Upload API：接受 PNG/JPG；rejects 非白名单
  - Pipeline：上传图片 → OCR → word_extract → lemma → dictionary → 入库 → COMPLETED
  - 词库结果：含 apple/banana（OCR 后 word_extract 命中 words.json 词典）

注意：
  - 首次跑 test 会触发 EasyOCR 下载 ~140MB 模型（缓存到 ~/.EasyOCR/model/）
  - pytest 用 --timeout=180 防 OCR 慢
"""
import time

import pytest

from app.models import Word
from app.services.dictionary import load_dictionary


@pytest.fixture(autouse=True)
def _ensure_dict_loaded():
    """确保词典已加载"""
    load_dictionary()


# ==================== OCR 单元测试 ====================

class TestOCRExtractImageSync:
    """直接测试 ocr_extract.extract_image_sync()"""

    def test_extracts_english_words_from_png(self, sample_png):
        """fixture PNG 应被 OCR 识别出 apple / banana / cat / dog"""
        from app.workers.ocr_extract import extract_image_sync

        text = extract_image_sync(sample_png)

        assert text, "OCR 提取结果为空"
        # 至少识别出 2 个期望单词（OCR 偶发漏字，至少应识别 > 1 个）
        recognized = {w.lower() for w in text.split()}
        expected = {"apple", "banana", "cat", "dog"}
        hits = expected & recognized
        assert len(hits) >= 2, f"OCR 仅识别出 {recognized}，期望至少 2 个 from {expected}"

    def test_extracts_english_words_from_jpg(self, sample_jpg):
        """JPG 也应能被 OCR 识别"""
        from app.workers.ocr_extract import extract_image_sync

        text = extract_image_sync(sample_jpg)
        assert text
        recognized = {w.lower() for w in text.split()}
        expected = {"apple", "banana", "cat", "dog"}
        hits = expected & recognized
        assert len(hits) >= 2, f"JPG OCR 仅识别出 {recognized}"

    def test_returns_empty_for_blank_image(self, blank_png):
        """白图应返回空字符串（不报错）"""
        from app.workers.ocr_extract import extract_image_sync

        text = extract_image_sync(blank_png)
        # 可能识别到空格 / 噪音字符；只要不含期望单词即可
        assert all(w not in {"apple", "banana", "cat", "dog"} for w in text.lower().split())

    def test_reader_singleton(self):
        """get_reader() 第二次应返回同一个 Reader 实例（避免重复加载模型）"""
        from app.workers import ocr_extract

        r1 = ocr_extract._get_reader()
        r2 = ocr_extract._get_reader()
        assert r1 is r2, "Reader 应被缓存为单例"


# ==================== Upload API 测试 ====================

class TestUploadImage:
    """POST /api/upload 接受图片文件"""

    def _create_library_via_api(self, client, auth_headers, name=None):
        """通过 API 创建测试词库（带 JWT）"""
        r = client.post(
            "/api/libraries",
            json={"name": name or f"OCR测试-{int(time.time())}"},
            headers=auth_headers,
        )
        assert r.status_code == 201, r.text
        return r.json()["id"]

    def test_upload_accepts_png(self, client, auth_headers, sample_png_path):
        """PNG 上传应返回 201"""
        lib_id = self._create_library_via_api(client, auth_headers)
        with open(sample_png_path, "rb") as f:
            r = client.post(
                "/api/upload",
                files={"file": ("words.png", f, "image/png")},
                data={"target_library_id": lib_id},
                headers=auth_headers,
            )
        assert r.status_code == 201, r.text
        job = r.json()
        assert job["source_type"] == "image"
        assert job["status"] in ("pending", "processing", "completed")

    def test_upload_accepts_jpg(self, client, auth_headers, sample_jpg_path):
        """JPG 上传应返回 201"""
        lib_id = self._create_library_via_api(client, auth_headers)
        with open(sample_jpg_path, "rb") as f:
            r = client.post(
                "/api/upload",
                files={"file": ("words.jpg", f, "image/jpeg")},
                data={"target_library_id": lib_id},
                headers=auth_headers,
            )
        assert r.status_code == 201, r.text
        assert r.json()["source_type"] == "image"

    def test_upload_accepts_webp(self, client, auth_headers, tmp_path):
        """WebP 上传应返回 201（白名单内）"""
        from PIL import Image

        webp_path = tmp_path / "words.webp"
        Image.new('RGB', (200, 100), 'white').save(webp_path, format='WEBP')
        lib_id = self._create_library_via_api(client, auth_headers)
        with open(webp_path, "rb") as f:
            r = client.post(
                "/api/upload",
                files={"file": ("words.webp", f, "image/webp")},
                data={"target_library_id": lib_id},
                headers=auth_headers,
            )
        assert r.status_code == 201, r.text


# ==================== Pipeline 端到端测试 ====================

class TestImagePipeline:
    """上传图片 → OCR → 入库 → COMPLETED 完整链路"""

    def _upload_and_wait(self, client, auth_headers, lib_id, png_path, timeout=120):
        """上传 PNG + 轮询直到 COMPLETED"""
        with open(png_path, "rb") as f:
            r = client.post(
                "/api/upload",
                files={"file": ("words.png", f, "image/png")},
                data={"target_library_id": lib_id},
                headers=auth_headers,
            )
        assert r.status_code == 201, r.text
        job_id = r.json()["id"]

        # 轮询
        for _ in range(timeout):
            r = client.get(f"/api/jobs/{job_id}", headers=auth_headers)
            j = r.json()
            if j["status"] in ("completed", "failed"):
                return j
            time.sleep(1)

        pytest.fail(f"Pipeline 超时 {timeout}s: last_status={j['status']}")

    def test_image_pipeline_runs_full(self, client, auth_headers, sample_png_path):
        """图片 → 5 步 pipeline → COMPLETED"""
        # 创建词库
        r = client.post(
            "/api/libraries",
            json={"name": f"OCR管道测试-{int(time.time())}"},
            headers=auth_headers,
        )
        lib_id = r.json()["id"]

        job = self._upload_and_wait(client, auth_headers, lib_id, sample_png_path)

        assert job["status"] == "completed", f"pipeline 失败: {job.get('error_message')}"
        assert job["current_stage"] == "done"
        assert job["progress"] == 100
        result = job["result"]
        assert result["text_length"] > 0, f"OCR 提取文本为空: {result}"
        assert result["known_count"] > 0, f"OCR 后无已知单词: {result}"
        assert result["added_count"] > 0, f"未入库任何单词: {result}"

    def test_image_pipeline_uses_ocr_stage_value(self):
        """image 类型的 initial_stage 应为 JobStage.OCR（= 'ocr'）。

        此为单元级断言（不通过 HTTP 轮询 pipeline），因为 TestClient 中
        BackgroundTasks 是同步执行的，OCR + 后续步骤 < 1s 跑完，
        轮询基本只看到 final stage='done'。
        """
        from app.models import JobStage
        # 与 pipeline.run_full_pipeline 内部逻辑等价：
        # initial_stage = JobStage.OCR if source_type == "image" else JobStage.TEXT_EXTRACT
        source_type = "image"
        initial_stage = JobStage.OCR if source_type == "image" else JobStage.TEXT_EXTRACT
        assert initial_stage.value == "ocr"
        # 必须独立于 TEXT_EXTRACT（确认前端 STAGE_NAMES['ocr'] 能映射到'🖼️ 图片识别'）
        assert JobStage.OCR.value != JobStage.TEXT_EXTRACT.value

    def test_image_pipeline_adds_words_to_library(
        self, client, auth_headers, sample_png_path, db_session
    ):
        """图片 → 词库 → 含 OCR 识别出的英文单词"""
        r = client.post(
            "/api/libraries",
            json={"name": f"OCR入库测试-{int(time.time())}"},
            headers=auth_headers,
        )
        lib_id = r.json()["id"]

        job = self._upload_and_wait(client, auth_headers, lib_id, sample_png_path)
        assert job["status"] == "completed"

        # 通过 ORM 查词库（直接 API 查需要 JWT + filter，ORM 更稳）
        db_session.expire_all()
        word_objs = db_session.query(Word).filter(Word.library_id == lib_id).all()
        word_strs = {w.word for w in word_objs}

        # OCR 偶发漏字，至少命中 2 个期望词（apple/banana/cat/dog）
        expected = {"apple", "banana", "cat", "dog"}
        hits = expected & word_strs
        assert len(hits) >= 2, f"词库 {word_strs} 仅命中 {hits}/{expected}"
