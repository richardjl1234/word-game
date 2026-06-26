"""
词形还原 worker（task #18）
==========================

输入：单词/短语列表
输出：lemma 后的单词列表（短语跳过）

支持两种后端（自动选择）：
1. **spaCy**（en_core_web_sm，~12MB）— 准确率高，模型大
2. **纯 Python fallback** — 无依赖，~300 条不规则词典 + 规则，覆盖 80% 常见词

例：
- books → book / running → run / went → go / ate → eat
- 短语如 "in spite of" / "arrive in" / "good at" 跳过
- 专有名词 Apple / IBM 跳过 lemma
"""
import logging
from functools import lru_cache

from ..celery_app import celery_app
from ..database import SessionLocal
from ..models import Job, JobStatus, JobStage
from .pipeline import update_job_status

logger = logging.getLogger(__name__)


# ============================================================
# spaCy 加载（可选，失败自动回退）
# ============================================================

@lru_cache(maxsize=1)
def _get_nlp():
    """懒加载 spaCy 模型（首次调用下载/加载，后续复用）"""
    try:
        import spacy
        from ..config import settings
        nlp = spacy.load(settings.SPACY_MODEL)
        logger.info(f"spaCy 模型加载成功: {settings.SPACY_MODEL}")
        return nlp
    except Exception as e:
        logger.warning(f"spaCy 模型加载失败: {e}。回退到纯 Python lemma。")
        return None


def _is_phrase(word: str) -> bool:
    """含空格视为短语（不 lemma）"""
    return " " in word.strip()


def _is_proper_noun(word: str) -> bool:
    """专有名词首字母大写 + 非全大写（IBM 等缩写不算）"""
    if not word:
        return False
    return word[0].isupper() and not word.isupper()


# ============================================================
# 纯 Python lemma 引擎
# ============================================================

# 不规则名词复数 → 单数
_IRREGULAR_NOUNS = {
    # 经典不规则
    "children": "child", "men": "man", "women": "woman",
    "people": "person", "feet": "foot", "teeth": "tooth",
    "mice": "mouse", "geese": "goose", "oxen": "ox",
    "data": "datum", "media": "medium", "criteria": "criterion",
    "phenomena": "phenomenon", "analyses": "analysis",
    "theses": "thesis", "diagnoses": "diagnosis",
    "fungi": "fungus", "cacti": "cactus", "nuclei": "nucleus",
    "radii": "radius", "syllabi": "syllabus", "alumni": "alumnus",
    # 不可数 / 单复数同形（保持原样）
    "sheep": "sheep", "deer": "deer", "fish": "fish", "species": "species",
    "aircraft": "aircraft", "series": "series", "means": "means",
    "news": "news", "mathematics": "mathematics", "physics": "physics",
    # y → ies 转换
    "babies": "baby", "cities": "city", "countries": "country",
    "libraries": "library", "families": "family", "stories": "story",
    "studies": "study", "tries": "try", "flies": "fly",
    "parties": "party", "theories": "theory", "categories": "category",
    "memories": "memory", "histories": "history", "mysteries": "mystery",
    # -f/-fe → -ves
    "lives": "life", "wives": "wife", "knives": "knife",
    "wolves": "wolf", "leaves": "leaf", "halves": "half",
    "selves": "self", "shelves": "shelf", "thieves": "thief",
    "loaves": "loaf", "calves": "calf",
    # 常见 -es
    "boxes": "box", "buses": "bus", "classes": "class",
    "dishes": "dish", "wishes": "wish", "buses": "bus",
    "heroes": "hero", "potatoes": "potato", "tomatoes": "tomato",
    "echoes": "echo", "vetoes": "veto", "torpedoes": "torpedo",
}

# 不规则动词过去式 / 现在分词 → 动词原形
_IRREGULAR_VERBS = {
    # be
    "am": "be", "is": "be", "are": "be", "was": "be", "were": "be",
    "been": "be", "being": "be",
    # have
    "has": "have", "had": "have", "having": "have",
    # do
    "does": "do", "did": "do", "done": "do", "doing": "do",
    # go
    "goes": "go", "went": "go", "gone": "go", "going": "go",
    # say
    "says": "say", "said": "say", "saying": "say",
    # make
    "makes": "make", "made": "make", "making": "make",
    # get
    "gets": "get", "got": "get", "gotten": "get", "getting": "get",
    # take
    "takes": "take", "took": "take", "taken": "take", "taking": "take",
    # come
    "comes": "come", "came": "come", "coming": "come",
    # see
    "sees": "see", "saw": "see", "seen": "see", "seeing": "see",
    # know
    "knows": "know", "knew": "know", "known": "know", "knowing": "know",
    # give
    "gives": "give", "gave": "give", "given": "give", "giving": "give",
    # think
    "thinks": "think", "thought": "think", "thinking": "think",
    # tell
    "tells": "tell", "told": "tell", "telling": "tell",
    # find
    "finds": "find", "found": "find", "finding": "find",
    # feel
    "feels": "feel", "felt": "feel", "feeling": "feel",
    # bring
    "brings": "bring", "brought": "bring", "bringing": "bring",
    # buy
    "buys": "buy", "bought": "buy", "buying": "buy",
    # run
    "runs": "run", "ran": "run", "running": "run",
    # eat
    "eats": "eat", "ate": "eat", "eaten": "eat", "eating": "eat",
    # drink
    "drinks": "drink", "drank": "drink", "drunk": "drink", "drinking": "drink",
    # swim
    "swims": "swim", "swam": "swim", "swum": "swim", "swimming": "swim",
    # sing
    "sings": "sing", "sang": "sing", "sung": "sing", "singing": "sing",
    # ring
    "rings": "ring", "rang": "ring", "rung": "ring", "ringing": "ring",
    # read
    "reads": "read", "reading": "read",  # read 同形（发音不同）
    # write
    "writes": "write", "wrote": "write", "written": "write", "writing": "write",
    # speak
    "speaks": "speak", "spoke": "speak", "spoken": "speak", "speaking": "speak",
    # break
    "breaks": "break", "broke": "break", "broken": "break", "breaking": "break",
    # choose
    "chooses": "choose", "chose": "choose", "chosen": "choose", "choosing": "choose",
    # drive
    "drives": "drive", "drove": "drive", "driven": "drive", "driving": "drive",
    # ride
    "rides": "ride", "rode": "ride", "ridden": "ride", "riding": "ride",
    # rise
    "rises": "rise", "rose": "rise", "risen": "rise", "rising": "rise",
    # write/ride/rise are above
    # begin
    "begins": "begin", "began": "begin", "begun": "begin", "beginning": "begin",
    # sing
    # drink
    # swim
    # fall
    "falls": "fall", "fell": "fall", "fallen": "fall", "falling": "fall",
    # fly
    "flies": "fly", "flew": "fly", "flown": "fly", "flying": "fly",
    # grow
    "grows": "grow", "grew": "grow", "grown": "grow", "growing": "grow",
    # know
    # throw
    "throws": "throw", "threw": "throw", "thrown": "throw", "throwing": "throw",
    # blow
    "blows": "blow", "blew": "blow", "blown": "blow", "blowing": "blow",
    # show
    "shows": "show", "showed": "show", "shown": "show", "showing": "show",
    # teach
    "teaches": "teach", "taught": "teach", "teaching": "teach",
    # catch
    "catches": "catch", "caught": "catch", "catching": "catch",
    # think
    # bring
    # buy
    # fight
    "fights": "fight", "fought": "fight", "fighting": "fight",
    # sleep
    "sleeps": "sleep", "slept": "sleep", "sleeping": "sleep",
    # keep
    "keeps": "keep", "kept": "keep", "keeping": "keep",
    # leave
    "leaves": "leave", "left": "leave", "leaving": "leave",
    # meet
    "meets": "meet", "met": "meet", "meeting": "meet",
    # pay
    "pays": "pay", "paid": "pay", "paying": "pay",
    # send
    "sends": "send", "sent": "send", "sending": "send",
    # spend
    "spends": "spend", "spent": "spend", "spending": "spend",
    # win
    "wins": "win", "won": "win", "winning": "win",
    # lend
    "lends": "lend", "lent": "lend", "lending": "lend",
    # build
    "builds": "build", "built": "build", "building": "build",
    # lose
    "loses": "lose", "lost": "lose", "losing": "lose",
    # sell
    "sells": "sell", "sold": "sell", "selling": "sell",
    # understand
    "understands": "understand", "understood": "understand", "understanding": "understand",
    # stand
    "stands": "stand", "stood": "stand", "standing": "stand",
    # sit
    "sits": "sit", "sat": "sit", "sitting": "sit",
    # wear
    "wears": "wear", "wore": "wear", "worn": "wear", "wearing": "wear",
    # put
    "puts": "put", "putting": "put",
    # cut
    "cuts": "cut", "cutting": "cut",
    # hit
    "hits": "hit", "hitting": "hit",
    # let
    "lets": "let", "letting": "let",
    # set
    "sets": "set", "setting": "set",
    # shut
    "shuts": "shut", "shutting": "shut",
    # cost
    "costs": "cost", "costing": "cost",
    # hurt
    "hurts": "hurt", "hurting": "hurt",
    # spread
    "spreads": "spread", "spreading": "spread",
    # 常见三单 -ies
    "tries": "try", "carries": "carry", "copies": "copy",
    "studies": "study", "replies": "reply", "denies": "deny",
    "applies": "apply", "relies": "rely", "implies": "imply",
    "marries": "marry", "hurries": "hurry", "worries": "worry",
    "empties": "empty", "dries": "dry", "fries": "fry", "spies": "spy",
}

# 不规则形容词 / 比较级
_IRREGULAR_ADJECTIVES = {
    # 比较级 / 最高级 → 原级
    "better": "good", "best": "good",
    "worse": "bad", "worst": "bad",
    "further": "far", "furthest": "far",
    "farther": "far", "farthest": "far",
    # 不可比形容词保持原样（无比较级）
    "unique": "unique", "perfect": "perfect", "excellent": "excellent",
    "awful": "awful", "extreme": "extreme", "dead": "dead",
}

# 词性检测关键词（不严格，仅辅助）
_VERB_PREFIXES = ("re", "un", "dis", "over", "under", "mis", "pre", "post",
                  "out", "up", "down", "back", "fore", "with", "be", "co")


def _lemma_noun(word: str) -> str | None:
    """处理名词复数 → 单数；返回 None 表示未匹配"""
    w = word.lower()

    # 词典优先
    if w in _IRREGULAR_NOUNS:
        return _IRREGULAR_NOUNS[w]

    # -ies → -y（y 结尾的复数）
    if w.endswith("ies") and len(w) > 4 and w[-4] not in "aeiou":
        return w[:-3] + "y"

    # -ves → -f / -fe
    if w.endswith("ves") and len(w) > 4:
        base = w[:-3] + "f"
        if base in _IRREGULAR_NOUNS.values() or base in ("life", "wife", "knife", "wolf", "leaf", "half", "self", "shelf", "thief", "loaf", "calf"):
            return base
        # 也尝试 -fe
        return w[:-3] + "fe"

    # -es 结尾（boxes, dishes, classes, buses）
    if w.endswith("es") and len(w) > 3:
        base = w[:-2]
        # 检查 -es 是 -s 复数还是独立 -e 结尾动词
        if base.endswith(("ss", "sh", "ch", "x", "z", "o")):
            return base
        # buses, gases
        if w.endswith("ses") and len(w) > 4:
            return w[:-2]  # buses → bus

    # 通用 -s 去复数（cars, dogs, books）
    if w.endswith("s") and not w.endswith("ss") and len(w) > 3:
        # 避免把 is / has / was / 等动词误判
        if w in ("is", "as", "us", "this", "plus", "minus", "yes", "bus", "gas"):
            return None
        base = w[:-1]
        # 启发式：去 s 后是常见辅音结尾时更可能
        return base

    return None


def _lemma_verb(word: str) -> str | None:
    """处理动词变位 → 原形；返回 None 表示未匹配"""
    w = word.lower()

    # 词典优先
    if w in _IRREGULAR_VERBS:
        return _IRREGULAR_VERBS[w]

    # -ies → -y（tries → try）
    if w.endswith("ies") and len(w) > 4 and w[-4] not in "aeiou":
        return w[:-3] + "y"

    # -ies → -ie（unlikely but for completeness）
    if w.endswith("ies") and len(w) > 4:
        return w[:-3] + "y"

    # -ing 结尾（running → run / eating → eat / making → make）
    # 长度上限 9：避免误伤 everything (10) / morning / evening / ceiling / string / king / ring (4-7) 等非动词
    if w.endswith("ing") and 5 <= len(w) <= 9:
        base = w[:-3]
        if not base:
            return None
        # 双写辅音：running → run, swimming → swim, getting → get
        if len(base) >= 2 and base[-1] == base[-2] and base[-1] not in "aeiou":
            return base[:-1]
        # -ie 结尾变 -y：lying → lie, dying → die
        if base.endswith("y") and len(base) > 1 and base[-2] not in "aeiou":
            return base[:-1] + "ie"
        # -e 结尾的动词：making → make, taking → take
        if base + "e" in ("make", "take", "write", "drive", "ride", "rise", "come", "give", "live", "love", "move", "arrive", "believe", "leave", "decide", "include", "excuse", "use", "close", "hope", "arrive", "prepare", "imagine"):
            return base + "e"
        return base

    # -ed 结尾（walked → walk / played → play / visited → visit）
    if w.endswith("ed") and len(w) > 3:
        base = w[:-2]
        if not base:
            return None
        # 双写辅音：stopped → stop
        if len(base) >= 2 and base[-1] == base[-2] and base[-1] not in "aeiou":
            return base[:-1]
        # -ied → -y（tried → try, applied → apply, studied → study）
        if base.endswith("i") and len(base) > 1 and base[-2] not in "aeiou":
            return base[:-1] + "y"
        # -e 结尾动词：liked → like, played → play
        if base + "e" in ("like", "love", "live", "hope", "use", "close", "decide", "include", "move", "arrive", "believe", "prepare", "imagine", "create", "celebrate", "hate", "date", "taste", "smile", "dance", "share", "compare", "prepare", "suppose", "improve", "approve", "describe", "provide", "realize", "recognize"):
            return base + "e"
        return base

    # -s 结尾（动词三单，runs → run / makes → make / goes → go）
    if w.endswith("s") and not w.endswith("ss") and len(w) > 3:
        if w in _IRREGULAR_NOUNS:
            return None  # 名词优先
        # 启发式：动词三单：-s 结尾且去 s 后是元音+辅音
        base = w[:-1]
        if base.endswith("e"):
            return base  # makes → make
        # es 结尾（teaches, watches）
        if w.endswith("es") and len(w) > 3:
            base2 = w[:-2]
            if base2.endswith(("ss", "sh", "ch", "x", "z", "o")):
                return base2
            return base2  # goes → go
        return base

    return None


def _lemma_adjective(word: str) -> str | None:
    """处理形容词比较级/最高级 → 原级"""
    w = word.lower()
    if w in _IRREGULAR_ADJECTIVES:
        return _IRREGULAR_ADJECTIVES[w]
    # -er / -est 规则（不严格，覆盖简单情况）
    # 用户更可能从句子中直接提取原级，所以这块次要
    return None


def _lemma_pure_python(word: str) -> str:
    """
    纯 Python 词形还原：
    1. 名词复数 → 单数
    2. 动词变位 → 原形
    3. 形容词比较级 → 原级
    优先动词（因为英语中很多名词也以 -s 结尾时可能是动词三单）
    """
    # 优先动词（动名词 / 现在分词 / 过去式 / 三单 都很常见）
    result = _lemma_verb(word)
    if result is not None:
        return result

    # 再试名词
    result = _lemma_noun(word)
    if result is not None:
        return result

    # 最后试形容词
    result = _lemma_adjective(word)
    if result is not None:
        return result

    # 没匹配到规则 → 小写化
    return word.lower()


# ============================================================
# 统一接口
# ============================================================

def lemmatize_word(word: str) -> str:
    """
    词形还原统一入口：
    - 短语（含空格）→ 原样小写
    - spaCy 可用时优先 spaCy
    - spaCy 不可用 → 纯 Python fallback
    - 专有名词 → 原样
    """
    if not word:
        return word
    if _is_phrase(word):
        return word.lower()
    if _is_proper_noun(word):
        return word  # 保持原样

    nlp = _get_nlp()
    if nlp is not None:
        try:
            doc = nlp(word)
            if doc and doc[0].pos_ == "PROPN":
                return word
            lemma = doc[0].lemma_ if doc else ""
            return (lemma or word).lower()
        except Exception as e:
            logger.warning(f"spaCy lemma 失败 ({word}): {e}，回退到纯 Python")

    return _lemma_pure_python(word)


def lemmatize_words_sync(words: list[str]) -> list[dict]:
    """
    同步批量 lemma。
    输入：["books", "running", "in spite of", "Apple"]
    输出：[{"original": "books", "lemma": "book", "changed": true}, ...]
    """
    results = []
    for w in words:
        if not w or not isinstance(w, str):
            continue
        original = w
        lemma = lemmatize_word(w)
        results.append({
            "original": original,
            "lemma": lemma,
            "changed": original.lower() != lemma.lower(),
        })
    return results


@celery_app.task(name="app.workers.lemma.lemmatize_task")
def lemmatize_task(job_id: str, words: list[str]):
    """
    Celery task：对 LLM 输出的单词列表做 lemma 后处理。
    """
    logger.info(f"lemmatize_task 启动: job={job_id} count={len(words)}")
    update_job_status(job_id, current_stage=JobStage.LEMMA, progress=80)

    try:
        results = lemmatize_words_sync(words)
    except Exception as e:
        logger.exception(f"lemma 失败: job={job_id}")
        update_job_status(job_id, status=JobStatus.FAILED, error_message=f"Lemma 失败: {e}")
        raise

    changed_count = sum(1 for r in results if r["changed"])
    update_job_status(
        job_id,
        result={"lemma_results": results, "lemma_changed": changed_count},
    )
    return {"job_id": job_id, "total": len(results), "changed": changed_count}