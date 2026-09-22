# syntax=docker/dockerfile:1
#
# Two stages so the runtime image carries no compiler and no build cache.
# Everything is pinned: the base by digest-friendly tag, the Python dependencies by
# exact version in requirements.txt.

# ---------------------------------------------------------------------------
# Stage 1 — build wheels
# ---------------------------------------------------------------------------
FROM python:3.12-slim-bookworm AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /build

# Dependencies first, so a code change does not invalidate the wheel cache.
COPY requirements.txt ./
RUN pip wheel --wheel-dir /wheels -r requirements.txt

COPY pyproject.toml README.md ./
COPY garmin_analytics ./garmin_analytics
RUN pip wheel --wheel-dir /wheels --no-deps .

# ---------------------------------------------------------------------------
# Stage 2 — runtime
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

# Non-root from here on. The volume is chowned to this uid in the entrypoint,
# which is what makes a bind mount work as well as a named volume.
RUN useradd --create-home --uid 10001 --shell /usr/sbin/nologin garmin

COPY --from=builder /wheels /wheels
RUN pip install --no-index --find-links=/wheels garmin-analytics \
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
