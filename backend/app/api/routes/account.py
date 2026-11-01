from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.db import get_db
from app.models import User, GoogleConnection, UserSession, Document, OAuthState, EmailDraft
from app.schemas import AccountDeleteRequest
from app.security import get_current_user, verify_password
from app.services.google import decrypt_token
from app.core.config import settings
import httpx, logging
logger=logging.getLogger("shot_or.account")
router=APIRouter(prefix="/account",tags=["Account"])
@router.delete("/me",status_code=204)
async def delete_account(body:AccountDeleteRequest,user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    if not verify_password(body.password,user.password_hash): raise HTTPException(403,"Password confirmation failed")
    c=db.scalar(select(GoogleConnection).where(GoogleConnection.user_id==user.id))
    if c:
        try:
            token=decrypt_token(c.encrypted_refresh_token)
            async with httpx.AsyncClient(timeout=8) as client: await client.post("https://oauth2.googleapis.com/revoke",params={"token":token})
        except Exception: logger.warning("Google token revocation was not confirmed during account deletion")
    # Delete private original files before removing document rows. Local account deletion still succeeds if a file is already absent.
    docs=db.scalars(select(Document).where(Document.user_id==user.id)).all()
    for d in docs:
        try: (settings.upload_path/d.stored_filename).unlink(missing_ok=True)
        except OSError: logger.error("Could not remove a private upload during account deletion")
    try:
        # Explicit child deletes make cleanup reliable even when SQLite FK enforcement is not enabled.
        db.query(EmailDraft).filter(EmailDraft.user_id==user.id).delete(synchronize_session=False)
        db.query(OAuthState).filter(OAuthState.user_id==user.id).delete(synchronize_session=False)
        db.query(UserSession).filter(UserSession.user_id==user.id).delete(synchronize_session=False)
        db.query(Document).filter(Document.user_id==user.id).delete(synchronize_session=False)
        db.query(GoogleConnection).filter(GoogleConnection.user_id==user.id).delete(synchronize_session=False)
        db.delete(user); db.commit()
    except Exception:
        db.rollback(); raise HTTPException(500,"Account deletion could not be completed. Please retry.")
    return None
