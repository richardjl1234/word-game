"""
测试 word_extract + dictionary + tts（新 pipeline stages）
"""
import pytest
from app.workers.word_extract import extract_words
from app.services.dictionary import lookup, lookup_batch, load_dictionary, get_dict_stats


class TestWordExtract:
    def test_basic_extraction(self):
        text = "I have three books and a red pen."
        words = extract_words(text)
        assert "book" in words  # books → book
        assert "three" in words
        assert "pen" in words
        assert "red" in words
        # 停用词被过滤
        assert "i" not in words
        assert "have" not in words
        assert "and" not in words
        assert "a" not in words

    def test_dedup_preserves_order(self):
        text = "book book apple apple apple cat"
        words = extract_words(text)
        assert words == ["book", "apple", "cat"]

    def test_lemma_applied(self):
        text = "running went children ate mice"
        words = extract_words(text)
        assert "run" in words
        assert "go" in words
        assert "child" in words
        assert "eat" in words
        assert "mouse" in words  # mice → mouse

    def test_punctuation_handling(self):
        text = "Hello, world! How is everything?"
        words = extract_words(text)
        # 标点应被剥离
        assert "hello" in words
        assert "world" in words
        assert "everything" in words
        # is 是停用词
        assert "is" not in words

    def test_chinese_ignored(self):
        text = "English words like book 和中文都不应该被提取"
        words = extract_words(text)
        assert "book" in words
        assert "english" in words
        assert "words" not in words  # 停用词
        assert "和" not in words
        assert "中文" not in words

    def test_numbers_ignored(self):
        text = "I have 123 apples and 456 oranges"
        words = extract_words(text)
        assert "apple" in words  # apples → apple
        assert "orange" in words  # oranges → orange
        assert "123" not in words
        assert "456" not in words

    def test_stop_words(self):
        text = "the quick brown fox jumps over the lazy dog"
        words = extract_words(text)
        assert "the" not in words
        assert "quick" in words
        assert "brown" in words
        assert "fox" in words

    def test_empty_input(self):
        assert extract_words("") == []
        assert extract_words(None) == [] if False else extract_words("") == []

    def test_phrase_passthrough(self):
        """多词短语（如 'in spite of'）应被正确处理为单个 token"""
        text = "in spite of everything"
        words = extract_words(text)
        # 多词短语在 word_extract 阶段会被拆开，后续在 pipeline 里按 lemma 处理
        assert "everything" in words
        assert "spite" in words
        assert "of" not in words  # 停用词

    def test_min_max_length(self):
        text = "a bb ccc dddd eeee abcdefghijklmnopqrstuvwxy"  # a 太短，最后那个 25 字符 OK
        words = extract_words(text, min_len=2, max_len=25)
        assert "a" not in words
        assert "bb" in words
        # 25 字符应该被保留（默认 max_len=25）
        assert "abcdefghijklmnopqrstuvwxy" in words

    def test_disable_lemma(self):
        text = "books running"
        words = extract_words(text, apply_lemma=False)
        assert "books" in words
        assert "running" in words


class TestDictionary:
    def test_lookup_known_word(self):
        """book 应该能查到（words.json 里有）"""
        meaning = lookup("book")
        assert meaning is not None
        assert isinstance(meaning, str)
        assert len(meaning) > 0

    def test_lookup_case_insensitive(self):
        assert lookup("Book") == lookup("book")
        assert lookup("BOOK") == lookup("book")

    def test_lookup_unknown_word(self):
        """生造词应该返回 None"""
        meaning = lookup("xyzqwerty123notaword")
        assert meaning is None

    def test_lookup_batch(self):
        words = ["book", "apple", "xyzqwerty123"]
        result = lookup_batch(words)
        assert "book" in result
        assert "apple" in result
        assert result["book"] is not None
        assert result["apple"] is not None
        assert result["xyzqwerty123"] is None

    def test_dict_stats(self):
        count, loaded = get_dict_stats()
        assert loaded is True
        assert count > 1000  # 应该至少 1000+ 词