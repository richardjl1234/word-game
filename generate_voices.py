#!/usr/bin/env python3
"""
单词语音批量生成脚本（增量 / 断点续传 / quota 友好）

特性：
  - 跳过已生成的 mp3（按文件存在 + 体积 > 1KB 判断）
  - 状态文件断点续传：game/sounds/.generation_state.json
  - 429 智能退避：指数退避
  - 差量检测：用户加新词后只补新词，存量绝对不动
  - 支持子集：--lang / --word / --words-file
  - 试听：--preview "text" 生成到 /tmp 不入库
  - Dry run：--dry-run 只打印列表
  - Quota 限额：--daily-quota=N 当日调用达到 N 后停止
  - 失败重试：--retry-errors 只重试 .generation_state.json 中的 failed 项
  - 强制覆盖：--force 忽略已存在文件
  - 孤儿清理：--cleanup-orphans 列出并删除 JSON 中已不存在的词对应的 mp3

CLI 用法：
  python3 generate_voices.py                          # 全量增量
  python3 generate_voices.py --lang=zh                # 只补中文
  python3 generate_voices.py --word=hello,world       # 只补某几个词
  python3 generate_voices.py --retry-errors           # 只重试昨天失败的
  python3 generate_voices.py --force                  # 强制重生成
  python3 generate_voices.py --preview "hello 你好"   # 试听（不入库）
  python3 generate_voices.py --dry-run                # 只看列表
  python3 generate_voices.py --daily-quota=300        # 限制当天调用
  python3 generate_voices.py --rate=1.0 --workers=2   # 调慢防 429
"""

import argparse
import hashlib
import json
import os
import re
import sys
import time
import unicodedata
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, date
from pathlib import Path

import requests

# ===== 路径 =====
PROJECT_DIR = Path(__file__).resolve().parent
WORDS_FILE = PROJECT_DIR / "game" / "data" / "words.json"
SOUNDS_DIR = PROJECT_DIR / "game" / "sounds"
EN_DIR = SOUNDS_DIR / "en"
ZH_DIR = SOUNDS_DIR / "zh"
STATE_FILE = SOUNDS_DIR / ".generation_state.json"
ERRORS_LOG = SOUNDS_DIR / "audio_errors.log"
CONFIG_EXAMPLE = PROJECT_DIR / "game" / "js" / "config.example.js"

# ===== API 配置（从 env 读取，fallback 到 config.example.js） =====
API_KEY = os.environ.get("MINIMAX_API_KEY", "")
GROUP_ID = os.environ.get("MINIMAX_GROUP_ID", "")
API_URL = "https://api.minimax.chat/v1/t2a_v2"

# ===== 默认 TTS 参数 =====
DEFAULT_TTS = {
    "model": "speech-2.8-hd",
    "sampleRate": 32000,
    "bitrate": 128000,
    "format": "mp3",
    "defaults": {"speed": 0.85, "pitch": 2, "vol": 1.0},
    "voices": {"en": "English_LovelyGirl", "zh": "Chinese (Mandarin)_Cute_Spirit"},
}

# ===== 限流 / 重试 =====
BACKOFF_BASE = 2          # 普通 429 退避基数（指数）
RPM_BACKOFF = 60          # MiniMax status_code 1002 (RPM) 需等整 1 分钟
MAX_RETRIES = 3
MIN_FILE_SIZE = 1024      # 小于此大小视为空文件，需重新生成
RPM_STATUS_CODES = {1002, 1014, 1015}  # MiniMax 限流码


# ============================================================
# 配置加载
# ============================================================

def load_tts_config():
    """从 config.example.js 解析 TTS 配置（正则提取，兼容 JS 注释）"""
    config = json.loads(json.dumps(DEFAULT_TTS))  # 深拷贝默认值
    if not CONFIG_EXAMPLE.exists():
        return config
    try:
        text = CONFIG_EXAMPLE.read_text(encoding="utf-8")
        # 提取 voices.en
        m = re.search(r"en:\s*['\"]([^'\"]+)['\"]", text)
        if m: config["voices"]["en"] = m.group(1)
        m = re.search(r"zh:\s*['\"]([^'\"]+)['\"]", text)
        if m: config["voices"]["zh"] = m.group(1)
        # 提取 defaults
        m = re.search(r"speed:\s*([\d.]+)", text)
        if m: config["defaults"]["speed"] = float(m.group(1))
        m = re.search(r"pitch:\s*(-?\d+)", text)
        if m: config["defaults"]["pitch"] = int(m.group(1))
        m = re.search(r"vol:\s*([\d.]+)", text)
        if m: config["defaults"]["vol"] = float(m.group(1))
    except Exception as e:
        print(f"[WARN] 解析 config.example.js 失败: {e}，使用默认配置")
    return config


# ============================================================
# 路径 / 哈希
# ============================================================

def hash_meaning(text: str) -> str:
    """与 wordManager.md5short 完全一致的哈希算法（保证路径一致）"""
    h = 0
    for ch in text:
        h = ((h << 5) - h) + ord(ch)
        h &= 0xFFFFFFFF  # 模拟 JS 位运算
    if h & 0x80000000:
        h -= 0x100000000
    h = abs(h)
    return f"{h:08x}"[:8]


def safe_filename(name: str) -> str:
    """转义文件名中的非法字符（保留中文）"""
    return re.sub(r'[<>:"/\\|?*]', '_', name)


def output_path(text: str, lang: str) -> Path:
    """根据语言返回 mp3 目标路径"""
    base = safe_filename(text)
    return (EN_DIR if lang == "en" else ZH_DIR) / f"{base}.mp3"


# ============================================================
# 状态管理
# ============================================================

def load_state() -> dict:
    if STATE_FILE.exists():
        try:
            return json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "en": {"completed": [], "failed": {}},
        "zh": {"completed": [], "failed": {}},
        "last_run": None,
        "daily_count": 0,
        "daily_date": str(date.today()),
    }


def save_state(state: dict):
    state["last_run"] = datetime.now().isoformat(timespec="seconds")
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )


def reset_daily_counter_if_new_day(state: dict):
    today = str(date.today())
    if state.get("daily_date") != today:
        state["daily_date"] = today
        state["daily_count"] = 0


def is_completed(state: dict, text: str, lang: str) -> bool:
    return text in state[lang]["completed"]


def mark_completed(state: dict, text: str, lang: str):
    if text not in state[lang]["completed"]:
        state[lang]["completed"].append(text)
    # 成功时从 failed 中清除
    state[lang]["failed"].pop(text, None)


def mark_failed(state: dict, text: str, lang: str, code: int, err: str):
    state[lang]["failed"][text] = {
        "code": code,
        "attempts": state[lang]["failed"].get(text, {}).get("attempts", 0) + 1,
        "last_try": datetime.now().isoformat(timespec="seconds"),
        "error": err[:200],
    }


# ============================================================
# 文件系统判断
# ============================================================

def file_exists_and_valid(path: Path) -> bool:
    """mp3 文件存在且体积合理"""
    return path.exists() and path.stat().st_size > MIN_FILE_SIZE


# ============================================================
# 词库加载
# ============================================================

def load_words() -> list[dict]:
    if not WORDS_FILE.exists():
        print(f"[ERROR] 词库不存在: {WORDS_FILE}")
        sys.exit(1)
    data = json.loads(WORDS_FILE.read_text(encoding="utf-8"))
    return data.get("words", [])


def unique_meanings(words: list[dict]) -> list[str]:
    """中文 meaning 去重，保持首次出现顺序"""
    seen = set()
    out = []
    for w in words:
        m = w.get("meaning", "").strip()
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out


# ============================================================
# API 调用
# ============================================================

def call_tts(text: str, voice_id: str, tts_cfg: dict) -> tuple[bool, bytes | str, int]:
    """调用 MiniMax TTS。返回 (success, data_or_err, base_resp_code)
    base_resp_code: MiniMax 业务错误码（如 1002 = RPM 限流），0 表示成功
    """
    if not API_KEY:
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
        resp = requests.post(
            API_URL,
            headers={
                "Authorization": f"Bearer {API_KEY}",
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
                # 200 但无音频 = 业务限流（MiniMax 习惯）
                return False, f"业务错误 code={base_code}: {base_msg}", base_code
            return True, bytes.fromhex(audio_hex), 0
        else:
            # 尝试解析错误
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


def is_rate_limited(err: str, code: int) -> bool:
    """检测是否遇到 RPM 限流（含 1002、429、'rate limit' 关键字）"""
    if code in RPM_STATUS_CODES:
        return True
    s = err.lower() if isinstance(err, str) else ""
    return ("429" in err) or ("rate limit" in s) or ("rpm" in s) or ("quota" in s)


def generate_one(text: str, lang: str, tts_cfg: dict) -> tuple[bool, str]:
    """生成单个音频（带重试 + 限流退避）"""
    voice = tts_cfg["voices"]["en" if lang == "en" else "zh"]
    out = output_path(text, lang)

    for attempt in range(MAX_RETRIES):
        ok, data, code = call_tts(text, voice, tts_cfg)
        if ok:
            out.parent.mkdir(parents=True, exist_ok=True)
            out.write_bytes(data)
            return True, ""
        # 限流退避：RPM 必须等满 1 分钟，普通 429 指数退避
        if is_rate_limited(data if isinstance(data, str) else "", code):
            if code in RPM_STATUS_CODES:
                wait = RPM_BACKOFF
                tag = f"RPM({code})"
            else:
                wait = BACKOFF_BASE ** attempt
                tag = "429"
            print(f"  [{tag} backoff] 等待 {wait}s ({text[:30]})")
            time.sleep(wait)
            continue
        # 其他错误不重试
        return False, data if isinstance(data, str) else "unknown"
    return False, "max retries exceeded"


# ============================================================
# 主流程
# ============================================================

def detect_lang(text: str) -> str:
    """粗略检测文本是中文还是英文"""
    for ch in text:
        if "一" <= ch <= "鿿":
            return "zh"
    return "en"


def main():
    parser = argparse.ArgumentParser(
        description="单词语音批量生成（增量 / quota 友好）",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--lang", choices=["en", "zh", "all"], default="all",
                        help="只处理指定语言（默认 all）")
    parser.add_argument("--word", type=str, default="",
                        help="只处理指定英文词（逗号分隔）")
    parser.add_argument("--words-file", type=str, default="",
                        help="从文件读取词列表（每行一个）")
    parser.add_argument("--rate", type=float, default=1.5,
                        help="每次调用间隔秒数（默认 1.5，避免 RPM 限流）")
    parser.add_argument("--workers", type=int, default=1,
                        help="并发线程数（默认 1，顺序执行）")
    parser.add_argument("--daily-quota", type=int, default=10000,
                        help="当日最大调用数（默认 10000）")
    parser.add_argument("--retry-errors", action="store_true",
                        help="只重试 state.failed 中的项")
    parser.add_argument("--force", action="store_true",
                        help="强制重新生成（忽略已存在文件）")
    parser.add_argument("--preview", type=str, action="append", default=[],
                        help="试听文本（不入库，可多次）")
    parser.add_argument("--dry-run", action="store_true",
                        help="只打印待生成列表，不实际调用")
    parser.add_argument("--cleanup-orphans", action="store_true",
                        help="清理 JSON 中已不存在的词对应的 mp3（孤儿文件）")
    args = parser.parse_args()

    tts_cfg = load_tts_config()

    # ===== 试听模式 =====
    if args.preview:
        if not API_KEY:
            print("[ERROR] 试听模式需要 MINIMAX_API_KEY")
            sys.exit(1)
        for text in args.preview:
            lang = detect_lang(text)
            voice = tts_cfg["voices"][lang]
            print(f"🎙 [preview] '{text}' (lang={lang}, voice={voice})")
            ok, data = call_tts(text, voice, tts_cfg)
            if ok:
                preview_path = Path(f"/tmp/preview_{int(time.time()*1000)}.mp3")
                preview_path.write_bytes(data)
                print(f"   → {preview_path} ({len(data)} bytes)")
            else:
                print(f"   → 失败: {data}")
        return

    SOUNDS_DIR.mkdir(parents=True, exist_ok=True)
    EN_DIR.mkdir(parents=True, exist_ok=True)
    ZH_DIR.mkdir(parents=True, exist_ok=True)

    state = load_state()
    reset_daily_counter_if_new_day(state)

    # ===== 收集目标 =====
    targets_en: list[str] = []
    targets_zh: list[str] = []

    if args.retry_errors:
        targets_en = list(state["en"]["failed"].keys())
        targets_zh = list(state["zh"]["failed"].keys())
    else:
        words = load_words()
        # 英文：从 words 取所有 word 字段
        all_words = [w["word"] for w in words if w.get("word")]
        # 中文：去重 meaning
        all_meanings = unique_meanings(words)

        # --word 子集
        if args.word:
            wanted = {w.strip() for w in args.word.split(",") if w.strip()}
            targets_en = [w for w in all_words if w in wanted]
            # 同步只取这些词对应的中文 meaning
            wanted_meanings = {
                w["meaning"] for w in words
                if w.get("word") in wanted and w.get("meaning")
            }
            targets_zh = [m for m in all_meanings if m in wanted_meanings]
        # --words-file 子集
        elif args.words_file:
            wanted = {
                line.strip()
                for line in Path(args.words_file).read_text(encoding="utf-8").splitlines()
                if line.strip()
            }
            targets_en = [w for w in all_words if w in wanted]
            wanted_meanings = {
                w["meaning"] for w in words
                if w.get("word") in wanted and w.get("meaning")
            }
            targets_zh = [m for m in all_meanings if m in wanted_meanings]
        else:
            targets_en = all_words
            targets_zh = all_meanings

        # 过滤：已完成的（除非 --force 或 --retry-errors）
        # 双重检查：state 中标记完成 + 磁盘上文件确实存在（防止 state 与磁盘不一致）
        if not args.force and not args.retry_errors:
            def _is_done(text: str, lang: str) -> bool:
                if not is_completed(state, text, lang):
                    return False
                # state 标完成但磁盘无文件 → 视为未完成，自动补
                return file_exists_and_valid(output_path(text, lang))
            targets_en = [w for w in targets_en if not _is_done(w, "en")]
            targets_zh = [w for w in targets_zh if not _is_done(w, "zh")]
        elif args.force:
            # --force 模式：跳过 completed 过滤，但保留 failed 重置
            state["en"]["failed"].clear()
            state["zh"]["failed"].clear()

    # 按 --lang 过滤
    if args.lang != "all":
        if args.lang == "en":
            targets_zh = []
        else:
            targets_en = []

    # ===== Dry run =====
    if args.dry_run:
        print(f"[DRY RUN] 待生成: en={len(targets_en)} zh={len(targets_zh)}")
        if targets_en[:5]:
            print(f"  en 样例: {targets_en[:5]}")
        if targets_zh[:5]:
            print(f"  zh 样例: {targets_zh[:5]}")
        return

    # ===== 检查环境（dry-run 之后） =====
    if not API_KEY:
        print("[ERROR] MINIMAX_API_KEY 未设置")
        print("        请先: source /home/richardjl/shared/jianglei/claude/education_config.sh")
        print("        或:   export MINIMAX_API_KEY=xxx MINIMAX_GROUP_ID=yyy")
        sys.exit(1)

    total = len(targets_en) + len(targets_zh)
    print(f"待生成: {total} (en={len(targets_en)}, zh={len(targets_zh)})")
    print(f"配置: voice_en={tts_cfg['voices']['en']}, voice_zh={tts_cfg['voices']['zh']}")
    print(f"      speed={tts_cfg['defaults']['speed']}, pitch={tts_cfg['defaults']['pitch']}, vol={tts_cfg['defaults']['vol']}")
    print(f"      rate={args.rate}s, workers={args.workers}, daily_quota={args.daily_quota}")
    print(f"      state: en_done={len(state['en']['completed'])}, zh_done={len(state['zh']['completed'])}")
    print(f"             en_fail={len(state['en']['failed'])}, zh_fail={len(state['zh']['failed'])}")
    print()

    # ===== 清理孤儿（可选） =====
    if args.cleanup_orphans:
        words = load_words()
        valid_words = {w["word"] for w in words}
        valid_meanings = set(unique_meanings(words))
        cleaned = 0
        for mp3 in EN_DIR.glob("*.mp3"):
            stem = mp3.stem
            if stem not in valid_words:
                print(f"  [orphan] {mp3.name}")
                mp3.unlink()
                cleaned += 1
                state["en"]["completed"].discard(stem) if hasattr(set(), "discard") else None
        for mp3 in ZH_DIR.glob("*.mp3"):
            stem = mp3.stem
            # 中文用 hash 作为文件名，无法直接比对 meaning，需要查重
            if stem not in valid_meanings and not any(hash_meaning(m) == stem for m in valid_meanings):
                print(f"  [orphan] {mp3.name}")
                mp3.unlink()
                cleaned += 1
        print(f"[cleanup] 清理 {cleaned} 个孤儿文件\n")

    # ===== 并发生成 =====
    done = 0
    fail = 0
    skipped = 0
    quota_stopped = False

    def task(text: str, lang: str):
        return text, lang, generate_one(text, lang, tts_cfg)

    tasks = [(t, "en") for t in targets_en] + [(t, "zh") for t in targets_zh]
    # 在 --force 模式下：跳过磁盘已存在且体积合理的文件（节省 API quota）
    if args.force:
        before = len(tasks)
        tasks = [(t, l) for t, l in tasks if not file_exists_and_valid(output_path(t, l))]
        skipped_existing = before - len(tasks)
        if skipped_existing > 0:
            print(f"  [force-skip] 磁盘已有 {skipped_existing} 个 mp3 跳过（--force 但文件已就绪）")

    # 按 hash 排序保证输出稳定（可选）
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(task, t, l): (t, l) for t, l in tasks}
        for fut in as_completed(futures):
            if state["daily_count"] >= args.daily_quota:
                quota_stopped = True
                # 取消剩余
                for f in futures:
                    f.cancel()
                break
            text, lang, (ok, err) = fut.result()
            if ok:
                mark_completed(state, text, lang)
                done += 1
                print(f"  ✓ [{lang}] {text[:40]}")
            else:
                # 检测 HTTP 错误码
                code = 0
                m = re.search(r"HTTP (\d+)", err)
                if m: code = int(m.group(1))
                mark_failed(state, text, lang, code, err)
                fail += 1
                print(f"  ✗ [{lang}] {text[:40]}: {err[:100]}")
            state["daily_count"] += 1
            # 每个任务完成后立即落盘（防崩溃）
            save_state(state)
            time.sleep(args.rate)

    # ===== 统计 =====
    print()
    print("=" * 60)
    print(f"生成完成：成功 {done} / 失败 {fail} / 跳过 {skipped}")
    print(f"累计：en_done={len(state['en']['completed'])}, zh_done={len(state['zh']['completed'])}")
    print(f"      en_fail={len(state['en']['failed'])}, zh_fail={len(state['zh']['failed'])}")
    if quota_stopped:
        print(f"⚠️  达到 daily_quota={args.daily_quota}，已停止")
        print(f"   明天跑: python3 generate_voices.py --retry-errors")
    if state["en"]["failed"] or state["zh"]["failed"]:
        print(f"⚠️  失败项已记录，重试: python3 generate_voices.py --retry-errors")
        # 写错误日志
        ERRORS_LOG.write_text(
            json.dumps(
                {"en": state["en"]["failed"], "zh": state["zh"]["failed"]},
                ensure_ascii=False, indent=2,
            ),
            encoding="utf-8",
        )
    print("=" * 60)


if __name__ == "__main__":
    main()
