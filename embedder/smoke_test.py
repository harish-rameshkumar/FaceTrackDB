"""Smoke test for the running embedder, using InsightFace's bundled sample images.
Run inside the container:  docker compose exec embedder python smoke_test.py
"""
import os
import sys

import cv2
import numpy as np
import urllib.request
import json
from insightface.data import get_image

URL = os.environ.get("SMOKE_URL", "http://127.0.0.1:8000")
TOKEN = os.environ["EMBEDDER_TOKEN"]
failures = 0


def check(name, ok, detail=""):
    global failures
    print(("PASS" if ok else "FAIL"), name, detail)
    if not ok:
        failures += 1


def post(data, token=TOKEN):
    req = urllib.request.Request(URL + "/embed", data=data, headers={"X-Embedder-Token": token}, method="POST")
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())


with urllib.request.urlopen(URL + "/health") as r:
    check("health", json.loads(r.read())["status"] == "ok")

img = get_image("t1")  # InsightFace's bundled group photo
ok, jpg = cv2.imencode(".jpg", img)
res = post(jpg.tobytes())
check("detects faces in the sample image", res["count"] >= 2, f"count={res['count']}")
face = res["face"]
check("returns a 512-d embedding", face is not None and len(face["embedding"]) == 512)
norm = float(np.linalg.norm(face["embedding"]))
check("embedding is L2-normalised", abs(norm - 1) < 1e-4, f"norm={norm:.6f}")
check("det_score, size and blur are present", all(k in face for k in ("det_score", "width", "height", "blur_score")),
      f"det={face['det_score']:.2f} width={face['width']:.0f} blur={face['blur_score']:.0f}")

# the same photo twice must give (almost) the same vector
res2 = post(jpg.tobytes())
cos = float(np.dot(face["embedding"], res2["face"]["embedding"]))
check("deterministic for the same image", cos > 0.999, f"cosine={cos:.5f}")

blank = cv2.imencode(".jpg", np.full((480, 640, 3), 128, np.uint8))[1].tobytes()
res3 = post(blank)
check("blank image has no face", res3["count"] == 0 and res3["face"] is None)

try:
    post(jpg.tobytes(), token="wrong-token-wrong-token")
    check("wrong token is rejected", False)
except urllib.error.HTTPError as e:
    check("wrong token is rejected", e.code == 401, f"HTTP {e.code}")

print("FAILURES:", failures)
sys.exit(1 if failures else 0)
