# Container for the automation API. Nothing here is wired to a provider: the
# image is built and run the same way on Render, Railway, Fly.io or a VPS.
FROM python:3.12-slim

# Fail fast, log immediately, and keep the image free of .pyc files.
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Dependencies first so a code change does not reinstall them.
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Never run as root in a container that holds a database key.
RUN useradd --create-home --uid 10001 automation
USER automation

EXPOSE 8000

# The platform supplies PORT on most hosts; 8000 is the local default.
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
