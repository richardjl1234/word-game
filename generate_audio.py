#!/usr/bin/env python3
"""
单词音频生成脚本
使用MiniMax TTS API为游戏生成单词发音
"""

import os
import sys
import json
import requests
import time
import concurrent.futures
from pathlib import Path

# MiniMax API配置 - 从环境变量读取
API_KEY = os.environ.get('MINIMAX_API_KEY', '')
GROUP_ID = os.environ.get('MINIMAX_GROUP_ID', '')
VOICE_ID = "Chinese (Mandarin)_Cute_Spirit"
API_URL = "https://api.minimax.chat/v1/t2a_v2"

# 词库文件路径
WORDS_FILE = "game/data/words.json"
OUTPUT_DIR = "game/assets/sounds/"

def generate_word_audio(word_data):
    """为单个单词生成音频"""
    word = word_data['word']
    word_id = word_data['id']

    output_file = f"{OUTPUT_DIR}{word}.mp3"

    # 如果音频已存在，跳过
    if os.path.exists(output_file):
        print(f"[SKIP] {word} (already exists)")
        return {"word": word, "id": word_id, "status": "skipped"}

    try:
        payload = {
            "model": "speech-2.8-hd",
            "text": word,
            "stream": False,
            "voice_id": VOICE_ID,
            "group_id": GROUP_ID
        }

        headers = {
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}"
        }

        response = requests.post(API_URL, json=payload, headers=headers, timeout=30)

        if response.status_code == 200:
            with open(output_file, 'wb') as f:
                f.write(response.content)
            print(f"[SUCCESS] {word}")
            return {"word": word, "id": word_id, "status": "success"}
        else:
            print(f"[ERROR] {word} - Status: {response.status_code}")
            return {"word": word, "id": word_id, "status": "error", "code": response.status_code}

    except Exception as e:
        print(f"[ERROR] {word} - {str(e)}")
        return {"word": word, "id": word_id, "status": "error", "error": str(e)}

def main():
    if not API_KEY:
        print("错误：未设置 MINIMAX_API_KEY 环境变量")
        print("请先设置环境变量: export MINIMAX_API_KEY='your-key'")
        sys.exit(1)
    # 确保输出目录存在
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # 加载词库
    with open(WORDS_FILE, 'r', encoding='utf-8') as f:
        data = json.load(f)

    words = data['words']
    print(f"开始为 {len(words)} 个单词生成音频...")

    results = []
    success_count = 0
    error_count = 0

    # 使用多线程并发生成（控制并发数避免API限制）
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as executor:
        futures = {executor.submit(generate_word_audio, word): word for word in words}

        for future in concurrent.futures.as_completed(futures):
            result = future.result()
            results.append(result)

            if result['status'] == 'success':
                success_count += 1
            elif result['status'] == 'error':
                error_count += 1

            # 避免API限流
            time.sleep(0.2)

    # 输出统计
    print("\n" + "="*50)
    print(f"音频生成完成!")
    print(f"成功: {success_count}")
    print(f"失败: {error_count}")
    print(f"跳过: {len(words) - success_count - error_count}")
    print("="*50)

    # 保存错误日志
    errors = [r for r in results if r['status'] == 'error']
    if errors:
        with open('audio_errors.log', 'w', encoding='utf-8') as f:
            json.dump(errors, f, ensure_ascii=False, indent=2)
        print(f"错误日志已保存到 audio_errors.log")

if __name__ == "__main__":
    main()