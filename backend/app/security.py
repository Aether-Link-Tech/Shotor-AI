from datetime import datetime, timedelta, timezone
from uuid import uuid4
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session
from app.core.config import settings
from app.db import get_db
from app.models import User, UserSession
from app.timeutil import as_utc

password_hash = PasswordHasher()
bearer = HTTPBearer(auto_error=False)

def hash_password(password: str) -> str:
    return password_hash.hash(password)

def verify_password(password: str, hashed: str) -> bool:
    try: return password_hash.verify(hashed, password)
    except Exception: return False

def create_session(db: Session, user: User) -> tuple[str, int]:
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=settings.access_token_expire_minutes)
    sid = str(uuid4())
    # Housekeeping: drop this user's expired/revoked sessions so the table does not grow forever.
    db.query(UserSession).filter(UserSession.user_id == user.id, (UserSession.expires_at < now) | (UserSession.revoked_at.is_not(None))).delete(synchronize_session=False)
    db.add(UserSession(id=sid, user_id=user.id, expires_at=expires))
    db.commit()
    token = jwt.encode({"sub": user.id, "sid": sid, "iat": now, "exp": expires}, settings.secret_key, algorithm="HS256")
    return token, int((expires-now).total_seconds())

def get_current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db: Session = Depends(get_db)) -> User:
    if not credentials: raise HTTPException(status_code=401, detail="Authentication required")
    try:
        payload = jwt.decode(credentials.credentials, settings.secret_key, algorithms=["HS256"])
        user_id, sid = payload.get("sub"), payload.get("sid")
        if not user_id or not sid: raise ValueError("missing claims")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired access token")
    session = db.get(UserSession, sid)
    if not session or session.user_id != user_id or session.revoked_at is not None:
        raise HTTPException(status_code=401, detail="Session is no longer active")
    if as_utc(session.expires_at) <= datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = db.get(User, user_id)
    if not user: raise HTTPException(status_code=401, detail="Account no longer exists")
    return user
