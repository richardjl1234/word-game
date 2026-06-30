"""
英→中 词典服务（task #30）：
- 启动时加载 game/data/words.json 为 {word.lower() → meaning} dict
- lookup(word) 返回中文释义；找不到返回 None
- lookup_batch(words) 返回 {word: meaning_or_None}

设计要点：
- 内存 dict，2889 条 ~100KB，一次加载终身缓存
- 不依赖外部 API（无网即可用）
- 支持运行时 reload（热更新 words.json 后调用 load_dictionary(force=True)）
"""
import json
import logging
import threading
from pathlib import Path
from typing import Dict, Optional, Iterable, Tuple

logger = logging.getLogger(__name__)

# 词库 JSON 路径（相对于 backend/ 目录的 project root）
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_WORDS_JSON = _PROJECT_ROOT / "game" / "data" / "words.json"

_dict_cache: Dict[str, str] = {}
_lock = threading.Lock()
_loaded = False


def _do_load() -> Dict[str, str]:
    """从 words.json 加载词典（线程安全）"""
    if not _WORDS_JSON.exists():
        logger.warning(f"词典文件不存在: {_WORDS_JSON}（将返回空 dict）")
        return {}
    try:
        data = json.loads(_WORDS_JSON.read_text(encoding="utf-8"))
        # 支持两种 schema：{words: [...]} 或 直接 [...]
        if isinstance(data, dict) and "words" in data:
            words_list = data["words"]
        elif isinstance(data, list):
            words_list = data
        else:
            logger.warning(f"未识别的 words.json schema")
            return {}

        result = {}
        for w in words_list:
            word = w.get("word", "").strip().lower()
            meaning = w.get("meaning", "").strip()
            if word and meaning and word not in result:
                result[word] = meaning
        logger.info(f"词典加载完成: {len(result)} 个词 from {_WORDS_JSON}")
        return result
    except Exception as e:
        logger.error(f"词典加载失败: {e}")
        return {}


def load_dictionary(force: bool = False) -> Dict[str, str]:
    """
    加载词典到缓存；force=True 重新读盘
    返回当前词典大小
    """
    global _dict_cache, _loaded
    with _lock:
        if force or not _loaded:
            _dict_cache = _do_load()
            _loaded = True
    return _dict_cache


def lookup(word: str) -> Optional[str]:
    """
    查一个词的中文释义。
    返回 None 表示词典里没有（pipeline 会标记为 unknown）。
    """
    if not word:
        return None
    if not _loaded:
        load_dictionary()
    return _dict_cache.get(word.strip().lower())


def lookup_batch(words: Iterable[str]) -> Dict[str, Optional[str]]:
    """批量查询，返回 {word: meaning_or_None}"""
    if not _loaded:
        load_dictionary()
    return {w: _dict_cache.get(w.strip().lower()) for w in words}


def get_dict_stats() -> Tuple[int, bool]:
    """返回 (词条数, 是否已加载) — 调试用"""
    if not _loaded:
        load_dictionary()
    return len(_dict_cache), _loaded