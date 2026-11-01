"""Fake Google + Ollama HTTP servers used by the tests.

They plug in at the httpx transport layer, so app/services/google.py and app/services/ai.py
run completely unmodified (real request building, real error mapping)."""
import base64, json
from urllib.parse import parse_qs
import httpx

SCOPES = ["openid", "email", "profile",
          "https://www.googleapis.com/auth/gmail.readonly",
          "https://www.googleapis.com/auth/gmail.send",
          "https://www.googleapis.com/auth/calendar.readonly"]

def b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")

def header_list(**h):
    return [{"name": k.replace("_", "-").title(), "value": v} for k, v in h.items()]

MESSAGES = {
    # multipart/alternative: text/plain + text/html
    "m1": {"id": "m1", "threadId": "t1", "snippet": "Can we meet on Friday?",
           "payload": {"mimeType": "multipart/alternative",
                       "headers": header_list(From="Alice Example <alice@example.com>", To="me@example.com",
                                              Subject="Meeting Friday", Date="Mon, 20 Oct 2026 10:00:00 +0000"),
                       "parts": [{"mimeType": "text/plain", "body": {"data": b64("Hi,\nCan we meet on Friday?\nAlice")}},
                                 {"mimeType": "text/html", "body": {"data": b64("<p>Hi,<br>Can we meet on Friday?</p>")}}]}},
    # HTML only (very common for newsletters / many clients)
    "m2": {"id": "m2", "threadId": "t2", "snippet": "Big sale today",
           "payload": {"mimeType": "text/html",
                       "headers": header_list(From="shop@example.com", To="me@example.com", Subject="Re: Big sale", Date="Tue, 21 Oct 2026 09:00:00 +0000"),
                       "body": {"data": b64("<html><head><style>p{color:red}</style></head><body><h1>Big sale</h1><p>50% off &amp; free shipping</p></body></html>")}}},
    # plain single-part
    "m3": {"id": "m3", "threadId": "t3", "snippet": "plain",
           "payload": {"mimeType": "text/plain",
                       "headers": header_list(From="Bob <bob@example.com>", To="me@example.com", Subject="Plain mail", Date="Wed, 22 Oct 2026 08:00:00 +0000"),
                       "body": {"data": b64("Just plain text.")}}},
}

EVENTS = {"items": [
    {"id": "e1", "status": "confirmed", "summary": "Team sync", "start": {"dateTime": "2026-10-26T09:00:00Z"}, "end": {"dateTime": "2026-10-26T09:30:00Z"}, "location": "Room 1", "htmlLink": "https://cal/e1"},
    {"id": "e2", "status": "cancelled", "summary": "Cancelled one", "start": {"dateTime": "2026-10-26T11:00:00Z"}, "end": {"dateTime": "2026-10-26T12:00:00Z"}},
    {"id": "e3", "status": "confirmed", "summary": "Holiday", "start": {"date": "2026-10-27"}, "end": {"date": "2026-10-28"}},
    {"id": "e4", "status": "confirmed", "start": {"dateTime": "2026-10-28T10:00:00Z"}, "end": {"dateTime": "2026-10-28T11:00:00Z"}},
]}

class FakeInternet:
    def __init__(self):
        self.calls = []            # (METHOD, host+path)
        self.sent = []             # decoded gmail send payloads
        self.ollama_bodies = []    # JSON bodies sent to /api/chat
        self.revoked = []
        self.refresh_status = 200          # token endpoint behaviour for refresh_token grant
        self.exchange_returns_refresh = True
        self.granted_scope = " ".join(SCOPES)
        self.send_status = 200
        self.gmail_status = 200            # status for gmail GETs
        self.ollama_status = 200
        self.ollama_reply = "Fake AI answer"
        self.ollama_models = ["llama3.2:latest"]
        self.ollama_exc = None             # exception class to raise from transport
        self.send_delay_hook = None

    # ---- transport -------------------------------------------------------
    def handler(self, request: httpx.Request) -> httpx.Response:
        host, path = request.url.host, request.url.path
        self.calls.append((request.method, host + path))
        if host in ("127.0.0.1", "localhost") and path == "/api/tags":
            if self.ollama_exc: raise self.ollama_exc("down", request=request)
            return httpx.Response(200, json={"models": [{"name": n} for n in self.ollama_models]})
        if host in ("127.0.0.1", "localhost") and path == "/api/chat":
            body = json.loads(request.content or b"{}"); self.ollama_bodies.append(body)
            if self.ollama_exc: raise self.ollama_exc("boom", request=request)
            if self.ollama_status != 200: return httpx.Response(self.ollama_status, json={"error": "x"})
            reply = self.ollama_reply(body) if callable(self.ollama_reply) else self.ollama_reply
            return httpx.Response(200, json={"message": {"role": "assistant", "content": reply}})
        if host == "oauth2.googleapis.com" and path == "/token":
            form = {k: v[0] for k, v in parse_qs(request.content.decode()).items()}
            if form.get("grant_type") == "authorization_code":
                if form.get("code") == "bad": return httpx.Response(400, json={"error": "invalid_grant"})
                out = {"access_token": "AT-1", "expires_in": 3600, "scope": self.granted_scope, "token_type": "Bearer"}
                if self.exchange_returns_refresh: out["refresh_token"] = "RT-1"
                return httpx.Response(200, json=out)
            if self.refresh_status != 200: return httpx.Response(self.refresh_status, json={"error": "invalid_grant"})
            return httpx.Response(200, json={"access_token": "AT-2", "expires_in": 3600})
        if host == "oauth2.googleapis.com" and path == "/revoke":
            self.revoked.append(request.url.params.get("token")); return httpx.Response(200)
        if host == "openidconnect.googleapis.com":
            return httpx.Response(200, json={"email": "me@gmail.example", "sub": "1"})
        if host == "gmail.googleapis.com":
            if request.method == "POST" and path.endswith("/messages/send"):
                if self.send_status != 200: return httpx.Response(self.send_status, json={"error": {"message": "nope"}})
                payload = json.loads(request.content)
                raw = payload["raw"]; raw += "=" * (-len(raw) % 4)
                import email, email.policy
                msg = email.message_from_bytes(base64.urlsafe_b64decode(raw), policy=email.policy.default)
                self.sent.append({"to": str(msg["To"]), "subject": str(msg["Subject"]), "body": msg.get_content(), "threadId": payload.get("threadId")})
                return httpx.Response(200, json={"id": "sent-1", "threadId": payload.get("threadId")})
            if self.gmail_status != 200: return httpx.Response(self.gmail_status, json={"error": {"message": "x"}})
            if path.endswith("/users/me/messages"):
                return httpx.Response(200, json={"messages": [{"id": k, "threadId": v["threadId"]} for k, v in MESSAGES.items()]})
            mid = path.rsplit("/", 1)[-1]
            if mid in MESSAGES:
                m = json.loads(json.dumps(MESSAGES[mid]))
                if request.url.params.get("format") == "metadata": m["payload"] = {"headers": m["payload"]["headers"]}
                return httpx.Response(200, json=m)
            return httpx.Response(404, json={"error": {"message": "not found"}})
        if host == "www.googleapis.com" and "/calendar/v3/" in path:
            return httpx.Response(200, json=EVENTS)
        return httpx.Response(599, json={"error": "unexpected host " + host + path})

    def install(self, monkeypatch):
        real = httpx.AsyncClient
        net = self
        class Patched(real):
            def __init__(self, *a, **kw):
                kw["transport"] = httpx.MockTransport(net.handler)
                super().__init__(*a, **kw)
        monkeypatch.setattr(httpx, "AsyncClient", Patched)
        return self
