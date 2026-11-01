from pathlib import Path
from io import BytesIO
import logging
from fastapi import HTTPException, UploadFile
from pypdf import PdfReader
from docx import Document as DocxDocument
from docx.table import Table
from docx.text.paragraph import Paragraph
from app.core.config import settings

logger = logging.getLogger("shot_or.documents")

# Plain-text formats are read as text; PDF and DOCX have dedicated extractors.
TEXT_TYPES = {".txt": "text/plain", ".md": "text/markdown", ".csv": "text/csv", ".json": "application/json"}
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
ALLOWED = {".pdf", ".docx", *TEXT_TYPES}


def decode_text(raw: bytes) -> str:
    """Decode user text files of unknown encoding (UTF-8 first, then Windows-1252 / Latin-1 which never fails)."""
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    if b"\x00" in raw[:8192]:
        raise ValueError("binary data")
    for encoding in ("utf-8-sig", "cp1252"):
        try: return raw.decode(encoding)
        except UnicodeDecodeError: continue
    return raw.decode("latin-1")


def docx_text(doc) -> str:
    """Paragraphs and table cells in document order."""
    lines = []
    for child in doc.element.body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            lines.append(Paragraph(child, doc).text)
        elif tag == "tbl":
            for row in Table(child, doc).rows:
                seen, cells = [], []
                for cell in row.cells:
                    if any(cell._tc is s for s in seen): continue      # merged cells repeat the same underlying cell
                    seen.append(cell._tc)
                    if cell.text.strip(): cells.append(cell.text.strip())
                if cells: lines.append(" | ".join(cells))
    return "\n".join(lines)


def pdf_text(raw: bytes) -> str:
    # strict=False: real-world PDFs are often slightly malformed; pypdf can still read them.
    reader = PdfReader(BytesIO(raw), strict=False)
    if reader.is_encrypted:
        try:
            if not reader.decrypt(""): raise HTTPException(422, "Encrypted PDFs are not supported")
        except HTTPException: raise
        except Exception: raise HTTPException(422, "Encrypted PDFs are not supported")
    pages = []
    for number, page in enumerate(reader.pages, 1):
        try: pages.append(page.extract_text() or "")
        except Exception:
            logger.warning("Skipping unreadable PDF page %s", number)
    return "\n".join(pages)


async def read_upload(upload: UploadFile) -> tuple[str, str, bytes]:
    name = Path(upload.filename or "document").name
    suffix = Path(name).suffix.lower()
    if suffix not in ALLOWED: raise HTTPException(415, "Supported document types are PDF, DOCX, TXT, MD, CSV, and JSON")
    raw = await upload.read(settings.max_upload_size_mb * 1024 * 1024 + 1)
    if not raw: raise HTTPException(400, "The uploaded file is empty")
    if len(raw) > settings.max_upload_size_mb * 1024 * 1024: raise HTTPException(413, f"File exceeds {settings.max_upload_size_mb} MB limit")
    try:
        if suffix in TEXT_TYPES:
            text = decode_text(raw)
            content_type = TEXT_TYPES[suffix]
        elif suffix == ".pdf":
            if b"%PDF-" not in raw[:1024]: raise ValueError("Invalid PDF signature")
            text = pdf_text(raw)
            content_type = "application/pdf"
        else:
            if not raw.startswith(b"PK"): raise ValueError("Invalid DOCX file signature")
            text = docx_text(DocxDocument(BytesIO(raw)))
            content_type = DOCX_TYPE
    except HTTPException: raise
    except Exception: raise HTTPException(422, "The file is unreadable or is not a valid supported document")
    text = text.strip()
    if not text: raise HTTPException(422, "No extractable text was found. Scanned PDFs need OCR, which is not enabled.")
    if len(text) > settings.max_extracted_text_chars: raise HTTPException(413, "Extracted text exceeds the configured limit")
    return text, content_type, raw
