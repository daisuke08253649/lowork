import os
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

OLLAMA_TIMEOUT_SECONDS = float(os.environ.get("OLLAMA_TIMEOUT_SECONDS", "5"))
SQLITE_URL_PREFIX = "sqlite+aiosqlite:///"
LOCAL_OLLAMA_HOSTS = {"127.0.0.1", "::1", "localhost"}


def get_ollama_base_url() -> str:
    configured_url = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    parsed_url = urlparse(configured_url)
    if parsed_url.scheme != "http" or parsed_url.hostname not in LOCAL_OLLAMA_HOSTS:
        raise ValueError("OLLAMA_BASE_URLにはローカルのhttp URLを指定してください")
    return configured_url.rstrip("/")


def get_database_url() -> str:
    configured_url = os.environ.get(
        "DATABASE_URL", "sqlite+aiosqlite:///backend/data/chat.db"
    )
    if not configured_url.startswith(SQLITE_URL_PREFIX):
        return configured_url

    database_path = Path(configured_url.removeprefix(SQLITE_URL_PREFIX))
    if not database_path.is_absolute():
        database_path = PROJECT_ROOT / database_path
    return f"{SQLITE_URL_PREFIX}{database_path.resolve()}"


DATABASE_URL = get_database_url()
OLLAMA_BASE_URL = get_ollama_base_url()
