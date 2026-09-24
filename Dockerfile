FROM python:3.12-slim

# System deps (ffmpeg for audio merge)
# pango/harfbuzz: WeasyPrint's text layout for the stats PDF (stats_pdf.py)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg nodejs npm git \
    libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Frontend build
COPY gui/package*.json gui/
RUN cd gui && npm ci --silent

COPY gui/ gui/
RUN cd gui && npm run build

# App code
COPY . .

# Persistent data lives on a mounted volume at /data
ENV DATA_DIR=/data
ENV DATABASE_URL=sqlite:////data/transcriber.db

EXPOSE 8765

CMD ["sh", "-c", "mkdir -p /data/campaigns && uvicorn server:app --host 0.0.0.0 --port 8765"]
