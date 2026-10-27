"""FaceTrackDB embedding service.

POST /embed  (raw JPEG/PNG bytes, header X-Embedder-Token)
  -> { image: {width, height}, count, face: null | { embedding[512], det_score,
       width, height, bbox[4], blur_score } }
GET /health -> { status, model }

`face` describes the LARGEST detected face. The embedding is the ArcFace
vector, L2-normalised. Quality decisions (how many faces, how sharp, how
big) are made by the Next.js app, not here; this service only measures.

InsightFace's pretrained model packs are for non-commercial research use
only (this is a university project).
"""
import hmac
import os
import threading

import cv2
import numpy as np
from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from insightface.app import FaceAnalysis

MODEL = os.environ.get("EMBEDDER_MODEL", "buffalo_l")
TOKEN = os.environ.get("EMBEDDER_TOKEN", "")
MAX_BYTES = 8 * 1024 * 1024

if len(TOKEN) < 16:
    raise SystemExit("EMBEDDER_TOKEN must be set to a random string of at least 16 characters")

_face_app = FaceAnalysis(
    name=MODEL,
    providers=["CPUExecutionProvider"],
    allowed_modules=["detection", "recognition"],
)
_face_app.prepare(ctx_id=-1, det_size=(640, 640), det_thresh=0.5)
_lock = threading.Lock()  # one inference at a time keeps memory predictable

app = FastAPI(title="FaceTrackDB embedder", docs_url=None, redoc_url=None, openapi_url=None)


def blur_score(img: np.ndarray, bbox: np.ndarray) -> float:
    """Variance of the Laplacian over the face crop, resized to 160x160 so the
    number does not depend on how large the face is. Higher = sharper."""
    h, w = img.shape[:2]
    x1, y1, x2, y2 = [int(v) for v in bbox]
    x1, y1, x2, y2 = max(x1, 0), max(y1, 0), min(x2, w), min(y2, h)
    if x2 - x1 < 2 or y2 - y1 < 2:
        return 0.0
    crop = cv2.cvtColor(img[y1:y2, x1:x2], cv2.COLOR_BGR2GRAY)
    crop = cv2.resize(crop, (160, 160), interpolation=cv2.INTER_AREA)
    return float(cv2.Laplacian(crop, cv2.CV_64F).var())


def analyse(data: bytes) -> dict:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(status_code=400, detail="not an image")
    with _lock:
        faces = _face_app.get(img)
    out = {"image": {"width": int(img.shape[1]), "height": int(img.shape[0])}, "count": len(faces), "face": None}
    if faces:
        f = max(faces, key=lambda x: (x.bbox[2] - x.bbox[0]) * (x.bbox[3] - x.bbox[1]))
        emb = np.asarray(f.embedding, dtype=np.float64)
        emb = emb / np.linalg.norm(emb)
        out["face"] = {
            "embedding": [float(x) for x in emb],
            "det_score": float(f.det_score),
            "width": float(f.bbox[2] - f.bbox[0]),
            "height": float(f.bbox[3] - f.bbox[1]),
            "bbox": [float(x) for x in f.bbox],
            "blur_score": blur_score(img, f.bbox),
        }
    return out


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL}


@app.post("/embed")
async def embed(request: Request, x_embedder_token: str = Header(default="")):
    if not hmac.compare_digest(x_embedder_token.encode(), TOKEN.encode()):
        raise HTTPException(status_code=401, detail="bad token")
    data = await request.body()
    if not data:
        raise HTTPException(status_code=400, detail="empty body")
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=413, detail="image too large")
    return await run_in_threadpool(analyse, data)
