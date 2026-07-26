import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from backend.config import OLLAMA_BASE_URL, OLLAMA_TIMEOUT_SECONDS

router = APIRouter(prefix="/ollama", tags=["ollama"])


class OllamaStatusResponse(BaseModel):
    available: bool


class OllamaModel(BaseModel):
    name: str


class OllamaTagsResponse(BaseModel):
    models: list[OllamaModel]


class OllamaModelsResponse(BaseModel):
    models: list[str]


async def fetch_tags() -> OllamaTagsResponse:
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
        response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
        response.raise_for_status()
    return OllamaTagsResponse.model_validate(response.json())


@router.get("/status", response_model=OllamaStatusResponse)
async def get_ollama_status() -> OllamaStatusResponse:
    try:
        await fetch_tags()
    except (httpx.HTTPError, ValueError):
        return OllamaStatusResponse(available=False)
    return OllamaStatusResponse(available=True)


@router.get("/models", response_model=OllamaModelsResponse)
async def get_ollama_models() -> OllamaModelsResponse:
    try:
        tags = await fetch_tags()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(status_code=503, detail="Ollamaに接続できません") from exc
    return OllamaModelsResponse(models=[model.name for model in tags.models])
