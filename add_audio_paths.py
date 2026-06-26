#!/usr/bin/env python3
"""
为 words.json 每条 word 添加 audio_en / audio_zh 路径字段。

特性：
  - 幂等：已存在 audio_en / audio_zh 字段的词**绝不修改**
  - 路径与 generate_voices.py 写入磁盘时使用的命名保持一致（safe_filename）
  - 与 generate_voices.py 配合，用户加新词时流程：
      1) 手动编辑 words.json
      2) python3 add_audio_paths.py    # 给新词加路径
      3) python3 generate_voices.py    # 只补新词的 mp3

用法：
  python3 add_audio_paths.py          # 默认改 game/data/words.json
  python3 add_audio_paths.py --dry    # 只显示将补的字段，不写文件
  python3 add_audio_paths.py --force  # 重新生成所有 audio_zh 路径（修正已写错的）
"""

import argparse
import json
import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
WORDS_FILE = PROJECT_DIR / "game" / "data" / "words.json"


def md5short(text: str) -> str:
    """保留旧版 md5short（兼容 wordManager.js 旧代码 / 历史 words.json）"""
    h = 0
    for ch in text:
        h = ((h << 5) - h) + ord(ch)
        h &= 0xFFFFFFFF
    if h & 0x80000000:
        h -= 0x100000000
    h = abs(h)
    return f"{h:08x}"[:8]


def safe_filename(name: str) -> str:
    """转义文件名中的非法字符（保留中文）"""
    import re
    return re.sub(r'[<>:"/\\|?*]', '_', name)


def add_paths(words: list[dict], force: bool = False) -> tuple[int, int, int]:
    """为每条 word 添加 audio_en / audio_zh 字段
    默认幂等：已存在的不修改
    --force 模式：重写所有 audio_zh 路径（用于修复旧的 md5short 命名）

    返回 (added, skipped, invalid)"""
    added = 0
    skipped = 0
    invalid = 0
    for w in words:
        word = (w.get("word") or "").strip()
        meaning = (w.get("meaning") or "").strip()
        if not word:
            invalid += 1
            continue
        # 跳过已存在 audio_en 的（除非 force）
        if not force and w.get("audio_en") and w.get("audio_zh"):
            skipped += 1
            continue
        # 补 audio_en
        if not w.get("audio_en"):
            w["audio_en"] = f"sounds/en/{safe_filename(word)}.mp3"
        # 补 audio_zh（仅当 meaning 非空）
        # ★ 路径策略：用 safe_filename(meaning)，与 generate_voices.py 写入磁盘的命名一致
        #   - 人类可读、URL 友好
        #   - 同 meaning 自动去重（同文件名即跳过）
        if meaning:
            w["audio_zh"] = f"sounds/zh/{safe_filename(meaning)}.mp3"
        added += 1
    return added, skipped, invalid


def main():
    parser = argparse.ArgumentParser(description="为 words.json 添加音频路径字段")
    parser.add_argument("--dry", action="store_true", help="只显示将补的字段，不写文件")
    parser.add_argument("--file", type=str, default=str(WORDS_FILE), help="词库路径")
    parser.add_argument("--force", action="store_true",
                        help="强制重写所有 audio_zh 路径（修正旧的 md5short 命名 → safe_filename）")
    args = parser.parse_args()

    words_file = Path(args.file)
    if not words_file.exists():
        print(f"[ERROR] 词库不存在: {words_file}")
        sys.exit(1)

    data = json.loads(words_file.read_text(encoding="utf-8"))
    words = data.get("words", [])
    print(f"读取: {words_file} ({len(words)} 词)")

    # 深拷贝一份用于 dry-run 演示
    if args.dry:
        import copy
        demo = copy.deepcopy(words)
        added, skipped, invalid = add_paths(demo, force=args.force)
        print(f"[DRY RUN] 将补: {added} / 已存在: {skipped} / 异常: {invalid}")
        # 打印前 5 条样例
        sample = [w for w in demo if w.get("audio_en") and w not in words][:3]
        for w in sample[:3]:
            print(f"  {w.get('word')}: {w.get('audio_en')} | {w.get('audio_zh')}")
        return

    added, skipped, invalid = add_paths(words, force=args.force)
    print(f"补字段: {added} / 已存在(跳过): {skipped} / 异常: {invalid}")
    if args.force:
        print(f"  ★ force 模式：已重写全部 audio_zh 路径为 safe_filename 格式")

    # 写回（保留缩进与中文）
    words_file.write_text(
        json.dumps(data, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    print(f"✓ 已写回: {words_file}")
    if added > 0:
        print(f"  下一步: python3 generate_voices.py  # 只补新词的音频")


if __name__ == "__main__":
    main()
