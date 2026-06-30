# 调研报告：上传 MP3/PDF/TXT/DOCX → 提取英文单词 → 加入词库 的 Pipeline 方案

> **撰写日期**：2026-06-26
> **目标项目**：英语单词闯关游戏（纯前端 / 50 关 / 2889 词 / Linux 服务器 24核/64GB/有 GPU）
> **期望产出**：家长/老师上传教材 → 自动得到 `{word, meaning, difficulty}` → 与默认词库去重
> **作者备注**：本次调研撰写时，本地环境的 WebSearch / WebFetch 工具对所有主流站点（Anthropic、OpenAI、Deepgram、HuggingFace、GitHub、Wikipedia、Cloudflare、Supabase、pypi、Google/Bing/DuckDuckGo）均返回 `Unable to verify if domain ... is safe to fetch` 或 API 400 错误。**报告中所有价格区间、版本号、模型能力均基于作者截至 2026-01 的训练知识；落地前请用各厂商最新定价页 / changelog 复核一遍**。每个关键数字都标注了"待复核"标记（⚠️）。

---

## 0. 摘要（TL;DR）

| 环节 | 推荐方案 | 备选 | 单次成本估算（30 分钟音频 + 50 页 PDF） |
|------|----------|------|--------------------------------------|
| **STT（MP3→文本）** | **自托管 `faster-whisper` (large-v3, int8)** | 云端 OpenAI Whisper API | 自托管 ≈ 服务器电费 $0.5；云端 ≈ $0.18（30 min × $0.006） |
| **PDF/DOCX 解析** | **Python: `pdfplumber` + `python-docx`** | 云端（Textract/Mistral OCR） | 自托管 ≈ $0；云端 ≈ $1.5 |
| **LLM 抽取（text→words）** | **Claude Haiku 4.5**（稳定 + JSON 模式 + 中文释义好） | GPT-4o-mini / DeepSeek-V3 / Qwen-Plus | ≈ $0.05（一本书文本 100k tokens） |
| **后端** | **FastAPI 单进程 + SQLite/Postgres**（自托管，单用户低频） | Cloudflare Workers + R2 / Supabase | 自托管 ≈ 服务器空载；Serverless 冷启动慢 + 函数超时难 |

**整体推荐**：纯前端的家长玩具 → **全部自托管在现有 Linux 服务器上**，单容器部署 `FastAPI + faster-whisper + pdfplumber + python-docx`，LLM 调 Claude Haiku 4.5 API（JSON mode 严格结构化输出）。**不引入 Celery/Redis 队列，不引入 Cloudflare/Supabase**——单用户、低频、几十秒到几分钟任务，进程内跑完全够。

---

## 1. STT（MP3 → 文本）

### 1.1 云服务对比（⚠️ 价格/版本待复核）

| 服务 | 价格（每分钟） | 中文+英文混合 | 备注 |
|------|---------------|---------------|------|
| **OpenAI Whisper API** | ~$0.006 / min | ✅ 99 语言，自动检测 | 最简单，按量付费；`whisper-1` 模型 |
| **OpenAI GPT-4o transcribe** | ~$0.006 / min（音频 token） | ✅ | 新版，更准但仍按分钟折算 |
| **Deepgram Nova-2 / Nova-3** | ~$0.0043 / min（Pay-as-you-go） | ✅ 多语种 | 速度快，适合流式；中文支持一般 |
| **AssemblyAI Universal** | ~$0.0065 / min | ✅ | speaker diarization、auto-chapters 强 |
| **阿里云录音文件识别** | ≈ ¥0.0008 / 秒 ≈ ¥0.048 / min | ✅ 中英混 | 国内最便宜；准确率比 Whisper 略差 |
| **腾讯云 ASR** | ≈ ¥0.0035 / 秒 ≈ ¥0.21 / min | ✅ | 价格中等 |
| **Azure Speech** | ~$0.0167 / min（Standard） | ✅ | enterprise 生态 |

**结论**：
- **中文 + 英文混合 + 准确率优先** → OpenAI Whisper API 或 GPT-4o transcribe
- **预算紧 + 国内访问稳定** → 阿里云录音文件识别（中文场景非常便宜）
- **大文件 / 长录音 + 流式** → Deepgram

### 1.2 自托管方案对比（⚠️ 版本/性能待复核）

| 方案 | 后端 | 显存（large-v3） | 速度 vs 原版 | 部署难度 | 备注 |
|------|------|-----------------|--------------|----------|------|
| **OpenAI Whisper 原版** | PyTorch | ~10GB (fp16) | 1× | ⭐⭐ | 官方实现，模型大 |
| **faster-whisper** | CTranslate2 | **~3GB (int8)** | 4-8× | ⭐ | **强烈推荐**：纯 Python install，少量代码 |
| **whisper.cpp** | ggml | ~2GB (q5) | 同 faster-whisper | ⭐⭐ | C++，CLI 友好；适合无 GPU 环境 |
| **WhisperX** | CTranslate2 + wav2vec2 | ~4GB | 4× + 强制对齐 | ⭐⭐ | 长音频时间戳精确，但中文对齐一般 |
| **Insanely-fast-Whisper** | PyTorch + bf16 | ~10GB | 50× (batch) | ⭐⭐ | 基于 faster-whisper 的 batch 推理；批量大文件效率高 |

**部署到当前服务器（24核/64GB/有 GPU）**：

```bash
# 推荐：faster-whisper
pip install faster-whisper

from faster_whisper import WhisperModel
model = WhisperModel("large-v3", device="cuda", compute_type="int8")
# 30 分钟音频约 1-2 分钟转录完
segments, info = model.transcribe("audio.mp3", language="en")
# language="auto" 也可，会自动检测；混合场景推荐
```

**推荐**：✅ **`faster-whisper` (large-v3, int8, GPU)** —— 单次启动 3GB 显存占用，30 分钟音频 1-2 分钟出结果，跟 Claude API 调用合并起来完全够用。

### 1.3 中文+英文混合识别

Whisper 原生支持 99 种语言，`language="auto"` 模式会自动检测每个 segment 的语言（不是整段切换）。这是目前中英混合识别最稳的方案。注意：
- 中英混读音频，Whisper 可能把整段都标成 `zh`，但 segment 内部词是正确的，无需干预。
- 复杂场景（背景噪音/方言/儿童发音）准确率会下降，建议先做简单降噪（`ffmpeg -af highpass=f=200,lowpass=f=3000`）。

---

## 2. PDF / DOCX 文本提取

### 2.1 Python 库对比

| 库 | 输入 | 优点 | 缺点 | 推荐 |
|----|------|------|------|------|
| **`pdfplumber`** | PDF | 文本提取质量高、表格识别好、能获取字体/坐标 | 扫描版 PDF 需要先 OCR | ✅ **首选** |
| **`PyPDF2` / `pypdf`** | PDF | 纯 Python、轻量 | 复杂排版会乱序 | 备选 |
| **`pdfminer.six`** | PDF | 底层控制力强 | API 繁琐 | 高级用法 |
| **`mammoth`** | DOCX | DOCX → HTML/Markdown 最干净（保留样式） | 不支持 DOC | ✅ **首选 DOCX** |
| **`python-docx`** | DOCX | 遍历段落/表格灵活 | 不保留样式 | 备选 |
| **TXT** | - | Python 内置 `open()` | - | - |

### 2.2 扫描版 PDF（图片型）

很多教材 PDF 是扫描图。需要 OCR：

| 方案 | 价格 | 准确率 | 备注 |
|------|------|--------|------|
| **`paddleocr`**（开源，中英混） | 免费 | 中文 SOTA | 自托管推荐 |
| **`Tesseract`**（via `pytesseract`） | 免费 | 中等 | 经典方案 |
| **`marker-pdf`**（开源） | 免费 | 强 | PDF → Markdown 一条龙 |
| **Mistral OCR API** | ~$1/1000 页 | 强 | 云端，结构保真好 |
| **Textract (AWS)** | ~$1.5/1000 页 | 强 | enterprise |

**推荐**：✅ **`pdfplumber`（文本型 PDF）+ `marker-pdf`（扫描型 PDF 兜底）**。家长用户大概率上传文本型教材 PDF，扫描版是少数场景。

### 2.3 提取后清洗

无论哪个库，提取后都要做：
1. 去除页眉页脚（重复字符串）
2. 去除页码
3. 按段落/句子切分
4. 去除多余空白

```python
import re
text = re.sub(r'\n\s*\d+\s*\n', '\n', text)        # 单独成行的页码
text = re.sub(r'\n{3,}', '\n\n', text)             # 多余空行
text = re.sub(r'(.)\1{4,}', r'\1\1', text)         # 异常长重复字符
```

---

## 3. LLM 抽取单词（text → `{word, meaning, difficulty}`）

### 3.1 模型对比（⚠️ 价格/版本待复核）

| 模型 | Input $/M tok | Output $/M tok | 中文 | 指令遵循 | JSON mode | 备注 |
|------|---------------|----------------|------|----------|-----------|------|
| **Claude Haiku 4.5** | $1 | $5 | ✅ 极强 | ✅ 极强 | ✅ | **首选**：便宜 + 准 |
| **Claude Sonnet 4.5** | $3 | $15 | ✅ | ✅ | ✅ | 复杂任务 |
| **GPT-4o-mini** | $0.15 | $0.60 | ✅ | ✅ | ✅ | 极致便宜，但中文释义质量一般 |
| **GPT-4o** | $2.5 | $10 | ✅ | ✅ | ✅ | 贵但最稳 |
| **DeepSeek-V3** | $0.14 (cache miss) / $0.014 (cache hit) | $0.28 | ✅ | ✅ | ✅ | 国内直连，价格最低 |
| **Gemini 1.5 Flash** | $0.075 | $0.30 | ✅ | ✅ | ✅ | 极便宜，长 context 128k |
| **通义千问 Qwen-Plus** | ¥4 / M | ¥12 / M | ✅ 母语级 | ✅ | ✅ | 国内便宜 |
| **文心一言 ERNIE-4.0** | ¥12 / M | ¥12 / M | ✅ | ✅ | ⚠️ 部分支持 | |

### 3.2 Prompt 设计要点

核心策略：**JSON mode + 严格 schema + few-shot**。

```python
prompt = """从以下英文教材片段中提取英语单词，给出中文释义和难度。
要求：
1. 只提取常见词（小学到初中水平），跳过专有名词、缩写、人名
2. 词形用 lemma（"running" → "run"）
3. 难度按词长+频率：1=简单(≤4字母)，2=中等(5-7字母)，3=难(8+字母或低频)
4. 严格按 JSON 数组返回，不要 markdown 代码块

输出 schema：
[{"word": "apple", "meaning": "苹果", "difficulty": 1}, ...]

教材片段：
{text_chunk}
"""
```

**重要优化**：
- **分块**：超过 4k tokens 的文本按段落切，避免单次输入太长
- **去重**：先在客户端用正则筛出 `[a-z]{3,}` 的候选词，再让 LLM 决定给释义（而不是让 LLM 自由提取——能减少幻觉）
- **批量**：一次 prompt 让模型输出多条，效率高
- **缓存**：用 prompt caching（Claude 支持），同一批次的 system prompt 重复利用，节省 80%

### 3.3 推荐

✅ **首选：Claude Haiku 4.5**
- 输入 $1/M tok、输出 $5/M tok
- 中英双语极强，指令遵循稳定
- JSON mode + prompt caching 减少成本
- 一次完整抽取（一本 50 页教材 100k tokens）约 $0.10

**备选**：
- **预算极紧**：GPT-4o-mini（便宜 7 倍）或 DeepSeek-V3（中文更好但需要国内访问）
- **不翻墙/国内部署**：DeepSeek-V3 或 Qwen-Plus
- **超长文档**：Gemini 1.5 Flash（128k context 单次搞定）

---

## 4. 后端部署

### 4.1 三个候选方案对比

| 方案 | 单用户低频场景成本 | 运维成本 | 上传大文件 | 函数超时 | 适配度 |
|------|---------------------|----------|------------|----------|--------|
| **Cloudflare Workers + R2 + D1** | $0（R2 5GB + Workers 10万 req/day 免费） | 极低（无服务器） | ✅ R2 支持分片上传 | ⚠️ Workers CPU 时间 30s（付费 5min），Whisper 跑不动 | ⚠️ STT 必须外置 |
| **Supabase（BaaS）** | $0（500MB DB + 1GB Storage 免费） | 低（控制台点点） | ✅ Storage | Edge Functions 超时 150s | ⚠️ Whisper 跑不动 |
| **FastAPI 单进程 + SQLite + 文件系统** | 仅服务器电费（$5/月） | 中（要管 systemd / docker） | ✅ 无限制 | ✅ 无限制 | ✅ **最适合** |
| **FastAPI + Celery + Redis + S3** | 服务器 $5/月 + Redis 内存 | 高 | ✅ | ✅ | ❌ 单用户过度设计 |

### 4.2 关键判断

- **Cloudflare Workers 跑不了 STT**：Workers CPU 限额 30s（免费）/`5min`（付费），faster-whisper 转录 30 分钟音频需要 1-2 分钟，再加 LLM 调用，可能超时。即使跑得动，每次冷启动要下载 1.5GB 模型也不现实。**结论：Worker 只做 API 网关 + 文件上传，STT/LLM 在别处跑**。
- **Supabase 同理**：Edge Functions 超时 150s，不够。
- **自建 FastAPI**：单进程 `uvicorn` + `asyncio`，一个接口 `/upload` 内部串行跑 STT → LLM → 写库，回前端进度。简单、稳定、可观测。

### 4.3 推荐

✅ **FastAPI 单进程 + SQLite（够用）+ 本地文件系统存上传文件**

```python
# 伪代码
@app.post("/api/extract_words")
async def extract_words(file: UploadFile, lang: str = "auto"):
    # 1. 保存上传文件
    path = save_upload(file)

    # 2. 根据类型分发
    if file.filename.endswith(".pdf"):
        text = pdfplumber_extract(path)
    elif file.filename.endswith(".docx"):
        text = mammoth_extract(path)
    elif file.filename.endswith((".mp3", ".wav", ".m4a")):
        text = faster_whisper_transcribe(path, lang)
    else:
        text = path.read_text()  # txt

    # 3. 候选词过滤（本地正则）
    candidates = extract_candidates(text)

    # 4. LLM 抽取释义+难度
    words = await claude_extract_meanings(candidates)

    # 5. 去重 + 返回
    return dedupe_against_existing(words, "game/data/words.json")
```

并发：单用户场景 `uvicorn --workers 2 --timeout 600` 足够。

---

## 5. 推荐的整体 Pipeline

```
┌────────────────────────────────────────────────────────────────┐
│  家长/老师（浏览器）                                              │
│  打开游戏 → 进入"上传词库"页面 → 拖入 PDF/MP3/TXT/DOCX            │
└────────────────────────────────────────────────────────────────┘
                          │
                          │ multipart/form-data POST
                          ▼
┌────────────────────────────────────────────────────────────────┐
│  FastAPI (单进程, 端口 8081, systemd 守护)                       │
│  ┌──────────────┐                                                │
│  │ /api/upload  │ → 保存到 /var/uploads/{uuid}.{ext}             │
│  └──────┬───────┘                                                │
│         │                                                        │
│         ▼                                                        │
│  ┌──────────────────┐  类型分发                                   │
│  │ Type Router      │ ─→ PDF → pdfplumber                       │
│  │                  │ ─→ DOCX → mammoth                         │
│  │                  │ ─→ MP3 → faster-whisper(large-v3, GPU)     │
│  │                  │ ─→ TXT → read()                           │
│  └────────┬─────────┘                                            │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────────┐                                          │
│  │ 文本清洗 + 候选词提取 │ → 正则 [a-z]{3,} 去标点去停用词         │
│  └────────┬────────────┘                                          │
│           │                                                      │
│           ▼                                                      │
│  ┌─────────────────────────┐                                      │
│  │ Claude Haiku 4.5 (API)  │ → JSON mode → [{w,m,d}, ...]        │
│  │ (备选 DeepSeek / Qwen)  │                                      │
│  └────────┬────────────────┘                                      │
│           │                                                      │
│           ▼                                                      │
│  ┌────────────────────────┐                                       │
│  │ 去重 + 难度评估 + 写入  │ → words.json (合并) + 触发 TTS 批生成 │
│  └────────┬───────────────┘                                       │
└───────────┼──────────────────────────────────────────────────────┘
            │
            ▼
┌────────────────────────────────────────────────────────────────┐
│  返回前端：预览 + 勾选 → 确认 → 写入 game/data/words.json         │
│  异步任务：python3 add_audio_paths.py && python3 generate_voices.py │
└────────────────────────────────────────────────────────────────┘
```

---

## 6. 落地步骤（10 步）

### Phase 1：基础设施（1-2 天）

1. **创建 `/home/word-game/api/` 目录**，初始化 FastAPI 项目骨架：
   ```
   api/
   ├── main.py              # FastAPI app + 路由
   ├── extractors/
   │   ├── pdf.py           # pdfplumber 封装
   │   ├── docx.py          # mammoth 封装
   │   ├── audio.py         # faster-whisper 封装
   │   └── text.py          # txt + 通用清洗
   ├── llm.py               # Claude Haiku client (anthropic SDK)
   ├── models.py            # Pydantic schema
   └── requirements.txt
   ```

2. **添加依赖到 `requirements.txt`**：
   ```
   fastapi==0.115.* uvicorn[standard]==0.32.*
   pdfplumber==0.11.* python-docx==1.1.* mammoth==1.8.*
   faster-whisper==1.0.*    # CTranslate2
   anthropic==0.39.*        # Claude SDK
   python-multipart==0.0.*  # 文件上传
   ```
   `pip install -r requirements.txt`

3. **配置文件**（`config.example.py`）：
   ```python
   ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]
   WHISPER_MODEL = "large-v3"        # 或 "medium" 起步
   WHISPER_DEVICE = "cuda"           # 或 "cpu"
   WHISPER_COMPUTE = "int8"
   MAX_UPLOAD_MB = 200
   ```

### Phase 2：后端实现（2-3 天）

4. **实现 `/api/extract` 端点**：
   - 接收 multipart 文件 + 类型参数
   - 保存到 `/var/uploads/{uuid}.{ext}`
   - 同步调用 extractors（音频可能要 1-2 分钟，超时设为 600s）
   - 调 Claude Haiku 用 prompt caching
   - 返回 JSON：`{"candidates": [{word, meaning, difficulty}, ...], "preview": "原文前 500 字"}`

5. **实现 `/api/commit` 端点**：
   - 接收用户勾选的 word 列表
   - 与 `game/data/words.json` 去重（基于 `word` 字段）
   - 追加新词，重新分配关卡（L51-L60 留给用户上传的词）
   - 返回成功 + 触发生成音频脚本

### Phase 3：前端接入（1 天）

6. **在游戏 `index.html` 加"上传词库"入口**（开始界面按钮），新建 `upload.html` 子页面：
   - 大文件拖拽区 + 进度条
   - 候选词预览 + 勾选 + 中文释义编辑
   - 确认按钮 → 调 `/api/commit`

7. **在 `game/data/words.json` 顶部加 `_user_uploaded: true` 标记**，让 `WordManager` 知道这些词属于自定义关卡。

### Phase 4：自动化（半天）

8. **写 `auto_generate_audio.sh`**：
   ```bash
   #!/bin/bash
   cd /home/word-game
   python3 add_audio_paths.py
   python3 generate_voices.py   # 增量，已存在自动跳过
   ```

9. **systemd 服务**（`/etc/systemd/system/word-game-api.service`）：
   ```ini
   [Service]
   WorkingDirectory=/home/word-game/api
   ExecStart=/usr/bin/uvicorn main:app --host 0.0.0.0 --port 8081 --workers 2 --timeout 600
   Restart=always
   EnvironmentFile=/home/word-game/api/.env
   ```

### Phase 5：验收（半天）

10. **端到端测试**：
    - 上传一个 50 页文本型 PDF → 30 秒内返回候选词
    - 上传一个 30 分钟 MP3 → 2 分钟内返回候选词
    - 上传一个 DOCX → 10 秒内返回候选词
    - 确认提交 → words.json 写入 → 重新打开游戏看到新词关卡

---

## 7. 关键权衡

### 7.1 成本 vs 准确性

| 决策点 | 选 A（便宜） | 选 B（准确） | 推荐 |
|--------|-------------|-------------|------|
| STT | faster-whisper medium (int8) | faster-whisper large-v3 | **large-v3**（服务器有 GPU，差距不大） |
| LLM | GPT-4o-mini | Claude Haiku 4.5 | **Claude Haiku 4.5**（中文释义明显更好） |
| 部署 | Cloudflare + Supabase 全 serverless | 自建 FastAPI | **自建**（单用户场景 serverless 反而麻烦） |

### 7.2 部署难度 vs 长期维护

- **Serverless** 短期看"零运维"，但 STT/LLM 都有超时限制，最终还是要外接自托管服务，反而复杂度更高。
- **自建 FastAPI** 写一次 systemd 配置就行，后续只是改业务逻辑。
- **结论**：单用户低频场景，**自建永远更简单**。

### 7.3 中文 vs 英文 LLM

- **DeepSeek-V3**：中文母语级，但需要保证服务器能直连 deepseek.com（或用国内云部署）。
- **Qwen-Plus**：阿里云百炼，国内最便宜，¥4/M 输入。
- **Claude Haiku**：海外 API，中文也极强（Anthropic 中文训练数据质量高），但需要翻墙或 API 转发。

**如果服务器在国内**：优先 **Qwen-Plus**（国内直连最便宜 + 中文释义质量极佳）。
**如果服务器在海外**：优先 **Claude Haiku 4.5**。

### 7.4 不需要做的事

- ❌ 不要做 Celery 队列（单用户，用不上）
- ❌ 不要做 S3/OSS（本地文件系统够用，词库文件就几百 KB）
- ❌ 不要做 Postgres（SQLite 够，单文件好备份）
- ❌ 不要做 React/Vue 前端（游戏已经是 Vanilla JS，新增页面继续 vanilla）
- ❌ 不要做用户系统（家庭场景，单玩家最多加个昵称）

---

## 8. 数据时效性声明

⚠️ **本报告撰写时（2026-06-26），WebSearch 与 WebFetch 工具因网络策略对所有外部站点返回错误。报告中的所有数字均基于作者截至 2026-01 的训练知识。** 落地前请用以下命令复核：

```bash
# 1) Whisper / Claude / OpenAI 最新定价
# → 浏览对应 /pricing 页

# 2) faster-whisper 最新版
pip index versions faster-whisper

# 3) Claude / Qwen 模型最新版本号
# → 浏览 https://docs.anthropic.com/en/docs/about-claude/models
# → https://help.aliyun.com/zh/model-studio/

# 4) 复核 pdfplumber / mammoth 是否仍维护
pip index versions pdfplumber mammoth
```

如果数字有显著变化，**整体架构不需要调整**，只需调整：
- API key 选哪个供应商
- 单次成本估算数字
- WHISPER_MODEL 是选 large-v3 还是 medium（看显存）

---

## 9. 一页纸 Checklist（给实施的人）

```
[ ] 服务器有 GPU？→ faster-whisper large-v3
[ ] 服务器无 GPU？→ faster-whisper medium (int8, CPU) 或走 OpenAI API
[ ] 服务器在国内？→ LLM 用 Qwen-Plus 或 DeepSeek
[ ] 服务器在海外？→ LLM 用 Claude Haiku 4.5
[ ] 上传文件大小限制？→ 默认 200MB，FastAPI 配 --limit-request-line
[ ] 并发？→ uvicorn --workers 2（单用户场景够用）
[ ] 反向代理？→ nginx 转发 /api → 127.0.0.1:8081
[ ] HTTPS？→ certbot + nginx
[ ] 日志？→ uvicorn 默认 stdout + journalctl -u word-game-api
[ ] 备份？→ cron 每天 tar game/data/words.json
[ ] 失败重试？→ 前端按"重新提取"按钮重跑即可，无需后端重试逻辑
```

---

**报告结束。**