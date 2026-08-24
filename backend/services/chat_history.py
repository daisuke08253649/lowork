import asyncio
import logging
import re

import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.config import OLLAMA_BASE_URL, OLLAMA_TIMEOUT_SECONDS
from backend.db.database import async_session_factory
from backend.db.models import ChatConversation, ChatMessage

logger = logging.getLogger(__name__)
conversation_locks: dict[str, asyncio.Lock] = {}
INVALID_TITLE_PREFIXES = ("AI:", "ユーザー:", "以下の", "次の会話")


async def get_normal_conversation(conversation_id: str) -> ChatConversation | None:
    async with async_session_factory() as session:
        statement = select(ChatConversation).where(
            ChatConversation.id == conversation_id,
            ChatConversation.project_id.is_(None),
        )
        return await session.scalar(statement)


async def get_project_conversation(
    conversation_id: str,
    project_id: str,
) -> ChatConversation | None:
    async with async_session_factory() as session:
        statement = select(ChatConversation).where(
            ChatConversation.id == conversation_id,
            ChatConversation.project_id == project_id,
        )
        return await session.scalar(statement)


async def get_conversation(conversation_id: str) -> ChatConversation | None:
    async with async_session_factory() as session:
        return await session.get(ChatConversation, conversation_id)


async def get_conversation_messages(conversation_id: str) -> list[ChatMessage]:
    async with async_session_factory() as session:
        statement = (
            select(ChatMessage)
            .where(ChatMessage.conversation_id == conversation_id)
            .order_by(ChatMessage.sequence)
        )
        return list((await session.scalars(statement)).all())


async def get_conversation_history(conversation_id: str) -> list[dict[str, str]]:
    messages = await get_conversation_messages(conversation_id)
    return [{"role": message.role, "content": message.content} for message in messages]


async def save_normal_chat(
    conversation_id: str | None, user_content: str, assistant_content: str
) -> tuple[str, bool]:
    is_new_conversation = conversation_id is None
    async with async_session_factory() as session:
        if conversation_id is None:
            conversation = ChatConversation()
            session.add(conversation)
            await session.flush()
        else:
            statement = select(ChatConversation).where(
                ChatConversation.id == conversation_id,
                ChatConversation.project_id.is_(None),
            )
            conversation = await session.scalar(statement)
            if conversation is None:
                raise ValueError("会話が見つかりません")

        await save_messages_and_commit(
            session,
            conversation.id,
            user_content,
            assistant_content,
        )
        return conversation.id, is_new_conversation


async def save_project_chat(
    conversation_id: str | None,
    project_id: str,
    user_content: str,
    assistant_content: str,
) -> tuple[str, bool]:
    is_new_conversation = conversation_id is None
    async with async_session_factory() as session:
        if conversation_id is None:
            conversation = ChatConversation(project_id=project_id)
            session.add(conversation)
            await session.flush()
        else:
            statement = select(ChatConversation).where(
                ChatConversation.id == conversation_id,
                ChatConversation.project_id == project_id,
            )
            conversation = await session.scalar(statement)
            if conversation is None:
                raise ValueError("会話が見つかりません")

        await save_messages_and_commit(
            session,
            conversation.id,
            user_content,
            assistant_content,
        )
        return conversation.id, is_new_conversation


def get_conversation_lock(conversation_id: str) -> asyncio.Lock:
    return conversation_locks.setdefault(conversation_id, asyncio.Lock())


async def save_messages_and_commit(
    session: AsyncSession,
    conversation_id: str,
    user_content: str,
    assistant_content: str,
) -> None:
    async with get_conversation_lock(conversation_id):
        await save_chat_messages(
            session,
            conversation_id,
            user_content,
            assistant_content,
        )
        await session.commit()


async def save_chat_messages(
    session: AsyncSession,
    conversation_id: str,
    user_content: str,
    assistant_content: str,
) -> None:
    next_sequence = await session.scalar(
        select(func.coalesce(func.max(ChatMessage.sequence), 0)).where(
            ChatMessage.conversation_id == conversation_id
        )
    )
    first_sequence = int(next_sequence) + 1
    session.add_all(
        [
            ChatMessage(
                conversation_id=conversation_id,
                role="user",
                content=user_content,
                sequence=first_sequence,
            ),
            ChatMessage(
                conversation_id=conversation_id,
                role="assistant",
                content=assistant_content,
                sequence=first_sequence + 1,
            ),
        ]
    )


async def list_conversations(project_id: str | None) -> list[ChatConversation]:
    async with async_session_factory() as session:
        statement = select(ChatConversation).order_by(
            ChatConversation.created_at.desc()
        )
        if project_id is None:
            statement = statement.where(ChatConversation.project_id.is_(None))
        else:
            statement = statement.where(ChatConversation.project_id == project_id)
        return list((await session.scalars(statement)).all())


async def delete_conversation(conversation_id: str) -> bool:
    async with async_session_factory() as session:
        await session.execute(
            delete(ChatMessage).where(ChatMessage.conversation_id == conversation_id)
        )
        result = await session.execute(
            delete(ChatConversation).where(ChatConversation.id == conversation_id)
        )
        await session.commit()
        return result.rowcount == 1


async def generate_conversation_title(
    conversation_id: str, user_content: str, assistant_content: str, model: str
) -> None:
    prompt = (
        "次の会話を表す簡潔な日本語タイトルを、20文字以内で1行だけ返してください。"
        "説明やかぎ括弧は不要です。\n\n"
        f"ユーザー: {user_content}\nAI: {assistant_content}"
    )
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
                    "model": model,
                    "messages": [{"role": "user", "content": prompt}],
                    "stream": False,
                },
            )
            response.raise_for_status()
        title = response.json()["message"]["content"].strip().splitlines()[0][:20]
        if not is_valid_conversation_title(title):
            return
    except (httpx.HTTPError, KeyError, TypeError, ValueError, IndexError):
        logger.warning("会話タイトルを生成できませんでした", exc_info=True)
        return

    async with async_session_factory() as session:
        conversation = await session.get(ChatConversation, conversation_id)
        if conversation is None:
            return
        conversation.title = title
        await session.commit()


def is_valid_conversation_title(title: str) -> bool:
    normalized_title = title.strip()
    return bool(
        normalized_title
        and not normalized_title.startswith(INVALID_TITLE_PREFIXES)
        and re.match(r"^\d+[.)]", normalized_title) is None
    )
