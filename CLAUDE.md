# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

英语单词闯关游戏，**纯前端 + 自建后端**架构。
- **前端**：单页应用（HTML5 + CSS3 + Vanilla JS），单词气泡从屏幕上方飘落，玩家将单词与底部中文释义匹配。50个关卡，2889个词汇，无构建工具/打包器。
- **后端**：FastAPI + SQLAlchemy + Celery + S3-compatible storage，支持**文件上传 → 自动生成词库**（pipeline: text_extract → LLM → lemma → TTS，当前 LLM/TTS 占位）。

**支持语音**：底部中文释义自动播放中文 mp3；答对后英文单词自动播 2 遍。音色/语速/音调/音量可在开始界面"语音设置"面板调节（持久化到 localStorage）。

## 开发命令

```bash
# 前端
./start.sh                     # 前台启动前端（开发调试）
./start.sh start               # 后台启动前端
./start.sh stop                # 停止前端
./start.sh status              # 查看前端状态
./start.sh restart             # 重启前端

# 后端 (FastAPI, port 8765)
./start.sh backend             # 前台启动后端（带 --reload）
./start.sh backend start       # 后台启动后端
./start.sh backend stop        # 停止后端
./start.sh backend status      # 查看后端状态
./start.sh backend restart     # 重启后端

# 同时启动
./start.sh all                 # 同时启动前端 + 后台后端
./start.sh all stop            # 同时停止

# 后端测试
cd backend && ../venv/bin/python -m pytest tests/ -v
# 29 passed, 1 skipped (PDF fixture test)

# 前端 E2E 测试（Playwright，需前后端都启动）
node test_e2e_backend.js       # 15 个测试用例
node test_libraries.js         # 21 个测试用例（仅前端）
node test_focus_after_match.js
node test_penalty_ranking.js
node test_gamepad_settings.js
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
├── start.sh                    # ★ 启动脚本（前端 + 后端，前后/后台/停止/状态）
├── add_audio_paths.py          # ★ 给 words.json 加 audio_en/audio_zh 路径（幂等）
├── generate_voices.py          # ★ 增量批量生成 mp3（MiniMax TTS，含状态文件）
├── generate_audio.py           # 旧版单词音频脚本（已被 generate_voices.py 取代，保留兼容）
├── expand_words.py             # 词库扩展到 2889 词
├── technical_debt.md           # 技术债记录
├── test_*.js                   # Playwright E2E 测试（test_e2e_backend.js / test_libraries.js / ...）
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
│   │   ├── librariesManager.js # ★ 多词库管理（与后端 API 同步）
│   │   ├── usersManager.js     # ★ 多用户系统
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
├── backend/                    # ★ 后端 FastAPI（自建）
│   ├── README.md               # 后端文档
│   ├── Dockerfile
│   ├── docker-compose.yml      # postgres + redis + minio + api
│   ├── requirements.txt
│   ├── app/
│   │   ├── main.py             # FastAPI 入口 + lifespan (init_db / init_storage)
│   │   ├── config.py           # pydantic-settings（DATABASE_URL / S3_ENDPOINT / ...）
│   │   ├── database.py         # SQLAlchemy engine + get_db()
│   │   ├── models.py           # Job / Library / Word ORM
│   │   ├── schemas.py          # Pydantic 请求/响应模型
│   │   ├── storage.py          # StorageBackend 抽象 + LocalStorage + S3Storage
│   │   ├── celery_app.py       # Celery 实例 + 队列路由
│   │   ├── routers/
│   │   │   ├── upload.py       # POST /api/upload（多文件类型检测）
│   │   │   ├── jobs.py         # GET/DELETE /api/jobs
│   │   │   └── libraries.py    # CRUD /api/libraries + /words（含 lemma）
│   │   └── workers/
│   │       ├── text_extract.py # pdfplumber / python-docx / txt
│   │       ├── lemma.py        # 纯 Python fallback + 可选 spaCy
│   │       └── pipeline.py     # dispatch_pipeline（按 source_type 路由）
│   └── tests/
│       ├── conftest.py         # monkeypatch engine/storage + lifespan
│       ├── test_workers.py     # worker 单测
│       ├── test_api.py         # API 端到端（sqlite memory + LocalStorage）
│       ├── test_integration.py # 跨模块集成
│       └── fixtures/sample_english_text.txt
└── venv/                       # Python 3.12 venv（spaCy 3.8 不支持 Python 3.13）
```

## 架构要点

- **Game** (game.js) 是中心控制器，持有 WordManager、CollisionDetector、SoundManager、AnimationPlayer 四个模块实例
- **游戏循环**：`requestAnimationFrame` 驱动，每帧更新单词 Y 坐标，检测落地，控制生成间隔
- **碰撞检测**：事件委托监听 `mousedown` + `touchstart`，检查坐标是否在 `.word-bubble` 范围内
- **单词匹配**：底部显示当前目标中文释义，点击上方英文单词气泡进行匹配
- **词库加载**：优先从 `words.json` 异步加载，失败时降级到 `WordManager.getFallbackWords()` 内置词库
- **关卡进度**：通过 `localStorage` 键 `wordGameProgress` 持久化
- **音效**：基础音效通过 Web Audio API 合成（OscillatorNode）
- **★ 后端 API 联调**：
  - 前端通过 `fetch` 调用后端 `http://127.0.0.1:8765/api/*`（可在 `js/config.js` 配 `backendUrl`）
  - `librariesManager` 与后端 `/api/libraries/*` 双向同步（创建/删除/添加单词）
  - 当前**前端优先 localStorage 缓存**，后端作为权威源在用户主动同步时覆盖
- **★ 后端 pipeline（backend/app/workers/）**：
  - **text_extract**：PDF（pdfplumber）/ DOCX（python-docx）/ TXT（多编码 utf-8/gbk）
  - **lemma**：纯 Python fallback（200+ 不规则字典 + 后缀规则），可选加载 spaCy `en_core_web_sm`
    - books→book, running→run, went→go, children→child, ate→eat
    - phrase 识别（多词带空格）原样保留，不做 lemma
  - **dispatch_pipeline**：按 source_type 路由到对应 worker
    - pdf/docx/txt → text_extract
    - mp3/wav/m4a → 占位（ASR 待选型，task #13）
    - image → 占位（OCR 待选型，task #15）
  - **ASR / LLM / TTS**：占位实现，引擎待选型（task #13/14/17）
- **★ 词形还原集成**：`POST /api/libraries/{id}/words` 默认 `?lemmatize=true`，入库前自动调用 `lemmatize_word()`
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
  - 后端配置全部从环境变量读取（DATABASE_URL / S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY 等）
  - **绝对不要**把任何密钥写入 `start.sh` 或 `backend/.env` 然后提交到 Git

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
