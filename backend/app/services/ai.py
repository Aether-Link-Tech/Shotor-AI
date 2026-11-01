import httpx
from fastapi import HTTPException
from app.core.config import settings

# AI runs fully offline through a local Ollama server (no API key, no cloud).

def _url(path: str) -> str:
    return settings.ollama_base_url.rstrip("/") + path

def _timeout() -> httpx.Timeout:
    return httpx.Timeout(settings.ollama_read_timeout_seconds, connect=settings.ollama_connect_timeout_seconds)

async def generate(messages: list[dict[str, str]], system: str | None = None) -> str:
    system_prompt = system or "You are Shotor, a helpful and privacy-conscious productivity assistant."
    body = {"model": settings.ollama_model, "messages": [{"role":"system","content":system_prompt}, *messages], "stream": False, "options": {"num_predict": settings.ollama_max_output_tokens}}
    try:
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            response = await client.post(_url("/api/chat"), json=body)
            if response.status_code == 404: raise HTTPException(502, f"Ollama model '{settings.ollama_model}' is not installed. Run: ollama pull {settings.ollama_model}")
            response.raise_for_status()
            content = response.json().get("message", {}).get("content", "").strip()
            if not content: raise HTTPException(502, "Ollama returned an empty response")
            return content
    except HTTPException: raise
    except httpx.TimeoutException: raise HTTPException(504, "Ollama timed out. The model may still be loading; please try again.")
    except httpx.HTTPStatusError: raise HTTPException(502, "Ollama returned an error")
    except httpx.ConnectError: raise HTTPException(503, "Cannot reach Ollama. Start it with `ollama serve` and check OLLAMA_BASE_URL.")
    except (httpx.HTTPError, ValueError): raise HTTPException(503, "Ollama is unavailable. Check that it is running and try again.")

async def status() -> dict:
    """Never raises: reports whether local Ollama is reachable and whether the configured model is installed."""
    out = {"available": False, "model": settings.ollama_model, "model_installed": False, "installed_models": [], "detail": ""}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(5, connect=settings.ollama_connect_timeout_seconds)) as client:
            r = await client.get(_url("/api/tags")); r.raise_for_status()
        names = [m.get("name", "") for m in r.json().get("models", [])]
    except Exception:
        out["detail"] = "Ollama is not reachable. Start it with `ollama serve`."
        return out
    wanted = settings.ollama_model
    out.update(available=True, installed_models=names)
    out["model_installed"] = any(n == wanted or n == f"{wanted}:latest" or (":" not in wanted and n.split(":")[0] == wanted) for n in names)
    if not out["model_installed"]: out["detail"] = f"Model '{wanted}' is not installed. Run: ollama pull {wanted}"
    return out
