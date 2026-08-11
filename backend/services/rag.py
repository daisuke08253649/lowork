from __future__ import annotations

from collections.abc import Sequence
from hashlib import sha256
from pathlib import Path
from threading import Lock

import chromadb
from chromadb.api import ClientAPI
from chromadb.api.models.Collection import Collection
from chromadb.errors import NotFoundError
from langchain_core.documents import Document
from langchain_ollama import OllamaEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter

from backend.config import (
    CHROMA_DB_PATH,
    OLLAMA_BASE_URL,
    OLLAMA_EMBEDDING_MODEL,
)

CHUNK_SIZE = 500
CHUNK_OVERLAP = 50
TOP_K = 5

chroma_client: ClientAPI | None = None
chroma_client_lock = Lock()
embeddings = OllamaEmbeddings(
    model=OLLAMA_EMBEDDING_MODEL,
    base_url=OLLAMA_BASE_URL,
)
text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE,
    chunk_overlap=CHUNK_OVERLAP,
)
project_locks: dict[str, Lock] = {}
project_locks_lock = Lock()


def get_chroma_client() -> ClientAPI:
    global chroma_client

    with chroma_client_lock:
        if chroma_client is None:
            chroma_client = chromadb.PersistentClient(path=str(CHROMA_DB_PATH))
        return chroma_client


def get_project_lock(project_id: str) -> Lock:
    with project_locks_lock:
        return project_locks.setdefault(project_id, Lock())


def get_collection_name(project_id: str) -> str:
    return f"project_{project_id}"


def get_collection(project_id: str) -> Collection:
    return get_chroma_client().get_or_create_collection(
        name=get_collection_name(project_id)
    )


def get_indexed_file_modified_times(project_id: str) -> dict[str, int]:
    with get_project_lock(project_id):
        collection = get_collection(project_id)
        result = collection.get(include=["metadatas"])
        indexed_files: dict[str, int] = {}

        for metadata in result["metadatas"]:
            if metadata is None:
                continue
            file_path = metadata.get("file_path")
            last_modified = metadata.get("last_modified")
            if isinstance(file_path, str) and isinstance(last_modified, int):
                indexed_files[file_path] = last_modified

        return indexed_files


def create_chunk_id(project_id: str, relative_path: str, chunk_index: int) -> str:
    source = f"{project_id}:{relative_path}:{chunk_index}"
    return sha256(source.encode()).hexdigest()


def index_file(project_id: str, project_folder: Path, file_path: Path) -> None:
    with get_project_lock(project_id):
        relative_path = file_path.relative_to(project_folder).as_posix()
        last_modified = file_path.stat().st_mtime_ns
        content = file_path.read_text(encoding="utf-8", errors="replace")
        document = Document(page_content=content, metadata={"file_path": relative_path})
        chunks = text_splitter.split_documents([document])
        collection = get_collection(project_id)

        if not chunks:
            collection.delete(where={"file_path": relative_path})
            return

        chunk_embeddings = embeddings.embed_documents(
            [chunk.page_content for chunk in chunks]
        )
        collection.delete(where={"file_path": relative_path})
        collection.upsert(
            ids=[
                create_chunk_id(project_id, relative_path, index)
                for index in range(len(chunks))
            ],
            documents=[chunk.page_content for chunk in chunks],
            embeddings=chunk_embeddings,
            metadatas=[
                {
                    "file_path": relative_path,
                    "filename": file_path.name,
                    "last_modified": last_modified,
                }
                for chunk in chunks
            ],
        )


def delete_indexed_files(project_id: str, relative_paths: Sequence[str]) -> None:
    if not relative_paths:
        return
    with get_project_lock(project_id):
        get_collection(project_id).delete(
            where={"file_path": {"$in": list(relative_paths)}}
        )


def delete_project_collection(project_id: str) -> None:
    with get_project_lock(project_id):
        try:
            get_chroma_client().delete_collection(get_collection_name(project_id))
        except NotFoundError:
            return


def search(project_id: str, query: str, top_k: int = TOP_K) -> list[Document]:
    with get_project_lock(project_id):
        collection = get_collection(project_id)
        result = collection.query(
            query_embeddings=[embeddings.embed_query(query)],
            n_results=top_k,
        )
        documents = result["documents"][0] if result["documents"] else []
        metadatas = result["metadatas"][0] if result["metadatas"] else []
        return [
            Document(page_content=document, metadata=metadata or {})
            for document, metadata in zip(documents, metadatas, strict=True)
        ]
