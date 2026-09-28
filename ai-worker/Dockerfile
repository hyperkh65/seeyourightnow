# syntax=docker/dockerfile:1.7
# AI worker. Core image is small; pass --build-arg INSTALL_ML=true to add OCR/embedding/caption models.
ARG PYTHON_IMAGE=python:3.11-slim
FROM ${PYTHON_IMAGE}
ARG INSTALL_ML=false
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 HF_HOME=/models
WORKDIR /srv
COPY requirements.txt requirements-ml.txt ./
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export PIP_CERT=/run/secrets/extra_ca; fi \
 && pip install -r requirements.txt \
 && if [ "$INSTALL_ML" = "true" ]; then \
      apt-get update && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libgomp1 && rm -rf /var/lib/apt/lists/* \
      && pip install --extra-index-url https://download.pytorch.org/whl/cpu -r requirements-ml.txt; \
    fi \
 && useradd -r -u 10001 worker && mkdir -p /models && chown worker /models
COPY app ./app
USER worker
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=5s --retries=5 CMD python -c "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=3).status==200 else 1)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
