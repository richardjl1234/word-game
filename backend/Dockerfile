FROM python:3.12-slim

# 系统依赖（pdfplumber 需要 poppler-utils）
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    poppler-utils \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装依赖（利用 Docker 层缓存）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 下载 spaCy 模型（懒加载备用，这里直接装好）
RUN python -m spacy download en_core_web_sm || true

# 复制代码
COPY app/ ./app/
COPY tests/ ./tests/

# 默认启动 API（docker-compose 中可覆盖）
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]