import asyncio
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError

from backend.db.database import async_session_factory
from backend.db.models import Project


async def list_projects() -> list[Project]:
    async with async_session_factory() as session:
        statement = select(Project).order_by(Project.created_at.desc())
        return list((await session.scalars(statement)).all())


async def create_project(name: str, folder_path: str) -> Project:
    normalized_name = name.strip()
    if not normalized_name:
        raise ValueError("プロジェクト名を入力してください")

    requested_path = Path(folder_path)
    if not requested_path.is_absolute():
        raise ValueError("フォルダパスは絶対パスで指定してください")

    resolved_path = requested_path.resolve()
    if not await asyncio.to_thread(resolved_path.is_dir):
        raise ValueError("指定されたフォルダが見つかりません")
    if is_too_broad_folder(resolved_path):
        raise ValueError(
            "ルートやホームフォルダなど範囲が広すぎるフォルダは登録できません"
        )
    normalized_path = str(resolved_path)

    project = Project(name=normalized_name, folder_path=normalized_path)
    async with async_session_factory() as session:
        session.add(project)
        try:
            await session.commit()
        except IntegrityError as exc:
            await session.rollback()
            raise FileExistsError(
                "このフォルダはすでにプロジェクトに登録されています"
            ) from exc
        await session.refresh(project)
        return project


def is_too_broad_folder(folder_path: Path) -> bool:
    # ファイル書き込み権限の及ぶ範囲を限定するため、ホームとその上位階層は対象外にする。
    home_path = Path.home().resolve()
    return folder_path == Path(folder_path.anchor) or home_path.is_relative_to(
        folder_path
    )


async def get_project(project_id: str) -> Project | None:
    async with async_session_factory() as session:
        return await session.get(Project, project_id)


async def delete_project(project_id: str) -> bool:
    async with async_session_factory() as session:
        result = await session.execute(delete(Project).where(Project.id == project_id))
        await session.commit()
        return result.rowcount == 1
