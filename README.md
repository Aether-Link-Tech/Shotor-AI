# Shotor AI Assistant

Android productivity app **and web app** with a FastAPI backend, local SQLite development database, Ollama AI, private document summaries, Google Gmail assistance, and Calendar reminders.

## Quick start (extract and run)
**Windows:** double-click `start.bat`. **macOS/Linux:** `bash start.sh`. Then open http://localhost:8000. Needs Python 3.11/3.12, and Ollama running with `ollama pull llama3.2`.

## Requirements
- Windows 10/11
- Python 3.11 or 3.12 recommended (the backend dependencies may not yet support every newest Python release)
- Android Studio with JDK 17, Android SDK 35
- Ollama installed locally and a model pulled, for example `ollama pull llama3.2`
- Optional Google Cloud OAuth Web application credentials for Gmail and Calendar

## Start the backend on Windows CMD
```bat
cd backend
py -3.12 -m venv .venv
.venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt
copy .env.example .env
```
Edit `.env` and set a long random `SECRET_KEY`. Keep the local defaults for SQLite and Ollama if appropriate. Start Ollama in another terminal, then:
```bat
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```
Open **`http://localhost:8000`** for the web app (the backend serves the `frontend/` folder) or `http://localhost:8000/docs` for the API docs. Use `localhost` rather than `127.0.0.1` if you connect Google, because the OAuth redirect URI uses `localhost` and browser storage is per-origin. Database tables are created automatically for local development; Alembic scaffolding is included for controlled migrations. For production, create and review migrations before deploying.

## Web app
Served by the backend at `/` — nothing else to start. To work on the UI with a separate static server (e.g. VS Code Live Server on port 5500) it also works: the page then talks to `http://127.0.0.1:8000` (CORS is pre-allowed for ports 5500/8000; add others in `ALLOWED_ORIGINS`) and you should set `FRONTEND_URL=http://localhost:5500` so Google sign-in returns to it. The UI loads Tailwind from its CDN (development convenience; build a static stylesheet for production). The chat sends the recent conversation so the model remembers context.

## Run backend tests
```bat
python -m pytest -q
```
Tests use temporary SQLite databases; Google and Ollama are faked at the HTTP layer (`tests/fakes.py`). Google/Ollama live integration tests require external configuration and are not part of the normal test suite.

## Run Android
Open the `android` folder in Android Studio, let Gradle sync, and run the `app` configuration on an emulator. Use JDK 17 and Android SDK 35. The debug build points to `http://10.0.2.2:8000/`, which routes to your development computer from the Android emulator. For a physical phone, change the debug `API_BASE_URL` in `android/app/build.gradle.kts` to your computer's reachable LAN IP, with both devices on the same network. The release variant disables cleartext HTTP and defaults to `https://api.example.com/`; configure the real HTTPS endpoint with the Gradle property `shotOrApiBaseUrl` before building a release. Never ship a release pointed at the placeholder URL.

The project includes `gradlew.bat` and `gradlew` bootstrap launchers for Gradle 8.9. On first run, they download the Gradle distribution to your user cache, so internet access is required. From Windows CMD, run `gradlew.bat testDebugUnitTest assembleDebug` inside `android`. Android Studio can also open the `android` folder and sync the project. This package was not Android-built in the packaging environment, so run the build locally and resolve any environment-specific errors before release.

## Docker note
`docker compose up --build` from the repository root (expects `backend/.env`). Compose already points Ollama at `host.docker.internal` and stores the SQLite DB in `backend/data/`. The web app is then at `http://localhost:8000`.

## Ollama (offline AI, no API key)
All AI runs locally through Ollama; nothing is sent to a cloud service and no key is needed.
```bat
ollama serve          (usually already running as a background service)
ollama pull llama3.2
```
Defaults: `OLLAMA_BASE_URL=http://127.0.0.1:11434`, `OLLAMA_MODEL=llama3.2` (change in `backend/.env`; the model name must match `ollama list`). The web app shows the AI status in the sidebar and tells you if Ollama is not running or the model is not pulled. The first reply after starting Ollama can be slow while the model loads.

**Free models:** local models are free and unlimited. Ollama's free cloud tier (after `ollama signin`, using a `:cloud` model tag) also works without any key in this project, but it has light usage limits and sends prompts to Ollama's servers, so it is not offline.

## Google OAuth setup
1. Create a Google Cloud project and configure the OAuth consent screen.
2. Enable Gmail API and Google Calendar API.
3. Create an OAuth **Web application** client. Add the exact callback URI configured in `.env`, default `http://localhost:8000/api/v1/google/callback` for local development.
4. Put the client ID, secret, redirect URI, and a generated Fernet key in `.env`. Generate the encryption key with `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`.
5. Add test users while the consent screen is in testing. Gmail/Calendar scopes can require Google verification for public production use.
6. From the app, choose Connect Google, complete consent in the browser, then return to the app and refresh the connection status.

The OAuth callback must be reachable by the browser that completes consent. A callback at `localhost` works only when the browser and backend share that machine; it will not generally work when consent is opened on an Android emulator or phone. For Android device testing and production, configure a publicly reachable HTTPS callback (for example, a secured development tunnel) and register that exact URI in Google Cloud. The backend receives the callback, then the user returns to Shotor and refreshes status. Do not ship client secrets in Android.

## Gmail safety
Gmail content is untrusted input. AI-generated replies are drafts only. The user must review/edit the draft and explicitly confirm sending. The backend requires an owned, unexpired draft and explicit `confirm_send=true`; a draft cannot be sent twice.

## Calendar reminders
The Android app schedules a periodic WorkManager sync and local notifications for events within the next 7 days. Android background work is best-effort and periodic work is not exact-minute scheduling. Exact timing depends on OS battery policies and permissions. If reliable server-side reminders are required, add a configured push service such as Firebase Cloud Messaging.

## Security and limitations
- Passwords use Argon2 hashing; API access tokens are short-lived and backed by revocable server-side sessions.
- Private endpoints require authentication and scope database queries by owner.
- Uploads are limited by size and file type; extracted text is private and stored in the database, originals are stored in a private upload directory.
- Google refresh tokens are Fernet-encrypted at rest.
- Rate limiting in this starter is in-memory and suitable only for one local backend process. Use Redis-backed distributed rate limiting behind a reverse proxy in production.
- The project is a starting implementation, not a security audit or a verified Play Store release. Test with synthetic accounts and Google test accounts before real data.
- OCR for scanned PDFs is not included. Encrypted PDFs and documents without extractable text return an error.
- SQLite is for local development. PostgreSQL support is available through `psycopg`; set `DATABASE_URL=postgresql+psycopg://user:password@host:5432/database` in production. Review and run Alembic migrations (`alembic upgrade head`) before deploying. The initial migration creates tables from the model metadata, so review it and use normal explicit migrations for subsequent schema changes.

## Production checklist
Use HTTPS; strong unique secrets; a private database and upload directory; production-grade distributed rate limiting; structured redacted logs; reviewed migrations; backups and restore tests; OAuth verification as required; published privacy policy and account-deletion resource; release signing; and Android release build testing.
