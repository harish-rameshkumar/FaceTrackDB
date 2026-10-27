# Face embedding service: InsightFace buffalo_l (SCRFD detector + ArcFace 512-d)
# on onnxruntime CPU. The model pack is downloaded on first start into the
# insightface_models volume and reused afterwards.
FROM python:3.11-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential libgomp1 curl \
 && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --uid 1000 app \
 && mkdir -p /home/app/.insightface && chown -R app:app /home/app
WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py smoke_test.py ./
USER app
ENV HOME=/home/app
EXPOSE 8000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
