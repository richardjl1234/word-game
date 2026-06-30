"""
TTS worker（task #31）：
- 复用 MiniMax TTS（与 generate_voices.py 同一 API）
- 配置来源（优先级从高到低）：
  1. 环境变量 MINIMAX_API_KEY / MINIMAX_GROUP_ID
  2. game/js/config.js 里的 window.MINIMAX_CONFIG
- API key 缺失时：生成占位 mp3（合法 mp3 frame，浏览器可播放静音），保证 pipeline 不中断
- 输出：写入 LocalStorage（开发）或 S3（生产）

设计：
- 同步函数 `generate_one(text, lang) -> (success, audio_key_or_error)`
- Celery 任务 `tts_generate_task`（暂未启用，用 BackgroundTasks 调同步版本）
"""
import json
import logging
import os
import re
import time
from pathlib import Path
from typing import Dict, Optional, Tuple

logger = logging.getLogger(__name__)

# MiniMax TTS 端点
TTS_URL = "https://api.minimax.chat/v1/t2a_v2"

# 默认 TTS 参数（与 game/js/config.example.js 对齐）
DEFAULT_TTS_CONFIG = {
    "model": "speech-2.8-hd",
    "sampleRate": 32000,
    "bitrate": 128000,
    "format": "mp3",
    "defaults": {"speed": 0.85, "pitch": 2, "vol": 1.0},
    "voices": {
        "en": "English_radiant_girl",
        "zh": "Chinese (Mandarin)_Warm_Bestie",
    },
}

# 重试参数
MAX_RETRIES = 3
BACKOFF_BASE = 2
RPM_STATUS_CODES = {1002, 1004, 1039}
RPM_BACKOFF = 60

# ----- 配置加载（一次性）-----
_config_cache: Optional[Dict] = None
_api_key_cache: Optional[str] = None
_group_id_cache: Optional[str] = None


def _load_config_from_js() -> Optional[Dict]:
    """从 game/js/config.js 解析 TTS 配置（正则提取，容错 JS 注释）"""
    project_root = Path(__file__).resolve().parents[3]
    config_js = project_root / "game" / "js" / "config.js"
    if not config_js.exists():
        return None
    try:
        content = config_js.read_text(encoding="utf-8")
        # 去掉 JS 注释（// ...）
        content = re.sub(r"//[^\n]*", "", content)
        # 找到 window.MINIMAX_CONFIG = { ... } 的 JSON 部分
        m = re.search(r"window\.MINIMAX_CONFIG\s*=\s*(\{.*?\n\});", content, re.DOTALL)
        if not m:
            return None
        # 直接用 json.loads（key 不带引号的话加引号）
        js_obj_str = m.group(1)
        # JS 字面量 → JSON：给未引号的 key 加双引号
        json_str = re.sub(r"([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:", r'\1"\2":', js_obj_str)
        return json.loads(json_str)
    except Exception as e:
        logger.warning(f"解析 config.js 失败: {e}")
        return None


def get_api_key() -> str:
    """获取 MiniMax API Key（优先环境变量）"""
    global _api_key_cache
    if _api_key_cache is not None:
        return _api_key_cache
    _api_key_cache = os.environ.get("MINIMAX_API_KEY", "") or _extract_from_js("apiKey")
    return _api_key_cache


def get_group_id() -> str:
    """获取 MiniMax Group ID（优先环境变量）"""
    global _group_id_cache
    if _group_id_cache is not None:
        return _group_id_cache
    _group_id_cache = os.environ.get("MINIMAX_GROUP_ID", "") or _extract_from_js("groupId")
    return _group_id_cache


def _extract_from_js(key: str) -> str:
    """从 config.js 提取某个字段的值（字符串字面量）"""
    cfg = _load_config_from_js()
    if not cfg:
        return ""
    val = cfg.get(key, "")
    return str(val).strip().strip("'\"")


def get_tts_config() -> Dict:
    """获取 TTS 配置（合并默认值 + config.js 覆盖）"""
    global _config_cache
    if _config_cache is not None:
        return _config_cache
    cfg = json.loads(json.dumps(DEFAULT_TTS_CONFIG))  # 深拷贝
    js_cfg = _load_config_from_js()
    if js_cfg and "tts" in js_cfg:
        # 浅合并（用户可覆盖 voices / defaults）
        for k, v in js_cfg["tts"].items():
            if isinstance(v, dict) and k in cfg:
                cfg[k].update(v)
            else:
                cfg[k] = v
    _config_cache = cfg
    return cfg


def _call_tts(text: str, voice_id: str, tts_cfg: Dict) -> Tuple[bool, bytes | str, int]:
    """调用 MiniMax TTS（同步），返回 (success, audio_bytes_or_error, base_resp_code)"""
    api_key = get_api_key()
    if not api_key:
        return False, "MINIMAX_API_KEY 未设置", 0
    payload = {
        "model": tts_cfg["model"],
        "text": text,
        "stream": False,
        "voice_setting": {
            "voice_id": voice_id,
            "speed": tts_cfg["defaults"]["speed"],
            "pitch": tts_cfg["defaults"]["pitch"],
            "vol": tts_cfg["defaults"]["vol"],
        },
        "audio_setting": {
            "sample_rate": tts_cfg["sampleRate"],
            "bitrate": tts_cfg["bitrate"],
            "format": tts_cfg["format"],
        },
    }
    try:
        import requests
        resp = requests.post(
            TTS_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=30,
        )
        if resp.status_code == 200:
            data = resp.json()
            audio_hex = data.get("data", {}).get("audio", "")
            base_code = data.get("base_resp", {}).get("status_code", 0)
            base_msg = data.get("base_resp", {}).get("status_msg", "")
            if not audio_hex:
                return False, f"业务错误 code={base_code}: {base_msg}", base_code
            return True, bytes.fromhex(audio_hex), 0
        try:
            base = resp.json().get("base_resp", {})
            err = base.get("status_msg", resp.text[:200])
            code = base.get("status_code", 0)
        except Exception:
            err = resp.text[:200]
            code = 0
        return False, f"HTTP {resp.status_code}: {err}", code
    except Exception as e:
        return False, f"网络异常: {e}", 0


def _is_rate_limited(err: str, code: int) -> bool:
    if code in RPM_STATUS_CODES:
        return True
    s = err.lower() if isinstance(err, str) else ""
    return "429" in err or "rate limit" in s or "rpm" in s or "quota" in s


# 最小的合法 mp3 文件（ID3 header + 1 frame silence, ~ 80 字节）
# 仅供无 API key 时占位 — 浏览器能识别但播放静音
PLACEHOLDER_MP3 = (
    b"ID3\x04\x00\x00\x00\x00\x00\x00"  # ID3v2 header
    b"\xff\xfb\x90\x00" + b"\x00" * 100  # 一个 MP3 frame (MPEG-1 Layer 3, 128kbps, 44.1kHz, silence)
)


def _save_placeholder(text: str, lang: str, storage) -> str:
    """无 API key 时生成占位 mp3，写入 storage，返回 audio_key"""
    # 中文用 meaning hash（与前端一致）；英文用 word
    if lang == "en":
        key_name = text.lower().replace(" ", "_")
    else:
        # 用文本的稳定 hash（避免文件名中文）
        import hashlib
        key_name = hashlib.md5(text.encode("utf-8")).hexdigest()[:8]

    storage_key = f"audio/{lang}/{key_name}.mp3"
    try:
        storage.upload(storage_key, PLACEHOLDER_MP3, content_type="audio/mpeg")
        logger.debug(f"占位 mp3 写入: {storage_key} ({lang}, {text[:20]})")
    except Exception as e:
        logger.warning(f"占位 mp3 写入失败: {e}")
        return ""
    return storage_key


def generate_one(text: str, lang: str, *, storage=None) -> Tuple[bool, str]:
    """
    生成单个音频（带重试 + 占位 fallback）。
    返回 (success, audio_storage_key_or_error_message)
    """
    if not text:
        return False, "空文本"

    tts_cfg = get_tts_config()
    voice_id = tts_cfg["voices"]["en" if lang == "en" else "zh"]

    # 无 API key → 占位
    api_key = get_api_key()
    if not api_key:
        if storage is None:
            from ..storage import get_storage
            storage = get_storage()
        key = _save_placeholder(text, lang, storage)
        return (True, key) if key else (False, "占位 mp3 写入失败")

    # 有 API key → 真实调用
    for attempt in range(MAX_RETRIES):
        ok, data, code = _call_tts(text, voice_id, tts_cfg)
        if ok:
            if storage is None:
                from ..storage import get_storage
                storage = get_storage()
            # 命名规则
            if lang == "en":
                key_name = text.lower().replace(" ", "_")
            else:
                import hashlib
                key_name = hashlib.md5(text.encode("utf-8")).hexdigest()[:8]
            storage_key = f"audio/{lang}/{key_name}.mp3"
            try:
                storage.upload(storage_key, data, content_type="audio/mpeg")
                return True, storage_key
            except Exception as e:
                return False, f"存储失败: {e}"

        # 限流退避
        if _is_rate_limited(data if isinstance(data, str) else "", code):
            if code in RPM_STATUS_CODES:
                wait = RPM_BACKOFF
            else:
                wait = BACKOFF_BASE ** attempt
            logger.info(f"  [backoff {wait}s] {text[:30]} ({data})")
            time.sleep(wait)
            continue

        # 其他错误不重试
        return False, data if isinstance(data, str) else "未知错误"

    return False, "重试耗尽"


def generate_batch(items: list, *, storage=None) -> Dict[str, str]:
    """
    批量生成：items = [(text, lang), ...]
    返回 {text_lang: storage_key}（失败项不包含）
    """
    results = {}
    for text, lang in items:
        ok, key = generate_one(text, lang, storage=storage)
        if ok:
            results[f"{text}__{lang}"] = key
    return results