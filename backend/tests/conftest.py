import pytest
from cryptography.fernet import Fernet
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
from fastapi.testclient import TestClient
from app.db import Base, get_db
from app.main import app
from tests.fakes import FakeInternet

PASSWORD = "correct horse battery staple"

@pytest.fixture()
def db_session_factory():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def enable_fk(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor(); cursor.execute("PRAGMA foreign_keys=ON"); cursor.close()
    Base.metadata.create_all(engine)
    yield sessionmaker(bind=engine, autoflush=False, autocommit=False, expire_on_commit=False)
    Base.metadata.drop_all(engine); engine.dispose()

@pytest.fixture()
def client(tmp_path, monkeypatch, db_session_factory):
    from app.limiter import _hits, _lock
    with _lock: _hits.clear()
    from app.core.config import settings
    monkeypatch.setattr(settings, "upload_dir", str(tmp_path / "uploads"))
    def override_db():
        db = db_session_factory()
        try: yield db
        finally: db.close()
    app.dependency_overrides[get_db] = override_db
    with TestClient(app) as c:
        c.session_factory = db_session_factory
        yield c
    app.dependency_overrides.clear()

@pytest.fixture()
def net(monkeypatch):
    """Fake Google + Ollama network and a configured Google OAuth app."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "google_client_id", "cid")
    monkeypatch.setattr(settings, "google_client_secret", "secret")
    monkeypatch.setattr(settings, "google_token_encryption_key", Fernet.generate_key().decode())
    return FakeInternet().install(monkeypatch)

def register(client, email="user@example.com", password=PASSWORD, full_name="Test User"):
    r = client.post("/api/v1/auth/register", json={"email": email, "password": password, "full_name": full_name})
    assert r.status_code == 201, r.text
    return {"Authorization": "Bearer " + r.json()["access_token"]}

@pytest.fixture()
def auth(client):
    return register(client)

def connect_google(client, headers, web=False):
    url = "/api/v1/google/connect" + ("?client=web" if web else "")
    r = client.get(url, headers=headers); assert r.status_code == 200, r.text
    from urllib.parse import urlparse, parse_qs
    state = parse_qs(urlparse(r.json()["authorization_url"]).query)["state"][0]
    cb = client.get("/api/v1/google/callback", params={"code": "good", "state": state}, follow_redirects=False)
    return cb
