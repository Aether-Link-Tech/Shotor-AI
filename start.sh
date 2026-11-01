#!/usr/bin/env bash
# Extract the zip, then run:  bash start.sh   (first run needs internet to install dependencies)
set -e
cd "$(dirname "$0")/backend"
[ -d .venv ] || python3 -m venv .venv
. .venv/bin/activate
pip install -q -r requirements.txt
[ -f .env ] || cp .env.example .env
echo "Make sure Ollama is running and the model is pulled: ollama pull llama3.2"
echo "Open http://localhost:8000"
uvicorn app.main:app --host 127.0.0.1 --port 8000
