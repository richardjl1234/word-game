"""
word_extract worker（task #29）：
- 输入：纯文本（来自 text_extract）
- 输出：去重 + 词形还原后的英文单词列表
- 处理：
  1. 用正则提取纯英文单词（去除标点、数字、中文）
  2. 转小写
  3. 去重（保持首次出现顺序）
  4. 词形还原（books → book）
  5. 长度过滤（2-25 字母，太短/太长的可能是噪声）

设计：
- 同步函数 `extract_words(text)` 用于测试 + pipeline
- Celery 任务 `extract_words_task` 包装（暂用 BackgroundTasks 调用同步版本）
"""
import logging
import re
from typing import List

from .lemma import lemmatize_word

logger = logging.getLogger(__name__)

# 匹配连续英文字母（2-25 字符）
_WORD_RE = re.compile(r"\b[a-zA-Z]{2,25}\b")

# 常见停用词（无学习价值）
_STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "if", "then", "else", "when",
    "at", "by", "for", "with", "about", "against", "between", "into",
    "through", "during", "before", "after", "above", "below", "to",
    "of", "from", "up", "down", "in", "out", "on", "off", "over", "under",
    "again", "further", "once", "here", "there", "all", "any", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "s", "t",
    "can", "will", "just", "don", "should", "now", "i", "me", "my", "myself",
    "we", "our", "ours", "ourselves", "you", "your", "yours", "yourself",
    "yourselves", "he", "him", "his", "himself", "she", "her", "hers",
    "herself", "it", "its", "itself", "they", "them", "their", "theirs",
    "themselves", "what", "which", "who", "whom", "this", "that", "these",
    "those", "am", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "having", "do", "does", "did", "doing", "would",
    "could", "should", "ought", "i'm", "you're", "he's", "she's", "it's",
    "we're", "they're", "i've", "you've", "we've", "they've", "i'd",
    "you'd", "he'd", "she'd", "we'd", "they'd", "i'll", "you'll", "he'll",
    "she'll", "we'll", "they'll", "isn't", "aren't", "wasn't", "weren't",
    "hasn't", "haven't", "hadn't", "doesn't", "don't", "didn't", "won't",
    "wouldn't", "shouldn't", "can't", "cannot", "couldn't", "mustn't",
    "let's", "that's", "who's", "what's", "here's", "there's",
}


def extract_words(
    text: str,
    *,
    apply_lemma: bool = True,
    drop_stop_words: bool = True,
    min_len: int = 2,
    max_len: int = 25,
) -> List[str]:
    """
    从纯文本提取英文单词列表（去重 + 词形还原 + 长度过滤）
    - 返回顺序：按首次出现顺序
    - 大小写：统一转小写
    - lemma：默认开启（books → book）
    """
    if not text:
        return []

    # 1. 正则提取
    raw = _WORD_RE.findall(text)
    # 2. 小写 + 去重（保序）
    seen = set()
    unique = []
    for w in raw:
        wlow = w.lower()
        if wlow not in seen:
            seen.add(wlow)
            unique.append(wlow)

    # 3. 长度过滤
    unique = [w for w in unique if min_len <= len(w) <= max_len]

    # 4. 停用词过滤
    if drop_stop_words:
        before = len(unique)
        unique = [w for w in unique if w not in _STOP_WORDS]
        logger.debug(f"停用词过滤: {before} → {len(unique)}")

    # 5. 词形还原
    if apply_lemma:
        result = []
        for w in unique:
            lemma = lemmatize_word(w) or w
            if lemma not in result:
                result.append(lemma)
        return result

    return unique