FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ffmpeg \
    gcc \
    libegl1 \
    libgl1 \
    libglib2.0-0 \
    libice6 \
    libsm6 \
    libx11-6 \
    libxau6 \
    libxcb1 \
    libxdamage1 \
    libxdmcp6 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrender1 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements-prod.txt ./

RUN python -m pip install --upgrade pip && \
    python -m pip install -r requirements-prod.txt

COPY . .

# Build-truth: stamp the git SHA into the image so GET /__build can report
# exactly which build is running. Overridable at runtime by a GIT_SHA service
# variable (e.g. set GIT_SHA=${{ RAILWAY_GIT_COMMIT_SHA }} in Railway).
ARG GIT_SHA=unknown
ENV GIT_SHA=$GIT_SHA

CMD ["sh", "-c", "uvicorn server:app --host 0.0.0.0 --port ${PORT:-8080}"]
