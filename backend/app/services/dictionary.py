"""
英→中 词典服务（task #30）：
- 主词典：game/data/cc-cedict.json（~49k 词条，来自 CC-CEDICT 开源英中词典）
- 补充词典：game/data/words.json（~2.8k 词条，游戏词库，优先级更高覆盖冲突）
- lookup(word) 返回中文释义；找不到返回 None
- lookup_batch(words) 返回 {word: meaning_or_None}

设计要点：
- 内存 dict，一次加载终身缓存
- 不依赖外部 API（无网即可用）
- 支持运行时 reload（热更新文件后调用 load_dictionary(force=True)）
"""
import json
import logging
import threading
from pathlib import Path
from typing import Dict, Optional, Iterable, Tuple

logger = logging.getLogger(__name__)

_PROJECT_ROOT = Path(__file__).resolve().parents[3]
_CC_CEDICT_PATH = _PROJECT_ROOT / "game" / "data" / "cc-cedict.json"
_WORDS_JSON_PATH = _PROJECT_ROOT / "game" / "data" / "words.json"

_dict_cache: Dict[str, str] = {}
_lock = threading.Lock()
_loaded = False


def _do_load() -> Dict[str, str]:
    """
    加载词典（优先级：words.json > CC-CEDICT）
    - 先加载 CC-CEDICT（~49k 词条，覆盖面广但释义可能不够精准）
    - 然后用 words.json 覆盖冲突（2889 词，释义更贴近教育场景）
    两者合并得到最终词典。
    """
    result = {}

    # 1. 加载 CC-CEDICT（主词典）
    if _CC_CEDICT_PATH.exists():
        try:
            data = json.loads(_CC_CEDICT_PATH.read_text(encoding="utf-8"))
            entries = data.get("dictionary", {})
            for word, meanings in entries.items():
                if meanings:
                    # 取第一个释义作为中文翻译
                    result[word.lower().strip()] = meanings[0]
            logger.info(f"CC-CEDICT 加载: {len(entries)} 词条 from {_CC_CEDICT_PATH.name}")
        except Exception as e:
            logger.error(f"CC-CEDICT 加载失败: {e}")
    else:
        logger.warning(f"CC-CEDICT 文件不存在: {_CC_CEDICT_PATH}，跳过")

    # 2. 用 words.json 覆盖（游戏词库的释义更精确）
    if _WORDS_JSON_PATH.exists():
        try:
            data = json.loads(_WORDS_JSON_PATH.read_text(encoding="utf-8"))
            if isinstance(data, dict) and "words" in data:
                words_list = data["words"]
            elif isinstance(data, list):
                words_list = data
            else:
                words_list = []
            overridden = 0
            for w in words_list:
                word = w.get("word", "").strip().lower()
                meaning = w.get("meaning", "").strip()
                if word and meaning:
                    if word in result:
                        overridden += 1
                    result[word] = meaning
            logger.info(f"words.json 覆盖: {len(words_list)} 词（{overridden} 个覆盖 CC-CEDICT）")
        except Exception as e:
            logger.error(f"words.json 加载失败: {e}")
    else:
        logger.warning(f"words.json 文件不存在: {_WORDS_JSON_PATH}，跳过")

    logger.info(f"词典最终加载完成: {len(result)} 个词")
    return result


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