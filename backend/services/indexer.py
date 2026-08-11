from __future__ import annotations

import asyncio
import logging
import os
from dataclasses import dataclass
from pathlib import Path
from stat import S_ISREG

from backend.services.index_status import (
    fail_indexing,
    finish_indexing,
    start_indexing,
    update_index_progress,
)
from backend.services.rag import (
    delete_indexed_files,
    get_indexed_file_modified_times,
    index_file,
)

SUPPORTED_FILE_SUFFIXES = {".md", ".txt"}
EXCLUDED_DIRECTORY_NAMES = {".git", ".venv", "dist", "node_modules", "target"}
indexing_tasks: dict[str, asyncio.Task[None]] = {}
logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProjectFileScan:
    files: list[Path]
    has_errors: bool


def is_supported_project_file(file_path: Path) -> bool:
    return (
        file_path.suffix.lower() in SUPPORTED_FILE_SUFFIXES
        and not file_path.is_symlink()
    )


def find_project_files(project_folder: Path) -> ProjectFileScan:
    if not project_folder.is_dir():
        raise FileNotFoundError(
            f"プロジェクトフォルダが見つかりません: {project_folder}"
        )

    project_files: list[Path] = []
    walk_errors: list[OSError] = []

    def handle_walk_error(error: OSError) -> None:
        walk_errors.append(error)
        logger.warning("ディレクトリを読み取れないためスキップします: %s", error)

    for directory_path, directory_names, file_names in os.walk(
        project_folder,
        onerror=handle_walk_error,
    ):
        directory_names[:] = [
            name for name in directory_names if name not in EXCLUDED_DIRECTORY_NAMES
        ]
        for filename in file_names:
            file_path = Path(directory_path, filename)
            if not is_supported_project_file(file_path):
                continue
            try:
                if S_ISREG(file_path.stat().st_mode):
                    project_files.append(file_path)
            except OSError as error:
                walk_errors.append(error)
                logger.warning("ファイルを読み取れないためスキップします: %s", error)

    return ProjectFileScan(
        files=sorted(project_files, key=lambda path: path.as_posix()),
        has_errors=bool(walk_errors),
    )


async def index_project(project_id: str, project_folder: Path) -> None:
    processed_files = 0
    total_files = 0
    has_errors = False
    try:
        scan_result = await asyncio.to_thread(find_project_files, project_folder)
        project_files = scan_result.files
        has_errors = scan_result.has_errors
        indexed_files = await asyncio.to_thread(
            get_indexed_file_modified_times,
            project_id,
        )
        current_paths = {
            file_path.relative_to(project_folder).as_posix()
            for file_path in project_files
        }
        removed_paths = set(indexed_files) - current_paths
        if not has_errors:
            await asyncio.to_thread(
                delete_indexed_files,
                project_id,
                list(removed_paths),
            )

        total_files = len(project_files)
        if total_files == 0:
            if has_errors:
                fail_indexing(project_id, 0)
            else:
                finish_indexing(project_id)
            return

        for file_path in project_files:
            relative_path = file_path.relative_to(project_folder).as_posix()
            try:
                last_modified = file_path.stat().st_mtime_ns
                if indexed_files.get(relative_path) != last_modified:
                    await asyncio.to_thread(
                        index_file,
                        project_id,
                        project_folder,
                        file_path,
                    )
            except OSError as error:
                has_errors = True
                logger.warning("ファイルを読み取れないためスキップします: %s", error)
            processed_files += 1
            update_index_progress(project_id, processed_files * 100 // total_files)

        if has_errors:
            fail_indexing(project_id, 100)
        else:
            finish_indexing(project_id)
    except asyncio.CancelledError:
        raise
    except Exception:
        logger.warning("プロジェクトのインデックス構築に失敗しました", exc_info=True)
        progress = processed_files * 100 // total_files if total_files else 0
        fail_indexing(project_id, progress)


def start_project_indexing(project_id: str, project_folder: str) -> None:
    cancel_project_indexing(project_id)
    start_indexing(project_id)
    task = asyncio.create_task(index_project(project_id, Path(project_folder)))
    indexing_tasks[project_id] = task
    task.add_done_callback(
        lambda completed_task: discard_task(project_id, completed_task)
    )


def cancel_project_indexing(project_id: str) -> None:
    task = indexing_tasks.pop(project_id, None)
    if task is not None:
        task.cancel()


def discard_task(project_id: str, completed_task: asyncio.Task[None]) -> None:
    if indexing_tasks.get(project_id) is completed_task:
        indexing_tasks.pop(project_id, None)
