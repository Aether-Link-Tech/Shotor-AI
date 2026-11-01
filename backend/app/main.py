from contextlib import asynccontextmanager
import logging
from uuid import uuid4
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from app.core.config import settings
from app.db import Base, engine
from app import models  # noqa: F401 ensures models are registered
from app.api.routes import auth, documents, assistant, google, gmail, calendar, account

@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.app_env != "production":
        Base.metadata.create_all(bind=engine)
    settings.upload_path  # creates the upload directory
    yield

app = FastAPI(title="Shotor AI Assistant API", version="1.0.0", lifespan=lifespan)
logger = logging.getLogger("shot_or.api")

@app.middleware("http")
async def security_headers_and_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", "")[:80] or str(uuid4())
    content_length = request.headers.get("content-length")
    if content_length and content_length.isdigit() and int(content_length) > settings.max_upload_size_mb * 1024 * 1024 + 1024 * 1024:
        return JSONResponse(status_code=413, content={"detail": "Request body exceeds the configured upload limit", "request_id": request_id}, headers={"X-Request-ID": request_id})
    try:
        response = await call_next(request)
    except Exception:
        logger.exception("Unhandled API exception request_id=%s path=%s", request_id, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "An unexpected server error occurred", "request_id": request_id}, headers={"X-Request-ID": request_id})
    response.headers["X-Request-ID"] = request_id
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["Cache-Control"] = "no-store"
    return response

# Added AFTER the middleware above, so CORS is the outermost layer and its headers also appear on responses that the
# layer above generates itself (413 / 500). Without that, browsers report those errors as opaque "CORS failures".
# The API authenticates with a bearer header (no cookies), so credentials are not enabled.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
    expose_headers=["X-Request-ID"],
)

for router in (auth.router, documents.router, assistant.router, google.router, gmail.router, calendar.router, account.router):
    app.include_router(router, prefix="/api/v1")

@app.exception_handler(Exception)
async def unexpected_error(request: Request, exc: Exception):
    # Avoid returning internals or user data in error responses.
    return JSONResponse(status_code=500, content={"detail":"An unexpected server error occurred"})

@app.get("/health")
def health(): return {"status":"ok"}

@app.get("/ready")
def ready():
    try:
        with engine.connect() as connection: connection.execute(text("SELECT 1"))
        return {"status":"ready","database":"ok"}
    except Exception:
        return JSONResponse(status_code=503, content={"status":"not_ready","database":"unavailable"})

# The web UI is served by the API itself (same origin => no CORS, one process to start). Must be registered last,
# because a mount at "/" matches every path that no route above handled.
if settings.frontend_path:
    app.mount("/", StaticFiles(directory=str(settings.frontend_path), html=True), name="frontend")
