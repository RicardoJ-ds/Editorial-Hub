FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc g++ libpq-dev python3-dev && \
    rm -rf /var/lib/apt/lists/*

# Railway builds from the repo root (not from backend/), so all COPY paths
# are relative to the repo root. That lets `railway up` and GitHub auto-deploy
# both build successfully — they agreed on this layout once we moved the
# Dockerfile pointer into railway.toml.
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ .

RUN useradd --create-home --shell /bin/bash appuser
RUN chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
