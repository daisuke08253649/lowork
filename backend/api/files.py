import asyncio
import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Response, status
from pydantic import BaseModel, Field

from backend.config import FILE_BACKUP_PATH
from backend.services.file_ops import (
    FileOperationError,
    InvalidFilenameError,
    TargetFileAlreadyExistsError,
    TargetFileNotFoundError,
    apply_file_operation,
)
from backend.services.project import get_project

router = APIRouter(prefix="/files", tags=["files"])
logger = logging.getLogger(__name__)


class ApplyFileOperationRequest(BaseModel):
    project_id: str = Field(min_length=1)
    action: Literal["create", "edit"]
    filename: str = Field(min_length=1)
    content: str


@router.post("/apply", status_code=status.HTTP_204_NO_CONTENT)
async def post_file_operation(request_data: ApplyFileOperationRequest) -> Response:
    project = await get_project(request_data.project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="プロジェクトが見つかりません")

    try:
        await asyncio.to_thread(
            apply_file_operation,
            request_data.action,
            project.folder_path,
            request_data.filename,
            request_data.content,
            FILE_BACKUP_PATH / project.id,
        )
    except InvalidFilenameError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except TargetFileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except TargetFileAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileOperationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (OSError, ValueError) as exc:
        logger.warning("ファイルの書き込みに失敗しました", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail="ファイルの書き込みに失敗しました",
        ) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)
