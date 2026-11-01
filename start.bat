@echo off
REM Extract the zip, then double-click this file. First run installs everything (needs internet once).
cd /d "%~dp0backend"
if not exist .venv (
  py -3.12 -m venv .venv 2>nul || py -3 -m venv .venv || (echo Python 3.11/3.12 is required. Install it from python.org & pause & exit /b 1)
)
call .venv\Scripts\activate
python -m pip install -q -r requirements.txt || (echo Install failed & pause & exit /b 1)
if not exist .env copy .env.example .env >nul
echo.
echo Make sure Ollama is running and the model is pulled:  ollama pull llama3.2
echo Opening http://localhost:8000
start "" http://localhost:8000
uvicorn app.main:app --host 127.0.0.1 --port 8000
pause
