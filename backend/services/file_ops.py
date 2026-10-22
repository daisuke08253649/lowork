import hashlib
import os
import stat
import tempfile
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from backend.services.indexer import EXCLUDED_DIRECTORY_NAMES, is_supported_project_file

MAX_FILENAME_COMPONENT_BYTES = 255
MAX_RELATIVE_PATH_BYTES = 1_024
MAX_EDITABLE_FILE_BYTES = 1_000_000
file_locks: dict[Path, threading.Lock] = {}
file_locks_guard = threading.Lock()


class FileOperationError(Exception):
    pass


class InvalidFilenameError(FileOperationError):
    pass


class TargetFileNotFoundError(FileOperationError):
    pass


class TargetFileAlreadyExistsError(FileOperationError):
    pass


class FileConflictError(FileOperationError):
    pass


class FileTooLargeError(FileOperationError):
    pass


class UnreadableFileError(FileOperationError):
    pass


def apply_file_operation(
    action: Literal["create", "edit"],
    project_folder: str,
    filename: str,
    content: str,
    backup_folder: Path,
) -> str | None:
    """ファイル操作を適用し、編集時は変更前の内容を返す。"""
    if action == "create":
        create_file(project_folder, filename, content)
        return None
    return edit_file(project_folder, filename, content, backup_folder)


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


def edit_file(
    project_folder: str,
    filename: str,
    content: str,
    backup_folder: Path,
    expected_hash: str | None = None,
) -> str:
    """既存ファイルを書き換え、変更前の内容を返す。

    expected_hashを渡した場合は、読み込み後に別の操作（自走モードなど）で
    内容が変わっていれば書き込まずにFileConflictErrorを送出する。
    """
    project_path = get_project_path(project_folder)
    target_path = get_existing_target_path(project_path, filename)
    # 同じファイルへの並行した書き込み（手動保存とAIの編集など）で、
    # 両方がハッシュ検査を通過して一方の変更が失われないよう、読み込みから置換までを排他にする。
    with get_file_lock(target_path):
        previous_content = target_path.read_bytes()
        if (
            expected_hash is not None
            and content_hash(previous_content) != expected_hash
        ):
            raise FileConflictError("ファイルが別の操作で変更されています")
        save_backup(backup_folder, filename, previous_content)
        write_file_atomically(target_path, normalize_content(content))
    return previous_content.decode("utf-8", errors="replace")


def get_file_lock(target_path: Path) -> threading.Lock:
    lock_key = target_path.resolve()
    with file_locks_guard:
        return file_locks.setdefault(lock_key, threading.Lock())


def read_file(project_folder: str, filename: str) -> tuple[str, str]:
    """既存ファイルの内容とハッシュを返す。"""
    project_path = get_project_path(project_folder)
    target_path = get_existing_target_path(project_path, filename)
    if target_path.stat().st_size > MAX_EDITABLE_FILE_BYTES:
        raise FileTooLargeError("ファイルが大きすぎるため表示できません")
    content = target_path.read_bytes()
    try:
        # 置換文字で読むと保存時に内容が壊れるため、UTF-8として正しいものだけ扱う。
        decoded_content = content.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise UnreadableFileError(
            "UTF-8のテキストとして読み込めないファイルです"
        ) from exc
    return decoded_content, content_hash(content)


def save_file(
    project_folder: str,
    filename: str,
    content: str,
    backup_folder: Path,
    expected_hash: str,
) -> str:
    """ユーザーが編集した内容を保存し、保存後のハッシュを返す。"""
    normalized_content = normalize_content(content)
    encoded_content = normalized_content.encode("utf-8")
    if len(encoded_content) > MAX_EDITABLE_FILE_BYTES:
        raise FileTooLargeError("ファイルが大きすぎるため保存できません")
    edit_file(
        project_folder, filename, normalized_content, backup_folder, expected_hash
    )
    return content_hash(encoded_content)


def content_hash(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def save_backup(backup_folder: Path, filename: str, content: bytes) -> None:
    # filenameは検証済みの相対パスなので、そのままバックアップ先の構造に使える。
    timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%S%fZ")
    backup_path = backup_folder / timestamp / filename
    backup_path.parent.mkdir(parents=True, exist_ok=True)
    backup_path.write_bytes(content)


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
