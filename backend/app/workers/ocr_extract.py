"""
OCR worker（task #15 + task #59）：从图片提取文字。

引擎选型：EasyOCR（本地开源，pip 一行安装）
  - 中英双语（['en', 'ch_sim']）
  - 纯 CPU 推理（gpu=False），无 CUDA 依赖
  - 首次运行自动下载模型到 ~/.EasyOCR/model/ (~140MB)

输出契约（与 _extract_pdf/docx/txt 一致）：
  bytes → str（按行聚类合并的纯文本）

行聚类算法：
  - EasyOCR readtext() 返回 [(bbox, text, conf), ...]
  - 按 bbox 左上 y 升序排序
  - y 差 < LINE_THRESHOLD_PX 视为同一行；同行用空格 join
  - 不同行用 \\n 分隔
"""
import io
import logging
import os
from typing import List, Optional

import numpy as np
from PIL import Image

logger = logging.getLogger(__name__)

# 行聚类阈值（像素）。同一行的相邻文本框 y 坐标差 < 此值视为一行
LINE_THRESHOLD_PX = 20

# Reader 单例（避免每次上传都重新加载 ~140MB 模型，耗时数秒）
_reader_cache: Optional["easyocr.Reader"] = None


def _get_reader():
    """懒加载 EasyOCR Reader（首次调用会下载模型 ~140MB）"""
    global _reader_cache
    if _reader_cache is None:
        import easyocr
        logger.info("首次初始化 EasyOCR Reader（中英双语，CPU），下载模型 ~140MB ...")
        _reader_cache = easyocr.Reader(['en', 'ch_sim'], gpu=False, verbose=False)
        logger.info("EasyOCR Reader 初始化完成")
    return _reader_cache


def extract_image_sync(data: bytes) -> str:
    """图片字节 → 纯文本（按 y 坐标聚类合并为行）

    Args:
        data: 图片二进制内容（PNG / JPG / WebP / BMP）

    Returns:
        按行组织的纯文本字符串；空字符串表示 OCR 未识别到任何文字

    Raises:
        Exception: 图片格式损坏或解码失败时抛 PIL 异常（由调用方捕获并 fallback 到空字符串）
    """
    try:
        img = Image.open(io.BytesIO(data)).convert('RGB')
    except Exception as e:
        logger.warning(f"无法解码图片 ({len(data)} bytes): {e}")
        return ""

    arr = np.array(img)
    reader = _get_reader()
    results = reader.readtext(arr)
    if not results:
        return ""

    # 按 bbox 左上 y 坐标升序
    # bbox = [[x1,y1], [x2,y1], [x2,y2], [x1,y2]]
    results = sorted(results, key=lambda r: r[0][0][1])

    # 行聚类：y 差 < LINE_THRESHOLD_PX 视为同行
    lines: List[str] = []
    current: List[str] = []
    last_y: Optional[float] = None

    for bbox, text, conf in results:
        y = bbox[0][1]
        if last_y is not None and abs(y - last_y) > LINE_THRESHOLD_PX:
            lines.append(' '.join(current))
            current = []
        current.append(text)
        last_y = y

    if current:
        lines.append(' '.join(current))

    return '\n'.join(lines)


def warmup():
    """预热 Reader（避免首次上传 OCR 慢 3-5 秒）。

    可在 backend 启动时（main.py lifespan）调用，让模型加载发生在服务启动期。
    当前未启用（避免后端启动慢），用户首次上传时自然触发。
    """
    try:
        _get_reader()
    except Exception as e:
        logger.warning(f"OCR Reader 预热失败（首次上传时仍会重试）: {e}")
