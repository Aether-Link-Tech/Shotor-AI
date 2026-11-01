from collections import defaultdict, deque
from time import monotonic
from threading import Lock
from fastapi import HTTPException, Request
_hits = defaultdict(deque)
_lock = Lock()
def limit(request: Request, action: str, maximum: int = 10, window: int = 60):
    # Development-only, process-local limiter. Replace with Redis for multi-worker production.
    key = f"{action}:{request.client.host if request.client else 'unknown'}"
    now = monotonic()
    with _lock:
        q = _hits[key]
        while q and q[0] <= now-window: q.popleft()
        if len(q) >= maximum: raise HTTPException(status_code=429, detail="Too many requests. Please try again shortly.")
        q.append(now)
