# syntax=docker/dockerfile:1
#
# Three stages so the runtime image carries no compiler, no Node and no build cache.
# Everything is pinned: the bases by digest-friendly tag, the Python dependencies by
# exact version in requirements.txt, the JavaScript ones by package-lock.json.

# ---------------------------------------------------------------------------
# Stage 1 — build the React UI
# ---------------------------------------------------------------------------
FROM node:24-bookworm-slim AS ui

# Mirrors the repo layout: vite.config.ts writes to ../odeda/ui, so from
# /build/frontend the bundle lands in /build/odeda/ui.
WORKDIR /build/frontend

# Lockfile first, so a source change does not invalidate the npm ci layer.
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./

# Vite inlines VITE_* at build time; frontend/.env never enters the context, so these
# arrive as build args (docker-compose.yml forwards them from the root .env). Compose
# passes an unset variable as an empty string, so empty ones are unset rather than
# handed to Vite, where "" would override the frontend's own default styles.
ARG VITE_MAPBOX_TOKEN=
ARG VITE_MAPBOX_PROXY=
ARG VITE_MAP_STYLE_LIGHT
ARG VITE_MAP_STYLE_DARK
RUN for v in VITE_MAPBOX_TOKEN VITE_MAPBOX_PROXY VITE_MAP_STYLE_LIGHT VITE_MAP_STYLE_DARK; do \
      eval "[ -n \"\${$v:-}\" ]" || unset "$v"; \
    done \
 && npm run build

# ---------------------------------------------------------------------------
# Stage 2 — build wheels
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Dependencies first, so a code change does not invalidate the wheel cache.
COPY requirements.txt ./
RUN pip wheel --wheel-dir /wheels -r requirements.txt

COPY pyproject.toml README.md ./
COPY odeda ./odeda
# The built SPA goes inside the package, where package-data puts it into the wheel.
COPY --from=ui /build/odeda/ui ./odeda/ui
RUN test -f odeda/ui/index.html \
 && pip wheel --wheel-dir /wheels --no-deps .

# ---------------------------------------------------------------------------
# Stage 3 — runtime
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    GA_DATA_DIR=/data \
    GA_DB=/data/garmin.db \
    GA_RAW_DIR=/data/raw_archive \
    GA_TOKEN_DIR=/data/tokens \
    GA_HOST=0.0.0.0 \
    GA_PORT=8000

# Non-root from here on. A named volume inherits /data's ownership from the image,
# so the default compose setup just works. A *bind* mount keeps the host directory's
# ownership instead, and nothing here can chown it — the process is already
# unprivileged by the time the entrypoint runs, which is the point. If you swap the
# named volume for a bind mount, chown it to 10001:10001 on the host first; the
# entrypoint says so explicitly rather than failing with "Permission denied".
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin garmin

COPY --from=builder /wheels /wheels
RUN pip install --no-index --find-links=/wheels odeda \
 && rm -rf /wheels

COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# The database, the raw archive and the Garmin token cache all live here.
# Declared as a volume so `docker compose down` cannot take the data with it.
RUN mkdir -p /data && chown -R garmin:garmin /data
VOLUME ["/data"]

EXPOSE 8000
USER garmin
WORKDIR /home/garmin

# No curl in the image; urllib is already there and keeps the image smaller.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request,os,sys; \
sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:'+os.environ.get('GA_PORT','8000')+'/api/health', timeout=4).status==200 else 1)"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["serve"]
