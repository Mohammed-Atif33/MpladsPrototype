"""Secure file handling: content sniffing, size limits, server-generated names,
no client-controlled paths, no SVG/HTML uploads."""
from __future__ import annotations

import hashlib
import re
import uuid
from pathlib import Path

import pymupdf as fitz  # PyMuPDF
from fastapi import HTTPException, UploadFile

from ..config import get_settings

IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp"}
PDF_TYPE = {"application/pdf": ".pdf"}
VIDEO_TYPES = {"video/mp4": ".mp4"}
MAX_VIDEO_MB = 25
MAX_PDF_PAGES = 60


class FileRejected(HTTPException):
    def __init__(self, msg: str, code: int = 400):
        super().__init__(status_code=code, detail=msg)


def sniff(data: bytes) -> str | None:
    if data[:5] == b"%PDF-" or b"%PDF-" in data[:1024]:
        return "application/pdf"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[4:8] == b"ftyp":
        return "video/mp4"
    return None


def safe_display_name(name: str | None) -> str:
    base = Path(name or "file").name
    base = re.sub(r"[^A-Za-z0-9._\- ]", "_", base)[:120]
    return base or "file"


def upload_root() -> Path:
    root = Path(get_settings().upload_dir)
    root.mkdir(parents=True, exist_ok=True)
    return root


async def read_upload(file: UploadFile, allowed: set[str], *, max_mb: int | None = None) -> tuple[bytes, str]:
    """Read an UploadFile fully (bounded), verify content by magic bytes. Returns (data, mime)."""
    limit = (max_mb or get_settings().max_upload_mb) * 1024 * 1024
    data = await file.read(limit + 1)
    if not data:
        raise FileRejected("The uploaded file is empty.")
    if len(data) > limit:
        raise FileRejected(f"File is too large. Maximum allowed size is {limit // (1024 * 1024)} MB.", 413)
    mime = sniff(data)
    if mime is None or mime not in allowed:
        raise FileRejected("Unsupported or invalid file type. Allowed: " + ", ".join(sorted(t.split('/')[-1].upper() for t in allowed)) + ".", 415)
    if mime == "video/mp4" and len(data) > MAX_VIDEO_MB * 1024 * 1024:
        raise FileRejected(f"Video is too large (max {MAX_VIDEO_MB} MB).", 413)
    return data, mime


def validate_pdf_bytes(data: bytes) -> int:
    """Strict PDF validation. Returns page count or raises FileRejected."""
    if not data.startswith(b"%PDF-"):
        raise FileRejected("This is not a valid PDF file (bad header).", 415)
    lowered = data.lower()
    for token in (b"/javascript", b"/js ", b"/js\n", b"/launch", b"/embeddedfile", b"/richmedia"):
        if token in lowered:
            raise FileRejected("PDF contains active or embedded content (JavaScript/launch/attachments) and was rejected for security.", 422)
    try:
        doc = fitz.open(stream=data, filetype="pdf")
    except Exception:
        raise FileRejected("The PDF appears to be corrupted and could not be opened.", 422)
    try:
        if doc.needs_pass or doc.is_encrypted:
            raise FileRejected("Password-protected PDFs are not supported.", 422)
        n = doc.page_count
        if n < 1:
            raise FileRejected("The PDF has no pages.", 422)
        if n > MAX_PDF_PAGES:
            raise FileRejected(f"The PDF has too many pages (max {MAX_PDF_PAGES}).", 422)
        return n
    finally:
        doc.close()


def save_bytes(data: bytes, subdir: str, mime: str) -> tuple[str, str]:
    """Persist under UPLOAD_DIR/<subdir>/<uuid>.<ext>. Returns (relative_path, sha256)."""
    ext = {**IMAGE_TYPES, **PDF_TYPE, **VIDEO_TYPES}[mime]
    rel = f"{subdir}/{uuid.uuid4().hex}{ext}"
    dest = upload_root() / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    return rel, hashlib.sha256(data).hexdigest()


def resolve_path(rel: str) -> Path:
    """Resolve a stored relative path, guarding against traversal."""
    root = upload_root().resolve()
    p = (root / rel).resolve()
    if root not in p.parents:
        raise HTTPException(404, "File not found.")
    if not p.exists():
        raise HTTPException(404, "File not found.")
    return p
