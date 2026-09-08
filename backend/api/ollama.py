import json
from collections.abc import AsyncIterator

import httpx
import psutil
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.config import (
    OLLAMA_BASE_URL,
    OLLAMA_EMBEDDING_MODEL,
    OLLAMA_TIMEOUT_SECONDS,
)
from backend.services.model_catalog import (
    CatalogModel,
    CompatibilityStatus,
    compatibility_status,
    default_variant_label,
    parse_catalog_models,
    pull_model_name,
    required_memory_gb,
)

router = APIRouter(prefix="/ollama", tags=["ollama"])
system_router = APIRouter(tags=["system"])
OLLAMA_LIBRARY_URL = "https://ollama.com/library"
OLLAMA_LIBRARY_TIMEOUT_SECONDS = 10
available_models_cache: list[CatalogModel] | None = None


class OllamaStatusResponse(BaseModel):
    available: bool


class OllamaModel(BaseModel):
    capabilities: list[str] = Field(default_factory=list)
    name: str


class OllamaTagsResponse(BaseModel):
    models: list[OllamaModel]


class OllamaModelsResponse(BaseModel):
    models: list[str]


def supports_chat(model: OllamaModel) -> bool:
    return not model.capabilities or "completion" in model.capabilities


class SystemSpecsResponse(BaseModel):
    ram_bytes: int
    ram_gb: float


class ModelCompatibility(BaseModel):
    status: CompatibilityStatus
    required_memory_gb: float | None


class ModelVariantResponse(BaseModel):
    label: str | None
    pull_model: str
    compatibility: ModelCompatibility


class AvailableModelResponse(BaseModel):
    name: str
    variants: list[ModelVariantResponse]


class AvailableModelsResponse(BaseModel):
    embedding_model: str
    models: list[AvailableModelResponse]


class OllamaPullRequest(BaseModel):
    model: str = Field(
        min_length=1, max_length=256, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:/-]*$"
    )


async def fetch_tags() -> OllamaTagsResponse:
    async with httpx.AsyncClient(timeout=OLLAMA_TIMEOUT_SECONDS) as client:
        response = await client.get(f"{OLLAMA_BASE_URL}/api/tags")
        response.raise_for_status()
    return OllamaTagsResponse.model_validate(response.json())


async def fetch_available_models() -> list[CatalogModel]:
    global available_models_cache
    if available_models_cache is not None:
        return available_models_cache

    async with httpx.AsyncClient(timeout=OLLAMA_LIBRARY_TIMEOUT_SECONDS) as client:
        response = await client.get(OLLAMA_LIBRARY_URL)
        response.raise_for_status()
    models = parse_catalog_models(response.text)
    if not models:
        raise ValueError("モデル一覧を解析できません")
    available_models_cache = models
    return models


def get_system_ram_bytes() -> int:
    return psutil.virtual_memory().total


def to_available_model_response(
    model: CatalogModel, ram_gb: float
) -> AvailableModelResponse:
    default_label = default_variant_label(model)
    return AvailableModelResponse(
        name=model.name,
        variants=[
            ModelVariantResponse(
                label=label,
                pull_model=pull_model_name(model, label),
                compatibility=ModelCompatibility(
                    status=compatibility_status(ram_gb, default_label or label),
                    required_memory_gb=required_memory_gb(default_label or label),
                ),
            )
            for label in [None, *model.labels]
        ],
    )


def to_sse_event(payload: dict[str, object]) -> str:
    return f"data: {json.dumps(payload, ensure_ascii=False)}\n\n"


async def stream_pull_response(
    client: httpx.AsyncClient,
    response: httpx.Response,
) -> AsyncIterator[str]:
    try:
        async for line in response.aiter_lines():
            if line:
                yield to_sse_event(json.loads(line))
    except (json.JSONDecodeError, httpx.HTTPError):
        yield to_sse_event({"error": "モデルのダウンロード進捗を処理できません"})
    finally:
        await response.aclose()
        await client.aclose()


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
    return OllamaModelsResponse(
        models=[model.name for model in tags.models if supports_chat(model)]
    )


@system_router.get("/system/specs", response_model=SystemSpecsResponse)
async def get_system_specs() -> SystemSpecsResponse:
    ram_bytes = get_system_ram_bytes()
    return SystemSpecsResponse(
        ram_bytes=ram_bytes, ram_gb=round(ram_bytes / 1024**3, 1)
    )


@router.get("/available-models", response_model=AvailableModelsResponse)
async def get_available_models() -> AvailableModelsResponse:
    try:
        models = await fetch_available_models()
    except (httpx.HTTPError, ValueError) as exc:
        raise HTTPException(
            status_code=502, detail="モデル一覧を取得できません"
        ) from exc

    ram_gb = get_system_ram_bytes() / 1024**3
    return AvailableModelsResponse(
        embedding_model=OLLAMA_EMBEDDING_MODEL,
        models=[to_available_model_response(model, ram_gb) for model in models],
    )


@router.post("/pull")
async def pull_ollama_model(request_data: OllamaPullRequest) -> StreamingResponse:
    if "/" in request_data.model:
        raise HTTPException(
            status_code=400, detail="外部レジストリのモデルはダウンロードできません"
        )

    client = httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=OLLAMA_TIMEOUT_SECONDS,
            read=None,
            write=OLLAMA_TIMEOUT_SECONDS,
            pool=OLLAMA_TIMEOUT_SECONDS,
        )
    )
    request = client.build_request(
        "POST",
        f"{OLLAMA_BASE_URL}/api/pull",
        json={"model": request_data.model, "stream": True},
    )
    try:
        response = await client.send(request, stream=True)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        await exc.response.aclose()
        await client.aclose()
        raise HTTPException(
            status_code=502, detail="モデルのダウンロードを開始できません"
        ) from exc
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=503, detail="Ollamaに接続できません") from exc

    return StreamingResponse(
        stream_pull_response(client, response),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
