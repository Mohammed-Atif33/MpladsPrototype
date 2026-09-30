from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import permissions as P
from ..database import get_db
from ..deps import client_ip, get_current_user, has_perm, require
from ..models import Complaint, Document, Inspection, Project, User
from ..services import file_storage as FS
from ..services import notify, serializers as S
from ..services.audit import log_audit
from .common import names, project_or_404

router = APIRouter(tags=["documents"])

DOC_TYPES = ["Photo", "Progress Evidence", "Bill / Invoice", "Certificate", "Other"]


@router.post("/api/projects/{project_id}/documents", status_code=201)
async def upload_document(
    project_id: int, request: Request, file: UploadFile = File(...), document_type: str = Form("Photo"),
    description: str = Form(""), is_public: bool = Form(False),
    user: User = Depends(require("document:upload")), db: Session = Depends(get_db),
):
    project = project_or_404(db, project_id)
    if user.role == P.AGENCY and project.agency_id != user.agency_id:
        raise HTTPException(404, "Project not found.")
    if document_type not in DOC_TYPES:
        raise HTTPException(422, f"Document type must be one of: {', '.join(DOC_TYPES)}.")
    data, mime = await FS.read_upload(file, {*FS.IMAGE_TYPES, "application/pdf"})
    if mime == "application/pdf":
        FS.validate_pdf_bytes(data)
    rel, sha = FS.save_bytes(data, f"projects/{project.project_id}", mime)
    name = FS.safe_display_name(file.filename)
    prev_version = db.scalar(select(func.max(Document.version)).where(
        Document.project_id == project.project_id, Document.document_type == document_type, Document.file_name == name)) or 0
    doc = Document(project_id=project.project_id, document_type=document_type, file_name=name, file_path=rel,
                   content_type=mime, size_bytes=len(data), sha256=sha, version=prev_version + 1,
                   is_public=bool(is_public), description=description.strip()[:255] or None, uploaded_by=user.user_id)
    db.add(doc)
    db.flush()
    log_audit(db, user, "Document Version Change" if prev_version else "Document Upload", "Document", doc.document_id,
              project_id=project.project_id,
              previous={"version": prev_version} if prev_version else None,
              new={"file_name": name, "type": document_type, "version": doc.version, "public": doc.is_public},
              reason=description.strip()[:200] or None, ip=client_ip(request))
    if user.role == P.AGENCY:
        notify.notify(db, notify.officers(db), "Agency response", f"{user.name} uploaded '{name}' ({document_type}) for "
                      f"{project.project_code}.", "info", project_id=project.project_id, entity_type="Document", entity_id=doc.document_id)
    db.commit()
    return S.document(doc, names(db, {doc.uploaded_by}))


def _can_view(db: Session, user: User, doc: Document) -> bool:
    if has_perm(user, "document:view_internal"):
        return True
    project = db.get(Project, doc.project_id) if doc.project_id else None
    if user.role == P.CITIZEN:
        if doc.complaint_id:
            c = db.get(Complaint, doc.complaint_id)
            return bool(c and c.citizen_id == user.user_id)
        if doc.inspection_id:
            insp = db.get(Inspection, doc.inspection_id)
            if insp and insp.status in ("Scheduled", "Completed", "Report Submitted", "Action Pending", "Closed"):
                is_pub = bool(doc.is_public or getattr(doc, "visibility", "INTERNAL") == "PUBLIC")
                is_approved = getattr(doc, "moderation_status", "APPROVED") != "REJECTED"
                return bool(is_pub and is_approved and project and project.is_public and project.verification_status == "Verified")
            return False
        return bool((doc.is_public or getattr(doc, "visibility", "INTERNAL") == "PUBLIC") and project and project.is_public and project.verification_status == "Verified")
    if user.role == P.AGENCY:
        if not project or project.agency_id != user.agency_id:
            return False
        if doc.inspection_id:
            return False
        if doc.complaint_id:
            c = db.get(Complaint, doc.complaint_id)
            return bool(c and c.screening_status == "Verified")
        return True
    return False


@router.get("/api/documents/{document_id}/file")
def download(document_id: int, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    doc = db.get(Document, document_id)
    if not doc or not _can_view(db, user, doc):
        raise HTTPException(404, "Document not found.")
    path = FS.resolve_path(doc.file_path)
    return FileResponse(path, media_type=doc.content_type or "application/octet-stream", filename=doc.file_name,
                        content_disposition_type="inline", headers={"X-Content-Type-Options": "nosniff",
                                                                    "Cache-Control": "private, max-age=300"})
