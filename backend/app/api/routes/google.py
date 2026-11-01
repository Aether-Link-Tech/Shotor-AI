import hashlib, secrets
from datetime import datetime, timezone, timedelta
from urllib.parse import urlencode, urlparse
from uuid import uuid4
import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import select
from app.db import get_db
from app.models import User, GoogleConnection, OAuthState
from app.security import get_current_user
from app.core.config import settings
from app.services.google import SCOPES, require_google_config, encrypt_token, decrypt_token
from app.timeutil import as_utc, utcnow
router=APIRouter(prefix="/google",tags=["Google OAuth"])

# A state value ending in this suffix marks a flow started by the browser app: after Google, the user is sent back to
# the web UI instead of seeing a stand-alone result page (the Android app keeps using the stand-alone page).
WEB_SUFFIX=".web"

def _origin(url:str)->str:
    p=urlparse(url); return f"{p.scheme}://{p.netloc}"

def _frontend_base()->str:
    return settings.frontend_url.rstrip("/")

@router.get("/connect")
def connect(client:str="",user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    require_google_config()
    db.query(OAuthState).filter(OAuthState.expires_at < utcnow()).delete(synchronize_session=False)
    web=client=="web"
    state=secrets.token_urlsafe(32)+(WEB_SUFFIX if web else ""); digest=hashlib.sha256(state.encode()).hexdigest()
    db.add(OAuthState(state_hash=digest,user_id=user.id,expires_at=utcnow()+timedelta(minutes=settings.google_state_ttl_minutes))); db.commit()
    params={"client_id":settings.google_client_id,"redirect_uri":settings.google_redirect_uri,"response_type":"code","scope":" ".join(SCOPES),"access_type":"offline","prompt":"consent","include_granted_scopes":"true","state":state}
    out={"authorization_url":"https://accounts.google.com/o/oauth2/v2/auth?"+urlencode(params)}
    # Browser origin the user will land on afterwards; the web UI warns if it differs from the page they are on
    # (e.g. 127.0.0.1 vs localhost), because the login session lives in per-origin browser storage.
    if web: out["return_origin"]=_origin(settings.frontend_url or settings.google_redirect_uri)
    return out

async def _complete(code:str|None,state:str|None,db:Session):
    if not code or not state: raise HTTPException(400,"Invalid OAuth callback")
    digest=hashlib.sha256(state.encode()).hexdigest(); row=db.get(OAuthState,digest)
    if not row or as_utc(row.expires_at)<=utcnow():
        if row: db.delete(row); db.commit()
        raise HTTPException(400,"OAuth state is invalid or expired. Start the connection again.")
    user_id=row.user_id; db.delete(row); db.commit()
    require_google_config()
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r=await client.post("https://oauth2.googleapis.com/token",data={"code":code,"client_id":settings.google_client_id,"client_secret":settings.google_client_secret,"redirect_uri":settings.google_redirect_uri,"grant_type":"authorization_code"})
        if r.status_code != 200: raise HTTPException(502,"Google authorization could not be completed")
        tokens=r.json(); refresh=tokens.get("refresh_token")
        if not refresh: raise HTTPException(400,"Google did not return a refresh token. Disconnect the app in Google settings and reconnect with consent.")
        async with httpx.AsyncClient(timeout=15) as client:
            info=await client.get("https://openidconnect.googleapis.com/v1/userinfo",headers={"Authorization":"Bearer "+tokens["access_token"]})
        if info.status_code != 200: raise HTTPException(502,"Could not verify Google account")
        profile=info.json(); existing=db.scalar(select(GoogleConnection).where(GoogleConnection.user_id==user_id))
        if existing:
            existing.google_email=profile.get("email",""); existing.encrypted_refresh_token=encrypt_token(refresh); existing.scopes=tokens.get("scope",_scopes_default())
        else:
            db.add(GoogleConnection(id=str(uuid4()),user_id=user_id,google_email=profile.get("email",""),encrypted_refresh_token=encrypt_token(refresh),scopes=tokens.get("scope",_scopes_default())))
        db.commit()
    except HTTPException: raise
    except Exception: raise HTTPException(502,"Google connection failed. Check server configuration and try again.")

def _scopes_default()->str: return " ".join(SCOPES)

@router.get("/callback",response_class=HTMLResponse)
async def callback(code:str|None=None,state:str|None=None,error:str|None=None,db:Session=Depends(get_db)):
    web=bool(state) and state.endswith(WEB_SUFFIX)
    back=lambda result: RedirectResponse(f"{_frontend_base()}/?google={result}",status_code=303)
    if error:
        if web: return back("cancelled")
        return HTMLResponse("<h2>Google connection was cancelled.</h2><p>Return to Shotor and try again if you wish.</p>",status_code=400)
    try:
        await _complete(code,state,db)
    except HTTPException:
        if web: return back("error")
        raise
    if web: return back("connected")
    return HTMLResponse("<main style='font-family:sans-serif;padding:2rem'><h2>Google connected</h2><p>Return to Shotor AI Assistant and refresh connection status.</p></main>")

@router.get("/status")
def status(user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    c=db.scalar(select(GoogleConnection).where(GoogleConnection.user_id==user.id))
    return {"connected":bool(c),"google_email":c.google_email if c else None,"scopes":c.scopes.split() if c else []}

@router.delete("/disconnect",status_code=204)
async def disconnect(user:User=Depends(get_current_user),db:Session=Depends(get_db)):
    c=db.scalar(select(GoogleConnection).where(GoogleConnection.user_id==user.id))
    if c:
        try:
            # Best effort revoke using the refresh token; local cleanup always proceeds.
            refresh=decrypt_token(c.encrypted_refresh_token)
            async with httpx.AsyncClient(timeout=8) as client: await client.post("https://oauth2.googleapis.com/revoke",params={"token":refresh})
        except Exception: pass
        db.delete(c); db.commit()
    return None
