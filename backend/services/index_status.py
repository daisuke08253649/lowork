from typing import Literal

IndexState = Literal["indexing", "done", "error"]

index_statuses: dict[str, tuple[IndexState, int]] = {}


def start_indexing(project_id: str) -> None:
    index_statuses[project_id] = ("indexing", 0)


def update_index_progress(project_id: str, progress: int) -> None:
    index_statuses[project_id] = ("indexing", min(max(progress, 0), 100))


def finish_indexing(project_id: str) -> None:
    index_statuses[project_id] = ("done", 100)


def fail_indexing(project_id: str, progress: int) -> None:
    index_statuses[project_id] = ("error", min(max(progress, 0), 100))


def get_index_status(project_id: str) -> tuple[IndexState, int]:
    return index_statuses.get(project_id, ("done", 100))


def remove_index_status(project_id: str) -> None:
    index_statuses.pop(project_id, None)
