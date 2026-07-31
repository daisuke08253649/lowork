from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.chat import router as chat_router
from backend.api.ollama import router as ollama_router
from backend.db.database import close_database, initialize_database


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await initialize_database()
    yield
    await close_database()


app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ollama_router)
app.include_router(chat_router)


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
