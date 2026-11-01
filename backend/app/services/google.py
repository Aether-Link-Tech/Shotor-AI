import asyncio, base64, html, re
from datetime import datetime, timezone, timedelta
from html.parser import HTMLParser
import httpx
from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException
from app.core.config import settings
from app.models import GoogleConnection

SCOPES = ["openid", "email", "profile", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.send", "https://www.googleapis.com/auth/calendar.readonly"]

# NOTE on status codes: problems with the user's *Google* authorization are reported as 409 (or 403 for a missing
# permission), never 401. Clients treat 401 as "your Shotor session ended" and sign the user out of the app.

def crypto():
    if not settings.google_token_encryption_key: raise HTTPException(503, "Google token encryption is not configured")
    try: return Fernet(settings.google_token_encryption_key.encode())
    except Exception: raise HTTPException(503, "Google token encryption key is invalid")

def encrypt_token(value: str) -> str: return crypto().encrypt(value.encode()).decode()
def decrypt_token(value: str) -> str:
    try: return crypto().decrypt(value.encode()).decode()
    except (InvalidToken, ValueError): raise HTTPException(502, "Stored Google connection could not be decrypted; reconnect Google")

def require_google_config():
    if not settings.google_client_id or not settings.google_client_secret or not settings.google_redirect_uri:
        raise HTTPException(503, "Google OAuth is not configured on this server")

def scopes(connection: GoogleConnection) -> set[str]: return set(connection.scopes.split())

async def access_token(connection: GoogleConnection, required_scope: str | None = None) -> str:
    if required_scope and required_scope not in scopes(connection): raise HTTPException(403, "Reconnect Google and grant the required permission")
    refresh = decrypt_token(connection.encrypted_refresh_token)
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.post("https://oauth2.googleapis.com/token", data={"client_id":settings.google_client_id,"client_secret":settings.google_client_secret,"refresh_token":refresh,"grant_type":"refresh_token"})
        if r.status_code in (400,401): raise HTTPException(409, "Google authorization expired or was revoked. Reconnect Google.")
        r.raise_for_status(); token = r.json().get("access_token")
        if not token: raise HTTPException(502, "Google did not return an access token")
        return token
    except HTTPException: raise
    except httpx.HTTPError: raise HTTPException(502, "Google service is temporarily unavailable")

async def google_get(url: str, token: str, params=None):
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.get(url, headers={"Authorization":f"Bearer {token}"}, params=params)
        if r.status_code == 401: raise HTTPException(409, "Google authorization expired. Reconnect Google.")
        if r.status_code == 403: raise HTTPException(403, "Google permission is missing or the API is disabled")
        if r.status_code == 404: raise HTTPException(404, "Google resource was not found")
        r.raise_for_status(); return r.json()
    except HTTPException: raise
    except httpx.HTTPError: raise HTTPException(502, "Google service is temporarily unavailable")

def _headers(msg) -> dict:
    return {h["name"].lower(): h["value"] for h in msg.get("payload", {}).get("headers", [])}

async def gmail_messages(connection: GoogleConnection, limit: int = 20):
    token = await access_token(connection, "https://www.googleapis.com/auth/gmail.readonly")
    data = await google_get("https://gmail.googleapis.com/gmail/v1/users/me/messages", token, {"maxResults":limit,"labelIds":"INBOX"})
    gate = asyncio.Semaphore(5)
    async def fetch(item):
        async with gate:
            try: return await google_get(f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{item['id']}", token, {"format":"metadata","metadataHeaders":["From","To","Subject","Date"]})
            except HTTPException as exc:
                if exc.status_code == 404: return None          # deleted between the list call and the fetch
                raise
    fetched = await asyncio.gather(*(fetch(item) for item in data.get("messages", [])[:limit]))
    out = []
    for msg in fetched:
        if not msg: continue
        h = _headers(msg)
        out.append({"id":msg["id"],"thread_id":msg.get("threadId",""),"from":h.get("from","Unknown sender"),"to":h.get("to",""),"subject":h.get("subject","(No subject)"),"date":h.get("date",""),"snippet":msg.get("snippet","")[:500]})
    return out

class _TextExtractor(HTMLParser):
    BLOCKS = {"p","div","br","li","tr","h1","h2","h3","h4","h5","h6","blockquote","table"}
    def __init__(self): super().__init__(convert_charrefs=True); self.parts=[]; self.skip=0
    def handle_starttag(self, tag, attrs):
        if tag in ("script","style","head"): self.skip += 1
        elif tag in self.BLOCKS: self.parts.append("\n")
    def handle_endtag(self, tag):
        if tag in ("script","style","head"): self.skip = max(0, self.skip-1)
        elif tag in self.BLOCKS: self.parts.append("\n")
    def handle_data(self, data):
        if not self.skip: self.parts.append(data)

def html_to_text(markup: str) -> str:
    parser = _TextExtractor()
    try: parser.feed(markup); parser.close()
    except Exception: return html.unescape(re.sub(r"<[^>]+>", " ", markup))
    text = "".join(parser.parts).replace("\xa0", " ")
    text = re.sub(r"[ \t]+", " ", text); text = re.sub(r"\s*\n\s*", "\n", text)
    return text.strip()

def _b64(data: str) -> str:
    raw = data.replace("-","+").replace("_","/")
    try: return base64.b64decode(raw + "="*((4-len(raw)%4)%4)).decode("utf-8",errors="replace")
    except Exception: return ""

def _find_part(part, mime: str) -> str:
    """Depth-first search for the first non-attachment part of the given MIME type that has inline data."""
    if part.get("mimeType","") == mime and part.get("body",{}).get("data") and not part.get("filename"):
        return _b64(part["body"]["data"])
    for child in part.get("parts",[]):
        value = _find_part(child, mime)
        if value: return value
    return ""

def _decode_part(part):
    plain = _find_part(part, "text/plain")
    if plain.strip(): return plain
    markup = _find_part(part, "text/html")           # HTML-only mails (newsletters, many mobile clients)
    return html_to_text(markup) if markup else ""

async def gmail_message(connection: GoogleConnection, message_id: str):
    token=await access_token(connection,"https://www.googleapis.com/auth/gmail.readonly")
    msg=await google_get(f"https://gmail.googleapis.com/gmail/v1/users/me/messages/{message_id}",token,{"format":"full"})
    h=_headers(msg)
    return {"id":msg["id"],"thread_id":msg.get("threadId",""),"from":h.get("from",""),"to":h.get("to",""),"subject":h.get("subject","(No subject)"),"date":h.get("date",""),"snippet":msg.get("snippet",""),"body":_decode_part(msg.get("payload",{}))[:20000]}

async def send_gmail(connection: GoogleConnection, draft):
    """Raises 409/403/422/429 when Google definitively did NOT accept the message (the caller may release the draft for a retry)
    and 502 when the outcome is unknown (timeouts, 5xx) so the caller keeps the draft locked to avoid duplicate delivery."""
    token=await access_token(connection,"https://www.googleapis.com/auth/gmail.send")
    import email.message
    m=email.message.EmailMessage(); m["To"]=draft.recipient; m["Subject"]=draft.subject; m.set_content(draft.body, charset="utf-8", cte="quoted-printable")
    payload={"raw":base64.urlsafe_b64encode(m.as_bytes()).decode().rstrip("=")}
    if draft.thread_id: payload["threadId"]=draft.thread_id
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            r=await client.post("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",headers={"Authorization":f"Bearer {token}"},json=payload)
        if r.status_code == 401: raise HTTPException(409,"Google authorization expired. Reconnect Google.")
        if r.status_code == 403: raise HTTPException(403,"Google rejected the send request. Reconnect or check Gmail permissions.")
        if r.status_code == 429: raise HTTPException(429,"Gmail sending limit reached. Please try again later.")
        if 400 <= r.status_code < 500: raise HTTPException(422,"Gmail rejected this message. Check the recipient, subject and body.")
        r.raise_for_status(); return r.json()
    except HTTPException: raise
    except httpx.HTTPError: raise HTTPException(502,"Email could not be sent. Check Gmail Sent before trying again.")

async def calendar_events(connection: GoogleConnection, limit: int=30):
    token=await access_token(connection,"https://www.googleapis.com/auth/calendar.readonly")
    now=datetime.now(timezone.utc).isoformat().replace("+00:00","Z")
    end=(datetime.now(timezone.utc)+timedelta(days=7)).isoformat().replace("+00:00","Z")
    data=await google_get("https://www.googleapis.com/calendar/v3/calendars/primary/events",token,{"timeMin":now,"timeMax":end,"maxResults":limit,"singleEvents":"true","orderBy":"startTime"})
    out=[]
    for e in data.get("items",[]):
        if e.get("status")=="cancelled": continue
        start=e.get("start",{}).get("dateTime") or e.get("start",{}).get("date")
        finish=e.get("end",{}).get("dateTime") or e.get("end",{}).get("date")
        if not start or not finish: continue
        out.append({"id":e["id"],"summary":e.get("summary","(No title)"),"start":start,"end":finish,"location":e.get("location"),"html_link":e.get("htmlLink")})
    return out
