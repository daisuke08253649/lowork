import asyncio
import json
from collections.abc import AsyncIterator
from datetime import UTC, datetime

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from backend.config import OLLAMA_BASE_URL, OLLAMA_TIMEOUT_SECONDS
from backend.db.models import ChatConversation, ChatMessage
from backend.services.chat_history import (
    delete_conversation,
    generate_conversation_title,
    get_conversation,
    get_conversation_history,
    get_conversation_messages,
    get_normal_conversation,
    list_conversations,
    save_normal_chat,
)

router = APIRouter(tags=["chat"])
title_generation_tasks: set[asyncio.Task[None]] = set()


class NormalChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1)
    model: str = Field(min_length=1)


class OllamaMessage(BaseModel):
    content: str = ""


class OllamaChatChunk(BaseModel):
    message: OllamaMessage
    done: bool


class ChatConversationResponse(BaseModel):
    id: str
    project_id: str | None
    title: str
    created_at: datetime


class ChatMessageResponse(BaseModel):
    id: str
    conversation_id: str
    role: str
    content: str
    created_at: datetime


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
    client: httpx.AsyncClient,
    response: httpx.Response,
    request_data: NormalChatRequest,
) -> AsyncIterator[str]:
    assistant_content = ""
    completed = False
    try:
        async for line in response.aiter_lines():
            if not line:
                continue
            chunk = OllamaChatChunk.model_validate_json(line)
            if not chunk.message.content and not chunk.done:
                continue
            assistant_content += chunk.message.content
            if chunk.message.content:
                yield to_sse_event({"content": chunk.message.content, "done": False})
            if not chunk.done:
                continue
            completed = True
            break
    except (ValueError, httpx.HTTPError):
        yield to_sse_event({"error": "Ollamaからの応答を処理できません", "done": True})
    finally:
        await response.aclose()
        await client.aclose()

    if completed:
        try:
            conversation_id, is_new_conversation = await save_normal_chat(
                request_data.conversation_id,
                request_data.message,
                assistant_content,
            )
        except (SQLAlchemyError, ValueError):
            yield to_sse_event({"error": "会話の保存に失敗しました", "done": True})
            return

        if is_new_conversation:
            schedule_title_generation(
                conversation_id,
                request_data.message,
                assistant_content,
                request_data.model,
            )
        yield to_sse_event(
            {"content": "", "done": True, "conversation_id": conversation_id}
        )


def conversation_to_response(
    conversation: ChatConversation,
) -> ChatConversationResponse:
    return ChatConversationResponse(
        id=conversation.id,
        project_id=conversation.project_id,
        title=conversation.title,
        created_at=as_utc_datetime(conversation.created_at),
    )


def message_to_response(message: ChatMessage) -> ChatMessageResponse:
    return ChatMessageResponse(
        id=message.id,
        conversation_id=message.conversation_id,
        role=message.role,
        content=message.content,
        created_at=as_utc_datetime(message.created_at),
    )


def as_utc_datetime(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def schedule_title_generation(
    conversation_id: str,
    user_content: str,
    assistant_content: str,
    model: str,
) -> None:
    task = asyncio.create_task(
        generate_conversation_title(
            conversation_id,
            user_content,
            assistant_content,
            model,
        )
    )
    title_generation_tasks.add(task)
    task.add_done_callback(title_generation_tasks.discard)


@router.get("/chat/conversations", response_model=list[ChatConversationResponse])
async def get_chat_conversations(
    project_id: str | None = Query(default=None),
) -> list[ChatConversationResponse]:
    conversations = await list_conversations(project_id)
    return [conversation_to_response(conversation) for conversation in conversations]


@router.get(
    "/chat/conversations/{conversation_id}/messages",
    response_model=list[ChatMessageResponse],
)
async def get_chat_messages(conversation_id: str) -> list[ChatMessageResponse]:
    conversation = await get_conversation(conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="会話が見つかりません")
    messages = await get_conversation_messages(conversation_id)
    return [message_to_response(message) for message in messages]


@router.delete(
    "/chat/conversations/{conversation_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def delete_chat_conversation(conversation_id: str) -> None:
    if not await delete_conversation(conversation_id):
        raise HTTPException(status_code=404, detail="会話が見つかりません")


@router.post("/normal-chat")
async def post_normal_chat(request_data: NormalChatRequest) -> StreamingResponse:
    if request_data.conversation_id is None:
        chat_history: list[dict[str, str]] = []
    else:
        conversation = await get_normal_conversation(request_data.conversation_id)
        if conversation is None:
            raise HTTPException(status_code=404, detail="会話が見つかりません")
        chat_history = await get_conversation_history(request_data.conversation_id)

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
            "messages": [
                *chat_history,
                {"role": "user", "content": request_data.message},
            ],
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
        stream_ollama_response(client, response, request_data),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
