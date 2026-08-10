from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from backend.api.serialization import as_utc_datetime
from backend.db.models import Project
from backend.services.index_status import (
    get_index_status,
    remove_index_status,
)
from backend.services.project import (
    create_project,
    delete_project,
    get_project,
    list_projects,
)

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

    return project_to_response(project)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project_by_id(project_id: str) -> None:
    if not await delete_project(project_id):
        raise HTTPException(status_code=404, detail="プロジェクトが見つかりません")
    remove_index_status(project_id)


@router.get("/{project_id}/index-status", response_model=IndexStatusResponse)
async def get_project_index_status(project_id: str) -> IndexStatusResponse:
    if await get_project(project_id) is None:
        raise HTTPException(status_code=404, detail="プロジェクトが見つかりません")
    status_value, progress = get_index_status(project_id)
    return IndexStatusResponse(status=status_value, progress=progress)
