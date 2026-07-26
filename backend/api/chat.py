import json
from collections.abc import AsyncIterator

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from backend.config import OLLAMA_BASE_URL, OLLAMA_TIMEOUT_SECONDS

router = APIRouter(tags=["chat"])


class NormalChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1)
    model: str = Field(min_length=1)


class OllamaMessage(BaseModel):
    content: str = ""


class OllamaChatChunk(BaseModel):
    message: OllamaMessage
    done: bool


def to_sse_event(data: object) -> str:
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def get_ollama_error_message(response: httpx.Response) -> str:
    body = await response.aread()
    try:
        payload = json.loads(body)
    except ValueError:
        return "Ollamaでエラーが発生しました"
    if isinstance(payload, dict) and isinstance(payload.get("error"), str):
        return payload["error"]
    return "Ollamaでエラーが発生しました"


async def stream_ollama_response(
    client: httpx.AsyncClient, response: httpx.Response
) -> AsyncIterator[str]:
    try:
        async for line in response.aiter_lines():
            if not line:
                continue
            chunk = OllamaChatChunk.model_validate_json(line)
            if not chunk.message.content and not chunk.done:
                continue
            yield to_sse_event({"content": chunk.message.content, "done": chunk.done})
    except (ValueError, httpx.HTTPError):
        yield to_sse_event({"error": "Ollamaからの応答を処理できません", "done": True})
    finally:
        await response.aclose()
        await client.aclose()


@router.post("/normal-chat")
async def post_normal_chat(request_data: NormalChatRequest) -> StreamingResponse:
    client = httpx.AsyncClient(
        timeout=httpx.Timeout(
            connect=OLLAMA_TIMEOUT_SECONDS,
            read=None,
            write=OLLAMA_TIMEOUT_SECONDS,
            pool=OLLAMA_TIMEOUT_SECONDS,
        )
    )
    ollama_request = client.build_request(
        "POST",
        f"{OLLAMA_BASE_URL}/api/chat",
        json={
            "model": request_data.model,
            "messages": [{"role": "user", "content": request_data.message}],
            "stream": True,
        },
    )

    try:
        response = await client.send(ollama_request, stream=True)
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = await get_ollama_error_message(exc.response)
        await exc.response.aclose()
        await client.aclose()
        raise HTTPException(status_code=502, detail=detail) from exc
    except httpx.HTTPError as exc:
        await client.aclose()
        raise HTTPException(status_code=503, detail="Ollamaに接続できません") from exc

    return StreamingResponse(
        stream_ollama_response(client, response),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
