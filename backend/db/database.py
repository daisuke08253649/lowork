from collections.abc import AsyncIterator
from pathlib import Path

from sqlalchemy import event, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from backend.config import DATABASE_URL, SQLITE_URL_PREFIX

DATABASE_PATH = Path(DATABASE_URL.removeprefix(SQLITE_URL_PREFIX))

engine = create_async_engine(DATABASE_URL)
async_session_factory = async_sessionmaker(engine, expire_on_commit=False)


@event.listens_for(engine.sync_engine, "connect")
def enable_sqlite_foreign_keys(dbapi_connection: object, _: object) -> None:
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


async def initialize_database() -> None:
    from backend.db.models import Base

    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        column_names = await connection.run_sync(get_chat_message_column_names)
        if "sequence" not in column_names:
            await connection.execute(
                text(
                    "ALTER TABLE chat_messages "
                    "ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0"
                )
            )
            await connection.execute(
                text("UPDATE chat_messages SET sequence = rowid WHERE sequence = 0")
            )


async def close_database() -> None:
    await engine.dispose()


async def get_session() -> AsyncIterator[AsyncSession]:
    async with async_session_factory() as session:
        yield session


def get_chat_message_column_names(connection: object) -> set[str]:
    return {
        column["name"] for column in inspect(connection).get_columns("chat_messages")
    }
