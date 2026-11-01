# Shotor AI Assistant — Package Contents

This archive contains the project's authored source, build configuration, tests, migrations, and setup documentation.

## Top-level
- `README.md`: setup and development guide
- `.env.example`: environment template; contains no real secrets
- `docker-compose.yml`: optional local backend container
- `.dockerignore`, `.gitignore`
- `.github/workflows/backend-ci.yml`: backend CI workflow

## Android (`android/`)
- Gradle Kotlin DSL project configuration and app dependencies
- `gradlew.bat` and `gradlew`: Gradle 8.9 bootstrap launchers for this project. On first use they download Gradle into the user's Gradle cache; an internet connection is required.
- `app/src/main/AndroidManifest.xml`
- Kotlin Compose UI, view model, Retrofit API/data models, secure token storage, and WorkManager reminder workers

## Backend (`backend/`)
- FastAPI application, settings, auth, AI/Ollama service, document processing, Google OAuth/Gmail/Calendar, account deletion
- SQLAlchemy models, Alembic migration configuration and initial migration
- Requirements and tests
- `.env.example` template

## Documentation (`docs/`)
- Manual test plan
- Privacy-policy template
- Account-deletion webpage template

## Before use
1. Copy `backend/.env.example` to `backend/.env` and set a unique development secret.
2. Install the Python dependencies and run backend tests.
3. Install Ollama and pull the configured model, or configure a compatible endpoint.
4. Configure Google OAuth only if Gmail/Calendar integration is needed.
5. Open `android/` in Android Studio or run `gradlew.bat` on Windows. Android SDK 35 and JDK 17 are required.
6. Run the Android build and test the full app with synthetic data before real use.

This archive does not include private credentials, Android SDKs, an installed JDK, Ollama model weights, or third-party Google accounts. These must be installed/configured separately. No production build is claimed unless the relevant build and integration tests have been run in your environment.
