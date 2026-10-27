# Embedder: face detection and embedding service

A small FastAPI service. It is the only place where a face image is analysed.

- **Detector:** SCRFD (`det_10g`), **recogniser:** ArcFace `w600k_r50` (512-d), both from InsightFace's `buffalo_l` model pack, run on onnxruntime (CPU).
- `GET /health` -> `{"status":"ok","model":"buffalo_l"}` (no token).
- `POST /embed` with the raw JPEG/PNG bytes as body and header `X-Embedder-Token: <EMBEDDER_TOKEN>` -> `{ image: {width, height}, count, face }`. `face` is `null` when nothing was detected; otherwise it describes the **largest** face: `embedding` (512 numbers, L2-normalised), `det_score`, `width`, `height`, `bbox` (pixels) and `blur_score` (variance of the Laplacian over the face crop resized to 160x160; higher = sharper).
- It only measures. Whether an image is good enough (one face, score, size, blur) is decided by the Next.js app (`app/lib/quality.ts`).

Only the Next.js server calls it. In `docker-compose.yml` it is published on `127.0.0.1:8001` only, and every `/embed` call needs the shared secret.

## Run it (Docker, the normal way)
```bash
# EMBEDDER_TOKEN (>= 16 chars) must be in the repo-root .env, and EMBEDDER_URL / EMBEDDER_TOKEN in app/.env.local
docker compose up -d --build embedder
docker compose logs -f embedder     # first start downloads the model pack (~280 MB) into the insightface_models volume
```
The first build compiles InsightFace's small C extension (a few minutes); it built without changes on Apple Silicon (arm64). Later starts take a few seconds because the models stay in the named volume.

## Smoke test
Uses InsightFace's own bundled sample image (a group photo with 6 faces):
```bash
docker compose exec embedder python smoke_test.py
```
It asserts that faces are detected, that the largest face's embedding has 512 numbers and unit length, that the same image gives the same vector, that a blank image has no face and that a wrong token gets HTTP 401.

## Without Docker (local virtualenv)
The app depends only on `EMBEDDER_URL`, so this works too:
```bash
cd embedder
python3.11 -m venv .venv && . .venv/bin/activate     # Python 3.10 to 3.12; needs a C compiler for InsightFace
pip install -r requirements.txt
EMBEDDER_TOKEN=<same value as in app/.env.local> uvicorn app:app --host 127.0.0.1 --port 8001
```
Models are downloaded to `~/.insightface/models/buffalo_l` on first start. Use `EMBEDDER_URL=http://127.0.0.1:8001`.
This path was NOT run on this machine (the Docker route worked first time); it is documented for machines where the image cannot be built.

## Licence note
InsightFace's pretrained model packs (including `buffalo_l`) are provided for **non-commercial research use only**. FaceTrackDB is a university DBMS project, which fits that terms; do not deploy it commercially with these weights. A different recogniser would have to be swapped in for any commercial use.
