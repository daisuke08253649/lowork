import os
import stat
import tempfile
from pathlib import Path

from backend.services.indexer import EXCLUDED_DIRECTORY_NAMES, is_supported_project_file

MAX_FILENAME_COMPONENT_BYTES = 255
MAX_RELATIVE_PATH_BYTES = 1_024


class FileOperationError(Exception):
    pass


class InvalidFilenameError(FileOperationError):
    pass


class TargetFileNotFoundError(FileOperationError):
    pass


class TargetFileAlreadyExistsError(FileOperationError):
    pass


def create_file(project_folder: str, filename: str, content: str) -> None:
    validate_new_filename(filename)
    project_path = get_project_path(project_folder)
    target_path = project_path / filename
    validate_supported_file(target_path)
    normalized_content = normalize_content(content)
    created = False
    try:
        with target_path.open("x", encoding="utf-8") as file:
            created = True
            file.write(normalized_content)
    except FileExistsError as exc:
        raise TargetFileAlreadyExistsError("同名のファイルがすでに存在します") from exc
    except BaseException:
        if created:
            target_path.unlink(missing_ok=True)
        raise


def edit_file(project_folder: str, filename: str, content: str) -> None:
    project_path = get_project_path(project_folder)
    target_path = get_existing_target_path(project_path, filename)
    write_file_atomically(target_path, normalize_content(content))


def get_project_path(project_folder: str) -> Path:
    project_path = Path(project_folder).resolve()
    if not project_path.is_dir():
        raise TargetFileNotFoundError("プロジェクトフォルダが見つかりません")
    return project_path


def get_existing_target_path(project_path: Path, filename: str) -> Path:
    validate_relative_filename(filename)
    relative_path = Path(filename)
    if any(part in EXCLUDED_DIRECTORY_NAMES for part in relative_path.parts):
        raise InvalidFilenameError("編集対象にできないディレクトリが指定されています")

    target_path = project_path / relative_path
    validate_supported_file(target_path)
    if not target_path.is_file() or target_path.is_symlink():
        raise TargetFileNotFoundError("編集対象のファイルが見つかりません")
    if not target_path.resolve().is_relative_to(project_path):
        raise TargetFileNotFoundError("編集対象のファイルが見つかりません")
    return target_path


def validate_new_filename(filename: str) -> None:
    validate_relative_filename(filename)
    if len(Path(filename).parts) != 1:
        raise InvalidFilenameError(
            "新規ファイルはプロジェクトフォルダ直下の名前で指定してください"
        )


def validate_supported_file(file_path: Path) -> None:
    if not is_supported_project_file(file_path):
        raise InvalidFilenameError("Markdownまたはテキストファイルを指定してください")


def normalize_content(content: str) -> str:
    return content.encode("utf-8", errors="replace").decode("utf-8")


def validate_relative_filename(filename: str) -> None:
    path = Path(filename)
    if (
        not filename
        or "\x00" in filename
        or path.is_absolute()
        or not path.parts
        or filename != path.as_posix()
        or any(part in {".", ".."} for part in path.parts)
        or len(filename.encode("utf-8")) > MAX_RELATIVE_PATH_BYTES
        or any(
            len(part.encode("utf-8")) > MAX_FILENAME_COMPONENT_BYTES
            for part in path.parts
        )
    ):
        raise InvalidFilenameError(
            "プロジェクトフォルダ内の安全なパスを指定してください"
        )


def write_file_atomically(target_path: Path, content: str) -> None:
    original_mode = stat.S_IMODE(target_path.stat().st_mode)
    file_descriptor, temporary_path_string = tempfile.mkstemp(dir=target_path.parent)
    temporary_path = Path(temporary_path_string)
    replaced = False
    try:
        with os.fdopen(file_descriptor, "w", encoding="utf-8") as file:
            file.write(content)
        os.chmod(temporary_path, original_mode)
        os.replace(temporary_path, target_path)
        replaced = True
    finally:
        if not replaced:
            temporary_path.unlink(missing_ok=True)
