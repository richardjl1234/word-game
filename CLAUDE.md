# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

英语单词闯关游戏，纯前端单页应用（HTML5 + CSS3 + Vanilla JS）。单词气泡从屏幕上方飘落，玩家将单词与底部中文释义匹配。50个关卡，2889个词汇，无构建工具/打包器。

**支持语音**：底部中文释义自动播放中文 mp3；答对后英文单词自动播 2 遍。音色/语速/音调/音量可在开始界面"语音设置"面板调节（持久化到 localStorage）。

## 开发命令

```bash
# 直接打开 index.html 即可运行（无构建步骤）
# 若需本地服务器：
python3 -m http.server 8080 -d game/
# 推荐：使用项目根目录的 start.sh（支持前后台启动/停止/状态）
./start.sh
```

```bash
# 扩展词库（更新 words.json）
python3 expand_words.py

# ★ 语音相关
# 1) 为 words.json 每条加 audio_en/audio_zh 路径（幂等，只补缺失字段）
python3 add_audio_paths.py
# 2) 批量生成 mp3（增量 / 断点续传 / quota 友好，支持 --lang/--word/--force/--retry-errors 等）
python3 generate_voices.py
# 首次全量约 4000+ 次 API 调用（2889 英文 + ~2500 中文去重），按 5 并发 + 0.2s 限流 ≈ 15 分钟
# 改完 config.example.js 的 voice_id/speed/pitch 后全量重生成：
python3 generate_voices.py --force
```

## 项目结构

```
word-game/                      # 项目根
├── start.sh                    # 启动脚本（前后台/停止/状态）
├── add_audio_paths.py          # ★ 给 words.json 加 audio_en/audio_zh 路径（幂等）
├── generate_voices.py          # ★ 增量批量生成 mp3（MiniMax TTS，含状态文件）
├── generate_audio.py           # 旧版单词音频脚本（已被 generate_voices.py 取代，保留兼容）
├── expand_words.py             # 词库扩展到 2889 词
├── technical_debt.md           # 技术债记录
├── game/                       # 前端游戏
│   ├── index.html              # 主页面（7个界面 + 语音设置面板）
│   ├── css/
│   │   ├── style.css           # 主样式（配色、布局、按钮、气泡、语音设置面板）
│   │   └── animations.css      # 关键帧动画（击中/落地/连击/粒子/庆祝）
│   ├── js/
│   │   ├── game.js             # 游戏引擎核心（Game类，主循环 requestAnimationFrame）
│   │   ├── wordManager.js      # 词库加载、关卡进度、错词本（localStorage 持久化）
│   │   ├── collision.js        # 碰撞检测（鼠标/touch 事件委托）
│   │   ├── animationPlayer.js  # 动画特效（粒子爆炸、分数弹出、连击、震动）
│   │   ├── soundManager.js     # 音效（Web Audio API合成 + mp3 TTS + Web Speech fallback）
│   │   ├── gamepadController.js# 手柄支持（A/B/Start/Select/D-pad/左摇杆/震动）
│   │   ├── backgroundAnimator.js# 背景云朵/气球/草地动画
│   │   ├── config.example.js   # ★ 配置模板（复制为 config.js 填入真实 API Key）
│   │   └── config.js           # ★ 真实配置（gitignore，不提交到仓库）
│   ├── data/
│   │   └── words.json          # 词库（2889 单词 + 每条含 audio_en/audio_zh 路径）
│   ├── sounds/                 # ★ TTS 音频（gitignore）
│   │   ├── en/{word}.mp3       #   英文（每词一个，约 19KB）
│   │   ├── zh/{hash}.mp3       #   中文（按 meaning hash 去重，约 16KB）
│   │   ├── .generation_state.json  # 断点续传状态（completed / failed / last_run / daily_count）
│   │   └── audio_errors.log    # 失败项详细日志
│   └── lib/
│       └── lottie.min.js       # Lottie 动画播放器（当前未使用）
```

## 架构要点

- **Game** (game.js) 是中心控制器，持有 WordManager、CollisionDetector、SoundManager、AnimationPlayer 四个模块实例
- **游戏循环**：`requestAnimationFrame` 驱动，每帧更新单词 Y 坐标，检测落地，控制生成间隔
- **碰撞检测**：事件委托监听 `mousedown` + `touchstart`，检查坐标是否在 `.word-bubble` 范围内
- **单词匹配**：底部显示当前目标中文释义，点击上方英文单词气泡进行匹配
- **词库加载**：优先从 `words.json` 异步加载，失败时降级到 `WordManager.getFallbackWords()` 内置词库
- **关卡进度**：通过 `localStorage` 键 `wordGameProgress` 持久化
- **音效**：基础音效通过 Web Audio API 合成（OscillatorNode）
- **★ 单词 TTS**：
  - 词库每条含 `audio_en`（如 `sounds/en/apple.mp3`）+ `audio_zh`（如 `sounds/zh/000ebf3a.mp3`）
  - `Game.setNextTarget()` 切换目标时调用 `soundManager.playChineseMeaning()` 播中文
  - `Game.handleCorrectMatch()` 答对时调用 `soundManager.playEnglishWordTwice()` 播英文 2 次
  - 音频缺失时降级到 `speechSynthesis`（Web Speech API）
  - 音色/speed/pitch/vol 在 `config.example.js` 的 `tts` 块定义，运行时可在开始界面调整并持久化到 `localStorage['wordGameVoiceConfig']`
- **★ 音频生成脚本**（`generate_voices.py`）：
  - **增量**：跳过已存在且体积 > 1KB 的 mp3；状态文件 `.generation_state.json` 记录完成/失败项
  - **断点续传**：每个词生成后立即落盘，崩溃后重跑自动接着干
  - **差量**：用户手动加新词后跑 `add_audio_paths.py` + `generate_voices.py`，只补新词，存量绝对不动
  - **quota 友好**：`--daily-quota=N` 限制当日调用；遇 429 指数退避；`--retry-errors` 重试失败项
  - **子集**：`--lang=en/zh`、`--word=apple,banana`、`--words-file=list.txt`
  - **试听**：`--preview "hello 你好"` 生成到 /tmp 不入库
  - **强制覆盖**：`--force` 忽略已存在文件（全量重生成）
  - **孤儿清理**：`--cleanup-orphans` 删除 JSON 中已不存在的词对应的 mp3
- **配置 / 凭据**：
  - `config.example.js` 是模板（提交到仓库，含 `tts` 配置块）
  - `config.js` 是真实配置（**已 gitignore**，含 API Key/GroupId）
  - 用户必须手动 `cp config.example.js config.js` 并填入密钥
  - MiniMax API 密钥**不硬编码**到任何代码或脚本

## 难度分级

- 简单 L1-L10：3-5字母高频词
- 中等 L11-L30：5-8字母
- 较难 L31-L50：8字母+复合词

## 注意事项

- 无测试框架、无 lint 配置
- 单词气泡使用 `style.top` + `requestAnimationFrame` 手动更新位置（非 CSS animation）
- **音频文件 gitignore**：`game/sounds/` 整个目录被忽略，clone 仓库后必须跑 `python3 generate_voices.py` 才能听到声音
- **首次用户交互前浏览器静音**：Chrome/Safari 自动播放策略，未点击前 mp3 播放静默失败
- **中文 hash 算法一致性**：`wordManager.js` 的 `md5short()` 和 `add_audio_paths.py` / `generate_voices.py` 必须保持完全一致（已在所有 3 处使用同一算法）
- **错词本音频双保险**：`wordManager.saveMissedWord()` 写入时存音频路径；`setCurrentLevel()` 错词关卡重建时用 `m.audio_en || fallback` 兼容老存档
