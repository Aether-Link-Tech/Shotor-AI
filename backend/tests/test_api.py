def test_health(client):
    assert client.get("/health").json()=={"status":"ok"}
    assert client.get("/ready").status_code in (200,503)  # readiness checks the configured development database

def test_register_login_and_me(client):
    r=client.post("/api/v1/auth/register",json={"email":"a@example.com","password":"correct horse battery staple","full_name":"A User"})
    assert r.status_code==201, r.text
    data=r.json(); assert data["user"]["email"]=="a@example.com"
    assert "password_hash" not in data["user"]
    token=data["access_token"]
    assert client.get("/api/v1/auth/me",headers={"Authorization":f"Bearer {token}"}).status_code==200
    assert client.post("/api/v1/auth/logout",headers={"Authorization":f"Bearer {token}"}).status_code==204
    assert client.get("/api/v1/auth/me",headers={"Authorization":f"Bearer {token}"}).status_code==401

def test_duplicate_and_bad_login(client):
    body={"email":"a@example.com","password":"correct horse battery staple"}
    assert client.post("/api/v1/auth/register",json=body).status_code==201
    assert client.post("/api/v1/auth/register",json=body).status_code==409
    assert client.post("/api/v1/auth/login",json={"email":"a@example.com","password":"wrong"}).status_code==401

def test_private_routes_require_auth(client):
    assert client.get("/api/v1/documents").status_code==401
    assert client.get("/api/v1/google/status").status_code==401
    assert client.get("/api/v1/google/gmail/messages").status_code==401

def test_document_upload_and_owner_isolation(client):
    one=client.post("/api/v1/auth/register",json={"email":"one@example.com","password":"correct horse battery staple"}).json()["access_token"]
    two=client.post("/api/v1/auth/register",json={"email":"two@example.com","password":"another correct horse battery staple"}).json()["access_token"]
    h1={"Authorization":f"Bearer {one}"}; h2={"Authorization":f"Bearer {two}"}
    upload=client.post("/api/v1/documents/upload",headers=h1,files={"file":("note.txt",b"This is a private test document.","text/plain")})
    assert upload.status_code==201, upload.text
    did=upload.json()["id"]
    assert client.get("/api/v1/documents",headers=h1).json()[0]["id"]==did
    assert client.get(f"/api/v1/documents/{did}",headers=h2).status_code==404
    assert client.delete(f"/api/v1/documents/{did}",headers=h2).status_code==404

def test_upload_rejects_unsupported_and_empty(client):
    token=client.post("/api/v1/auth/register",json={"email":"up@example.com","password":"correct horse battery staple"}).json()["access_token"]
    h={"Authorization":f"Bearer {token}"}
    assert client.post("/api/v1/documents/upload",headers=h,files={"file":("script.exe",b"abc","application/octet-stream")}).status_code==415
    assert client.post("/api/v1/documents/upload",headers=h,files={"file":("empty.txt",b"","text/plain")}).status_code==400

def test_account_deletion(client):
    token=client.post("/api/v1/auth/register",json={"email":"delete@example.com","password":"correct horse battery staple"}).json()["access_token"]
    h={"Authorization":f"Bearer {token}"}
    assert client.request("DELETE","/api/v1/account/me",headers=h,json={"password":"correct horse battery staple"}).status_code==204
    assert client.get("/api/v1/auth/me",headers=h).status_code==401


def test_summarize_uses_ai_service_and_persists(client, monkeypatch):
    async def fake_generate(messages, system=None):
        return "Summary\n- Key point\n- Action item"
    monkeypatch.setattr("app.api.routes.documents.generate", fake_generate)
    token=client.post("/api/v1/auth/register",json={"email":"summary@example.com","password":"correct horse battery staple"}).json()["access_token"]
    h={"Authorization":f"Bearer {token}"}
    upload=client.post("/api/v1/documents/upload",headers=h,files={"file":("notes.txt",b"Project notes with a next action.","text/plain")})
    did=upload.json()["id"]
    result=client.post(f"/api/v1/documents/{did}/summarize",headers=h)
    assert result.status_code==200, result.text
    assert "Key point" in result.json()["summary"]
    assert client.get(f"/api/v1/documents/{did}",headers=h).json()["summary"]==result.json()["summary"]


def test_account_deletion_requires_password(client):
    token=client.post("/api/v1/auth/register",json={"email":"delete-wrong@example.com","password":"correct horse battery staple"}).json()["access_token"]
    h={"Authorization":f"Bearer {token}"}
    response=client.request("DELETE","/api/v1/account/me",headers=h,json={"password":"not the password"})
    assert response.status_code==403
    assert client.get("/api/v1/auth/me",headers=h).status_code==200


def test_email_send_requires_explicit_confirmation(client):
    token=client.post("/api/v1/auth/register",json={"email":"send@example.com","password":"correct horse battery staple"}).json()["access_token"]
    response=client.post("/api/v1/google/gmail/send",headers={"Authorization":f"Bearer {token}"},json={"draft_id":"missing","recipient":"person@example.com","subject":"Hello","body":"Test","confirm_send":False})
    assert response.status_code==400


def test_security_headers_and_request_id(client):
    response=client.get("/health")
    assert response.headers.get("x-request-id")
    assert response.headers.get("x-content-type-options")=="nosniff"
    assert response.headers.get("cache-control")=="no-store"


def test_email_subject_rejects_header_injection(client):
    token=client.post("/api/v1/auth/register",json={"email":"header@example.com","password":"correct horse battery staple"}).json()["access_token"]
    response=client.post("/api/v1/google/gmail/send",headers={"Authorization":f"Bearer {token}"},json={"draft_id":"draft","recipient":"person@example.com","subject":"Hello\r\nBcc: attacker@example.com","body":"Test","confirm_send":False})
    assert response.status_code==422
