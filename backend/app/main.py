"""MPLADS Risk Intelligence Platform - FastAPI application (also serves the built React frontend)."""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import date, timedelta
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.exc import SQLAlchemyError
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import ROOT_DIR, get_settings
from .database import SessionLocal
from .routers import (agency, audit, auth, complaints, decisions, documents, extractions, inspections, notifications,
                      projects, system, users)

log = logging.getLogger("mplads")
settings = get_settings()


async def _scheduler():
    """Background supervisory checks (overdue inspections, unresolved cases, ...). First run after 6 hours."""
    from .services.workflow import run_supervisory_checks

    while True:
        await asyncio.sleep(6 * 3600)
        try:
            def job():
                with SessionLocal() as db:
                    run_supervisory_checks(db, date.today(), None)
                    db.commit()
            await asyncio.to_thread(job)
        except Exception:
            log.exception("Scheduled supervisory checks failed")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from database.seed import init_database

    await asyncio.to_thread(init_database, False, settings.seed_on_startup)
    if settings.seed_on_startup:
        try:
            from database.generate_sample_pdfs import main as make_pdfs

            make_pdfs(date.today() - timedelta(days=3))
        except Exception:
            log.exception("Could not regenerate sample PDFs")
    task = asyncio.create_task(_scheduler()) if settings.enable_scheduler else None
    yield
    if task:
        task.cancel()


app = FastAPI(
    title="MPLADS Risk Intelligence Platform", version="1.0.0", lifespan=lifespan,
    docs_url="/api/docs" if settings.app_env != "production" else None,
    redoc_url=None, openapi_url="/api/openapi.json" if settings.app_env != "production" else None,
)

app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
                   allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"], allow_headers=["Authorization", "Content-Type"])


@app.middleware("http")
async def security_headers(request: Request, call_next):
    resp = await call_next(request)
    resp.headers.setdefault("X-Content-Type-Options", "nosniff")
    resp.headers.setdefault("X-Frame-Options", "DENY")
    resp.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")  # OSM tiles require a referrer
    if not request.url.path.startswith("/api/docs"):
        resp.headers.setdefault(
            "Content-Security-Policy",
            "default-src 'self'; img-src 'self' data: blob: https://*.tile.openstreetmap.org; "
            "style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; "
            "object-src 'self' blob:; frame-src 'self' blob:")
    if request.url.path.startswith("/api/"):
        resp.headers.setdefault("Cache-Control", "no-store")
    return resp


# ------------------------------------------------------------------ friendly error handling (no stack traces / secrets)
@app.exception_handler(RequestValidationError)
async def validation_handler(request: Request, exc: RequestValidationError):
    errors = []
    for e in exc.errors():
        loc = [str(x) for x in e.get("loc", []) if x not in ("body", "query", "path", "form")]
        errors.append({"field": ".".join(loc), "message": e.get("msg", "Invalid value")})
    msg = "; ".join(f"{x['field'] + ': ' if x['field'] else ''}{x['message']}" for x in errors) or "Invalid request."
    return JSONResponse(status_code=422, content={"detail": msg, "errors": errors})


@app.exception_handler(SQLAlchemyError)
async def db_handler(request: Request, exc: SQLAlchemyError):
    log.exception("Database error on %s", request.url.path)
    return JSONResponse(status_code=503, content={"detail": "A database error occurred. Please try again shortly."})


@app.exception_handler(Exception)
async def generic_handler(request: Request, exc: Exception):
    log.exception("Unhandled error on %s", request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Something went wrong on our side. Please try again."})


@app.exception_handler(StarletteHTTPException)
async def http_handler(request: Request, exc: StarletteHTTPException):
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail}, headers=getattr(exc, "headers", None))


for r in (auth, projects, extractions, documents, complaints, agency, inspections, decisions, notifications, audit, system, users):
    app.include_router(r.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# ------------------------------------------------------------------ serve the built React app (single-container deployment)
DIST = Path(settings.frontend_dist)
if DIST.exists():
    if (DIST / "assets").exists():
        app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def spa(full_path: str):
        if full_path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found."})
        candidate = (DIST / full_path).resolve()
        if full_path and DIST.resolve() in candidate.parents and candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(DIST / "index.html")
