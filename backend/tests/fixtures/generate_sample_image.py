"""
生成 OCR 测试用的 fixture 图（白底黑字英文单词）。

为什么需要这个脚本？
- OCR 测试需要稳定可预测的输入图（避免下载外部图片 / 维护二进制 fixture diff）
- 用 PIL 绘制简单清晰印刷体英文，EasyOCR 能可靠识别
- 单词必须命中 words.json 词典（apple/banana/cat/dog 都在），这样 pipeline
  能完整跑通到 add_to_library 步骤

用法：
    ../venv/bin/python generate_sample_image.py sample_words.png
    ../venv/bin/python generate_sample_image.py sample_words.jpg    # JPG 格式
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def generate(out_path: Path):
    img = Image.new('RGB', (500, 400), 'white')
    draw = ImageDraw.Draw(img)

    # 字体：DejaVu Sans Bold（Ubuntu 默认装），fallback 到默认
    try:
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 36)
    except OSError:
        font = ImageFont.load_default()

    # 单词列表（都是 words.json 词典里的常用词，确保 pipeline 命中）
    words = [
        (100,  50, 'apple'),
        (100, 120, 'banana'),
        (100, 190, 'cat'),
        (100, 260, 'dog'),
    ]
    for x, y, word in words:
        draw.text((x, y), word, fill='black', font=font)

    out_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(out_path)
    print(f"✅ 生成 {out_path} ({out_path.stat().st_size} bytes, {img.size[0]}x{img.size[1]})")


if __name__ == '__main__':
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('sample_words.png')
    generate(out)
