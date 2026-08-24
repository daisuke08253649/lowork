import asyncio
import json
import logging
from collections.abc import AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from langchain_core.documents import Document
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from backend.api.serialization import as_utc_datetime
from backend.config import OLLAMA_BASE_URL, OLLAMA_TIMEOUT_SECONDS
from backend.db.models import ChatConversation, ChatMessage
from backend.services.chat_history import (
    delete_conversation,
    generate_conversation_title,
    get_conversation,
    get_conversation_history,
    get_conversation_messages,
    get_normal_conversation,
    get_project_conversation,
    list_conversations,
    save_normal_chat,
    save_project_chat,
)
from backend.services.file_ops import (
    FileOperationError,
    InvalidFilenameError,
    TargetFileAlreadyExistsError,
    TargetFileNotFoundError,
    create_file,
    edit_file,
)
from backend.services.indexer import index_project
from backend.services.project import get_project
from backend.services.rag import search

router = APIRouter(tags=["chat"])
title_generation_tasks: set[asyncio.Task[None]] = set()
logger = logging.getLogger(__name__)


class NormalChatRequest(BaseModel):
    conversation_id: str | None = None
    message: str = Field(min_length=1)
    model: str = Field(min_length=1)


class ProjectChatRequest(BaseModel):
    project_id: str = Field(min_length=1)
    conversation_id: str | None = None
    message: str = Field(min_length=1)
    model: str = Field(min_length=1)
    mode: Literal["confirm", "auto"] = "confirm"


class FileOperationResponse(BaseModel):
    action: Literal["create", "edit"]
    filename: str
    content: str


class ProjectChatResponse(BaseModel):
    message: str
    file_op: FileOperationResponse | None
    file_op_error: str | None = None
    mode: Literal["confirm", "auto"]
    conversation_id: str


class OllamaMessage(BaseModel):
    content: str = ""


class OllamaProjectResponse(BaseModel):
    message: OllamaMessage


class ProjectChatOutput(BaseModel):
    message: str
    file_op: FileOperationResponse | None = None


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
        return "Ollamaで応答を生成できませんでした"
    if not isinstance(payload, dict) or not isinstance(payload.get("error"), str):
        return "Ollamaで応答を生成できませんでした"

    error_message = payload["error"].lower()
    if "not found" in error_message:
        return "指定したモデルが見つかりません。設定画面でモデルを確認してください"
    if "does not support chat" in error_message:
        return (
            "選択したモデルはチャットに対応していません。別のモデルを選択してください"
        )
    if "requires more system memory" in error_message:
        return "メモリが不足しています。より小さいモデルを選択してください"
    return "Ollamaで応答を生成できませんでした"


def build_project_system_prompt(context: str) -> str:
    return (
        "あなたはローカルプロジェクトを支援するAIアシスタントです。"
        "回答は必ずJSONオブジェクトのみで返してください。\n"
        '形式: {"message": "ユーザーへの返答", "file_op": null または '
        '{"action": "create"|"edit", "filename": "パス", '
        '"content": "ファイル全文"}}\n'
        "新規作成のfilenameはプロジェクトフォルダ直下の.mdまたは.txtにしてください。"
        "既存ファイルを編集する場合、filenameはプロジェクトフォルダからの相対パスにしてください。"
        "ファイル操作が不要ならfile_opはnullにしてください。\n\n"
        f"関連ファイル:\n{context}"
    )


def build_rag_context(documents: list[Document]) -> str:
    context_parts: list[str] = []
    for document in documents:
        file_path = document.metadata.get("file_path", "不明なファイル")
        context_parts.append(f"--- {file_path} ---\n{document.page_content}")
    return "\n\n".join(context_parts) or "関連ファイルは見つかりませんでした。"


def parse_project_chat_output(content: str) -> ProjectChatOutput:
    try:
        output = json.loads(content)
    except json.JSONDecodeError:
        return ProjectChatOutput(message=content)

    if not isinstance(output, dict):
        return ProjectChatOutput(message="Ollamaから有効な応答を取得できませんでした。")

    message = output.get("message")
    file_operation = parse_file_operation(output.get("file_op"))
    if isinstance(message, str):
        return ProjectChatOutput(message=message, file_op=file_operation)
    if file_operation is not None:
        return ProjectChatOutput(
            message="ファイル操作を提案しました。",
            file_op=file_operation,
        )
    return ProjectChatOutput(message="Ollamaから有効な応答を取得できませんでした。")


def parse_file_operation(value: object) -> FileOperationResponse | None:
    if not isinstance(value, dict):
        return None
    try:
        return FileOperationResponse.model_validate(value)
    except ValueError:
        return None


async def request_project_chat_from_ollama(
    request_data: ProjectChatRequest,
    system_prompt: str,
    chat_history: list[dict[str, str]],
) -> ProjectChatOutput:
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=OLLAMA_TIMEOUT_SECONDS,
                read=None,
                write=OLLAMA_TIMEOUT_SECONDS,
                pool=OLLAMA_TIMEOUT_SECONDS,
            )
        ) as client:
            response = await client.post(
                f"{OLLAMA_BASE_URL}/api/chat",
                json={
                    "model": request_data.model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        *chat_history,
                        {"role": "user", "content": request_data.message},
                    ],
                    "stream": False,
                    "format": "json",
                },
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = await get_ollama_error_message(exc.response)
        raise HTTPException(status_code=502, detail=detail) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail="Ollamaに接続できません") from exc

    try:
        ollama_response = OllamaProjectResponse.model_validate(response.json())
    except (TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=502,
            detail="Ollamaからの応答を処理できません",
        ) from exc
    return parse_project_chat_output(ollama_response.message.content)


async def apply_auto_file_operation(
    project_folder: str,
    file_operation: FileOperationResponse | None,
) -> str | None:
    if file_operation is None:
        return None

    operation = create_file if file_operation.action == "create" else edit_file
    try:
        await asyncio.to_thread(
            operation,
            project_folder,
            file_operation.filename,
            file_operation.content,
        )
    except InvalidFilenameError as exc:
        return str(exc)
    except TargetFileNotFoundError as exc:
        return str(exc)
    except TargetFileAlreadyExistsError as exc:
        return str(exc)
    except FileOperationError as exc:
        return str(exc)
    except (OSError, ValueError):
        logger.warning("自走モードのファイル書き込みに失敗しました", exc_info=True)
        return "ファイルの書き込みに失敗しました"
    return None


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
async def get_chat_messages(
    conversation_id: str,
    project_id: str | None = Query(default=None),
) -> list[ChatMessageResponse]:
    conversation = (
        await get_project_conversation(conversation_id, project_id)
        if project_id
        else await get_conversation(conversation_id)
    )
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


@router.post("/project-chat", response_model=ProjectChatResponse)
async def post_project_chat(
    request_data: ProjectChatRequest,
) -> ProjectChatResponse:
    project = await get_project(request_data.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="プロジェクトが見つかりません")
    if request_data.conversation_id is None:
        chat_history: list[dict[str, str]] = []
    else:
        conversation = await get_project_conversation(
            request_data.conversation_id,
            request_data.project_id,
        )
        if conversation is None:
            raise HTTPException(status_code=404, detail="会話が見つかりません")
        chat_history = await get_conversation_history(request_data.conversation_id)

    try:
        await index_project(
            request_data.project_id,
            Path(project.folder_path),
            raise_on_error=True,
        )
    except ConnectionError as exc:
        raise HTTPException(status_code=503, detail="Ollamaに接続できません") from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="プロジェクトのインデックス更新に失敗しました",
        ) from exc

    try:
        documents = await asyncio.to_thread(
            search,
            request_data.project_id,
            request_data.message,
        )
    except ConnectionError as exc:
        raise HTTPException(status_code=503, detail="Ollamaに接続できません") from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="プロジェクトの検索に失敗しました",
        ) from exc

    output = await request_project_chat_from_ollama(
        request_data,
        build_project_system_prompt(build_rag_context(documents)),
        chat_history,
    )
    file_op_error = None
    if request_data.mode == "auto":
        file_op_error = await apply_auto_file_operation(
            project.folder_path,
            output.file_op,
        )

    try:
        conversation_id, is_new_conversation = await save_project_chat(
            request_data.conversation_id,
            request_data.project_id,
            request_data.message,
            output.message,
        )
    except (SQLAlchemyError, ValueError) as exc:
        raise HTTPException(status_code=500, detail="会話の保存に失敗しました") from exc

    if is_new_conversation:
        schedule_title_generation(
            conversation_id,
            request_data.message,
            output.message,
            request_data.model,
        )
    return ProjectChatResponse(
        message=output.message,
        file_op=output.file_op,
        file_op_error=file_op_error,
        mode=request_data.mode,
        conversation_id=conversation_id,
    )
