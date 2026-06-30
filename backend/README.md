# Word-Game 后端 (FastAPI)

英语单词闯关游戏的多词库/多用户后端，支持**文件上传 → 自动生成词库**。

## 功能

- **词库管理**：与前端 `librariesManager` 镜像，支持创建/删除/列出用户词库
- **单词批量添加**：去重、词形还原（books → book）、按 position 追加、关卡数自动重算
- **文件上传**：PDF / DOCX / TXT 文本提取（mp3 / 图片占位，等待 ASR/OCR 选型）
- **任务追踪**：Job 模型记录上传/处理状态、进度、当前阶段

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 健康检查（DB / Redis / S3 连通性） |
| POST | `/api/upload` | 上传文件，返回 Job ID |
| GET | `/api/jobs/{id}` | 查询 Job 状态/进度/结果 |
| GET | `/api/jobs?user_id=` | 列用户的所有 Job |
| DELETE | `/api/jobs/{id}` | 取消 Job |
| POST | `/api/libraries?user_id=` | 创建词库 |
| GET | `/api/libraries?user_id=` | 列出用户的所有词库 |
| GET | `/api/libraries/{id}` | 查询词库详情（含 word_count / level_count） |
| DELETE | `/api/libraries/{id}` | 删除词库（默认词库不可删） |
| POST | `/api/libraries/{id}/words` | 批量添加单词（默认做词形还原） |
| GET | `/api/libraries/{id}/words` | 列出词库单词 |

## 词形还原（Lemma）

`POST /api/libraries/{id}/words` 默认对单词做词形还原：

| 输入 | 输出 |
| --- | --- |
| books | book |
| running | run |
| went | go |
| in spite of | in spite of（短语，原样保留） |
| arrive in | arrive in（短语，原样保留） |

可通过 `?lemmatize=false` 关闭。底层用 `app/workers/lemma.py`，纯 Python fallback 实现（含不规则动词/名词字典），可选加载 spaCy 模型提升准确率。

## 处理流水线

```
上传文件 (mp3 / pdf / docx / txt / image)
    ↓
[text_extract worker]  pdfplumber / python-docx / utf-8 读取
    ↓ (待 LLM 选型后)
[llm worker]          从文本提取单词/短语，按目标词库去重
    ↓
[lemma worker]        词形还原 (books → book)
    ↓
[词库 API]            POST /api/libraries/{id}/words
    ↓ (待 TTS 集成后)
[tts worker]          调用 MiniMax TTS 批量生成 mp3
```

> ASR / OCR / LLM / TTS 当前均为占位实现，待引擎选型后接入。文本提取 + 词形还原已可用。

## 快速启动

### 方式一：本地 Python（开发）

```bash
# 0. 确保 Python 3.12 venv 已建（Python 3.13 与 spaCy 3.8 不兼容）
cd /home/richardjl/shared/jianglei/claude/word-game/backend
../venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8765
```

### 方式二：Docker Compose（生产，含 Postgres + Redis + MinIO）

```bash
cd backend
docker-compose up -d
# FastAPI:    http://localhost:8765
# MinIO UI:   http://localhost:9001  (minioadmin / minioadmin)
```

## 配置

通过环境变量配置（可用 `.env` 文件，**不要提交到 Git**）：

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DATABASE_URL` | `sqlite:///./wordgame.db` | SQLAlchemy URL |
| `REDIS_URL` | `redis://localhost:6379/0` | Celery broker / result backend |
| `STORAGE_BACKEND` | `local` | `local` 或 `s3` |
| `LOCAL_STORAGE_DIR` | `/tmp/wordgame-storage` | LocalStorage 根目录 |
| `S3_ENDPOINT` | `http://localhost:9000` | S3/MinIO endpoint |
| `S3_BUCKET` | `wordgame-uploads` | 桶名 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | - | S3 凭据 |
| `MAX_UPLOAD_SIZE_MB` | `200` | 上传大小限制 |
| `APP_DEBUG` | `false` | 开发模式（init_db 自动建表） |

## 测试

```bash
cd backend
../venv/bin/python -m pytest tests/ -v
# 29 passed, 1 skipped (PDF fixture test)
```

- `test_workers.py` — text_extract + lemma 单测
- `test_api.py` — API 端到端（用 sqlite 内存库 + LocalStorage）
- `test_integration.py` — 跨模块集成（上传 → 提取 → lemma → 词库）

`conftest.py` 自动 monkeypatch FastAPI lifespan，避免它覆盖测试用的 sqlite engine / LocalStorage。

## 端到端验证（前端 + 后端）

```bash
# 1. 启动后端 (port 8765)
DATABASE_URL='sqlite:////tmp/wordgame-e2e.db' \
STORAGE_BACKEND=local \
LOCAL_STORAGE_DIR=/tmp/wordgame-e2e-storage \
/home/richardjl/shared/jianglei/claude/word-game/venv/bin/python -m uvicorn \
    app.main:app --host 127.0.0.1 --port 8765 \
    --app-dir /home/richardjl/shared/jianglei/claude/word-game/backend

# 2. 启动前端 (port 8080)
cd /home/richardjl/shared/jianglei/claude/word-game
python3 -m http.server 8080 -d game

# 3. 跑 Playwright E2E (15 个测试用例)
node test_e2e_backend.js
```

截图保存在 `/tmp/e2e-frontend-*.png`。

## 项目结构

```
backend/
├── app/
│   ├── main.py              # FastAPI 入口 + lifespan
│   ├── config.py            # pydantic-settings 配置
│   ├── database.py          # SQLAlchemy engine + get_db
│   ├── models.py            # Job / Library / Word ORM 模型
│   ├── schemas.py           # Pydantic 请求/响应模型
│   ├── storage.py           # StorageBackend 抽象 + LocalStorage + S3Storage
│   ├── celery_app.py        # Celery 实例 + 队列路由
│   ├── routers/
│   │   ├── upload.py        # POST /api/upload
│   │   ├── jobs.py          # GET/DELETE /api/jobs
│   │   └── libraries.py     # CRUD /api/libraries + /words
│   └── workers/
│       ├── text_extract.py  # pdfplumber / python-docx / txt
│       ├── lemma.py         # 纯 Python + 可选 spaCy
│       └── pipeline.py      # dispatch_pipeline（按 source_type 路由）
├── tests/
│   ├── conftest.py          # monkeypatch engine/storage + lifespan
│   ├── test_workers.py      # worker 单测
│   ├── test_api.py          # API 端到端
│   ├── test_integration.py  # 跨模块集成
│   └── fixtures/sample_english_text.txt
├── docker-compose.yml       # postgres + redis + minio + api + worker
├── Dockerfile
└── requirements.txt
```

## 已知限制 / TODO

- **ASR / OCR / LLM**：未选型，对应路由/worker 为占位实现（返回 "feature pending" 错误）
- **Celery worker**：worker 进程未在 `docker-compose` 单独 service 中跑通（当前仅 FastAPI 启动）
- **生产数据库**：dev 用 sqlite，生产请改 PostgreSQL（Alembic 迁移未写）
- **认证**：当前 `user_id` 由前端传入，**无鉴权**，生产需加 OAuth/JWT
- **spaCy 模型**：当前未下载 `en_core_web_sm`，纯 Python fallback 已能处理 80%+ 常见词形
- **MiniMax TTS 批量音频生成**（task #17）：待 ASR/LLM 流程跑通后接入

## 安全

- API key / 数据库密码等敏感配置**必须从环境变量读取**，不要硬编码到代码或 `.env.example`
- 当前 `.env.example` 仅含**占位符**（如 `your-secret-here`），真实 `.env` 必须加入 `.gitignore`