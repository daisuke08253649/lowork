from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse

from backend.api.chat import router as chat_router
from backend.api.files import router as files_router
from backend.api.ollama import router as ollama_router
from backend.api.ollama import system_router
from backend.api.projects import router as projects_router
from backend.config import ALLOWED_API_HOSTS, ALLOWED_ORIGINS
from backend.db.database import close_database, initialize_database
from backend.services.indexer import start_project_indexing
from backend.services.parent_watch import start_parent_watch
from backend.services.project import list_projects


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    await initialize_database()
    projects = await list_projects()
    for project in projects:
        start_project_indexing(project.id, project.folder_path)
    parent_watch_task = start_parent_watch()
    yield
    if parent_watch_task is not None:
        parent_watch_task.cancel()
    await close_database()


SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

app = FastAPI(lifespan=lifespan)


@app.middleware("http")
async def reject_untrusted_origin(
    request: Request,
    call_next: Callable[[Request], Awaitable[Response]],
) -> Response:
    # ブラウザ経由の状態変更リクエストは、許可したオリジンからのものだけを受け付ける。
    origin = request.headers.get("origin")
    if (
        request.method not in SAFE_METHODS
        and origin is not None
        and origin not in ALLOWED_ORIGINS
    ):
        return JSONResponse(
            status_code=403, content={"detail": "許可されていないオリジンです"}
        )
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)
# DNSリバインディング対策として、ループバック以外のHostヘッダーを拒否する。
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_API_HOSTS)

app.include_router(ollama_router)
app.include_router(system_router)
app.include_router(chat_router)
app.include_router(files_router)
app.include_router(projects_router)


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
