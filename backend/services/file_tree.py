from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal

from backend.services.indexer import EXCLUDED_DIRECTORY_NAMES, is_supported_project_file


@dataclass
class FileTreeNode:
    name: str
    path: str
    type: Literal["directory", "file"]
    children: list[FileTreeNode] = field(default_factory=list)


def build_file_tree(project_folder: Path) -> FileTreeNode:
    if not project_folder.is_dir():
        raise FileNotFoundError(
            f"プロジェクトフォルダが見つかりません: {project_folder}"
        )

    root = FileTreeNode(name=project_folder.name, path="", type="directory")
    nodes_by_path = {"": root}
    for directory_path, directory_names, file_names in os.walk(project_folder):
        directory_names[:] = sorted(
            name for name in directory_names if name not in EXCLUDED_DIRECTORY_NAMES
        )
        directory = Path(directory_path)
        add_directory_nodes(project_folder, directory, nodes_by_path)
        add_file_nodes(project_folder, directory, file_names, nodes_by_path)

    remove_empty_directories(root)
    sort_tree(root)
    return root


def add_directory_nodes(
    project_folder: Path,
    directory_path: Path,
    nodes_by_path: dict[str, FileTreeNode],
) -> None:
    relative_directory = directory_path.relative_to(project_folder)
    if relative_directory == Path("."):
        return

    current_node = nodes_by_path[""]
    path_parts: list[str] = []
    for part in relative_directory.parts:
        path_parts.append(part)
        relative_path = Path(*path_parts).as_posix()
        current_node = get_or_create_directory(
            current_node,
            part,
            relative_path,
            nodes_by_path,
        )


def get_or_create_directory(
    parent: FileTreeNode,
    name: str,
    relative_path: str,
    nodes_by_path: dict[str, FileTreeNode],
) -> FileTreeNode:
    existing_node = nodes_by_path.get(relative_path)
    if existing_node is not None:
        return existing_node

    directory_node = FileTreeNode(name=name, path=relative_path, type="directory")
    parent.children.append(directory_node)
    nodes_by_path[relative_path] = directory_node
    return directory_node


def add_file_nodes(
    project_folder: Path,
    directory_path: Path,
    file_names: list[str],
    nodes_by_path: dict[str, FileTreeNode],
) -> None:
    relative_directory = directory_path.relative_to(project_folder)
    parent_path = (
        "" if relative_directory == Path(".") else relative_directory.as_posix()
    )
    parent = nodes_by_path[parent_path]
    for filename in sorted(file_names):
        file_path = directory_path / filename
        if not is_supported_project_file(file_path):
            continue
        parent.children.append(
            FileTreeNode(
                name=filename,
                path=(relative_directory / filename).as_posix(),
                type="file",
            )
        )


def sort_tree(node: FileTreeNode) -> None:
    node.children.sort(key=lambda child: (child.type == "file", child.name.lower()))
    for child in node.children:
        sort_tree(child)


def remove_empty_directories(node: FileTreeNode) -> bool:
    node.children = [
        child
        for child in node.children
        if child.type == "file" or remove_empty_directories(child)
    ]
    return bool(node.children)
