import asyncio
import logging
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field

from backend.api.serialization import as_utc_datetime
from backend.config import FILE_BACKUP_PATH
from backend.db.models import Project
from backend.services.file_ops import (
    FileConflictError,
    FileOperationError,
    FileTooLargeError,
    TargetFileNotFoundError,
    read_file,
    save_file,
)
from backend.services.file_tree import FileTreeNode, build_file_tree
from backend.services.index_status import (
    get_index_status,
    remove_index_status,
)
from backend.services.indexer import cancel_project_indexing, start_project_indexing
from backend.services.project import (
    create_project,
    delete_project,
    get_project,
    list_projects,
)
from backend.services.rag import delete_project_collection

router = APIRouter(prefix="/projects", tags=["projects"])
logger = logging.getLogger(__name__)


class CreateProjectRequest(BaseModel):
    name: str = Field(min_length=1)
    folder_path: str = Field(min_length=1)


class ProjectResponse(BaseModel):
    id: str
    name: str
    folder_path: str
    created_at: datetime


class IndexStatusResponse(BaseModel):
    status: Literal["indexing", "done", "error"]
    progress: int = Field(ge=0, le=100)


class FileTreeNodeResponse(BaseModel):
    name: str
    path: str
    type: Literal["directory", "file"]
    children: list["FileTreeNodeResponse"] = Field(default_factory=list)


class FileContentResponse(BaseModel):
    path: str
    content: str
    content_hash: str


class SaveFileContentRequest(BaseModel):
    path: str = Field(min_length=1)
    content: str
    expected_hash: str = Field(min_length=64, max_length=64)


class SaveFileContentResponse(BaseModel):
    content_hash: str


def file_operation_error_to_http(exc: FileOperationError) -> HTTPException:
    if isinstance(exc, TargetFileNotFoundError):
        return HTTPException(status_code=404, detail=str(exc))
    if isinstance(exc, FileConflictError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, FileTooLargeError):
        return HTTPException(status_code=413, detail=str(exc))
    # InvalidFilenameError・UnreadableFileErrorなど、入力に起因するものは400とする。
    return HTTPException(status_code=400, detail=str(exc))


async def get_existing_project(project_id: str) -> Project:
    project = await get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="プロジェクトが見つかりません")
    return project


def file_tree_node_to_response(node: FileTreeNode) -> FileTreeNodeResponse:
    return FileTreeNodeResponse(
        name=node.name,
        path=node.path,
        type=node.type,
        children=[file_tree_node_to_response(child) for child in node.children],
    )


def project_to_response(project: Project) -> ProjectResponse:
    return ProjectResponse(
        id=project.id,
        name=project.name,
        folder_path=project.folder_path,
        created_at=as_utc_datetime(project.created_at),
    )


@router.get("", response_model=list[ProjectResponse])
async def get_projects() -> list[ProjectResponse]:
    projects = await list_projects()
    return [project_to_response(project) for project in projects]


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def post_project(request_data: CreateProjectRequest) -> ProjectResponse:
    try:
        project = await create_project(request_data.name, request_data.folder_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    start_project_indexing(project.id, project.folder_path)
    return project_to_response(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_by_id(project_id: str) -> None:
    if await get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="プロジェクトが見つかりません")

    cancel_project_indexing(project_id)
    try:
        await asyncio.to_thread(delete_project_collection, project_id)
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail="プロジェクトのインデックス削除に失敗しました",
        ) from exc

    if not await delete_project(project_id):
        raise HTTPException(status_code=404, detail="プロジェクトが見つかりません")
    remove_index_status(project_id)


@router.get("/{project_id}/index-status", response_model=IndexStatusResponse)
async def get_project_index_status(project_id: str) -> IndexStatusResponse:
    if await get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="プロジェクトが見つかりません")
    status_value, progress = get_index_status(project_id)
    return IndexStatusResponse(status=status_value, progress=progress)


@router.get("/{project_id}/files", response_model=FileTreeNodeResponse)
async def get_project_files(project_id: str) -> FileTreeNodeResponse:
    project = await get_project(project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="プロジェクトが見つかりません")

    try:
        tree = await asyncio.to_thread(build_file_tree, Path(project.folder_path))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail="プロジェクトフォルダのファイル一覧を取得できません",
        ) from exc
    return file_tree_node_to_response(tree)


@router.get("/{project_id}/files/content", response_model=FileContentResponse)
async def get_project_file_content(
    project_id: str,
    path: str = Query(min_length=1),
) -> FileContentResponse:
    project = await get_existing_project(project_id)
    try:
        content, content_hash = await asyncio.to_thread(
            read_file, project.folder_path, path
        )
    except FileOperationError as exc:
        raise file_operation_error_to_http(exc) from exc
    except OSError as exc:
        logger.warning("ファイルの読み込みに失敗しました", exc_info=True)
        raise HTTPException(
            status_code=500, detail="ファイルの読み込みに失敗しました"
        ) from exc
    return FileContentResponse(path=path, content=content, content_hash=content_hash)


@router.put("/{project_id}/files/content", response_model=SaveFileContentResponse)
async def put_project_file_content(
    project_id: str,
    request_data: SaveFileContentRequest,
) -> SaveFileContentResponse:
    project = await get_existing_project(project_id)
    try:
        content_hash = await asyncio.to_thread(
            save_file,
            project.folder_path,
            request_data.path,
            request_data.content,
            FILE_BACKUP_PATH / project.id,
            request_data.expected_hash,
        )
    except FileOperationError as exc:
        raise file_operation_error_to_http(exc) from exc
    except OSError as exc:
        logger.warning("ファイルの保存に失敗しました", exc_info=True)
        raise HTTPException(
            status_code=500, detail="ファイルの保存に失敗しました"
        ) from exc
    return SaveFileContentResponse(content_hash=content_hash)
