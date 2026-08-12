from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.chat import router as chat_router
from backend.api.files import router as files_router
from backend.api.ollama import router as ollama_router
from backend.api.projects import router as projects_router
from backend.db.database import close_database, initialize_database
from backend.services.indexer import start_project_indexing
from backend.services.project import list_projects


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await initialize_database()
    projects = await list_projects()
    for project in projects:
        start_project_indexing(project.id, project.folder_path)
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
app.include_router(files_router)
app.include_router(projects_router)


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
