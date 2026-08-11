import asyncio
from datetime import datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.api.serialization import as_utc_datetime
from backend.db.models import Project
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
