from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api.ollama import router as ollama_router

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:1420"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ollama_router)


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
