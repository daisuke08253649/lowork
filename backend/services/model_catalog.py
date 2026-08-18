from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Literal

from bs4 import BeautifulSoup, Tag

LIBRARY_MODEL_LINK_SELECTOR = 'a[href^="/library/"]'
PARAMETER_LABEL_PATTERN = re.compile(
    r"^(?P<value>\d+(?:\.\d+)?)(?P<unit>[BM])$", re.IGNORECASE
)
MOE_PARAMETER_LABEL_PATTERN = re.compile(
    r"^\d+(?:\.\d+)?x\d+(?:\.\d+)?B$", re.IGNORECASE
)
EFFECTIVE_PARAMETER_LABEL_PATTERN = re.compile(r"^E\d+(?:\.\d+)?B$", re.IGNORECASE)
MEMORY_REQUIREMENTS_GB = ((3, 3), (7, 5), (13, 8), (30, 20), (70, 40))
CompatibilityStatus = Literal["available", "warning", "unavailable", "unknown"]


@dataclass(frozen=True)
class CatalogModel:
    name: str
    labels: list[str]


def extract_parameter_labels(texts: Iterable[str]) -> list[str]:
    normalized_texts = [" ".join(text.split()) for text in texts]
    labels: list[str] = []
    for index, text in enumerate(normalized_texts):
        normalized = text.upper()
        if not is_parameter_label(normalized) or is_pull_count(normalized_texts, index):
            continue
        if normalized in labels:
            continue
        labels.append(normalized)
    return labels


def is_parameter_label(value: str) -> bool:
    return bool(
        PARAMETER_LABEL_PATTERN.fullmatch(value)
        or MOE_PARAMETER_LABEL_PATTERN.fullmatch(value)
        or EFFECTIVE_PARAMETER_LABEL_PATTERN.fullmatch(value)
    )


def is_pull_count(texts: list[str], index: int) -> bool:
    next_index = index + 1
    return next_index < len(texts) and texts[next_index].lower() == "pulls"


def model_name_from_link(link: Tag) -> str | None:
    href = link.get("href")
    if not isinstance(href, str):
        return None
    model_path = href.removeprefix("/library/").strip("/")
    if not model_path or "/" in model_path:
        return None
    return model_path


def parse_catalog_models(html: str) -> list[CatalogModel]:
    soup = BeautifulSoup(html, "html.parser")
    models_by_name: dict[str, list[str]] = {}
    for link in soup.select(LIBRARY_MODEL_LINK_SELECTOR):
        name = model_name_from_link(link)
        if name is None:
            continue
        labels = extract_parameter_labels(link.stripped_strings)
        existing_labels = models_by_name.setdefault(name, [])
        for label in labels:
            if label not in existing_labels:
                existing_labels.append(label)
    return [
        CatalogModel(name=name, labels=labels)
        for name, labels in models_by_name.items()
    ]


def parameter_count_billions(label: str | None) -> float | None:
    if label is None:
        return None
    match = PARAMETER_LABEL_PATTERN.fullmatch(label)
    if match is None:
        return None
    value = float(match.group("value"))
    return value / 1000 if match.group("unit").upper() == "M" else value


def required_memory_gb(label: str | None) -> float | None:
    parameters = parameter_count_billions(label)
    if parameters is None:
        return None
    for maximum_parameters, memory_gb in MEMORY_REQUIREMENTS_GB:
        if parameters <= maximum_parameters:
            return float(memory_gb)
    return round(parameters * MEMORY_REQUIREMENTS_GB[-1][1] / 70, 1)


def compatibility_status(ram_gb: float, label: str | None) -> CompatibilityStatus:
    required_gb = required_memory_gb(label)
    if required_gb is None:
        return "unknown"
    if ram_gb < required_gb:
        return "unavailable"
    if ram_gb < required_gb * 1.5:
        return "warning"
    return "available"


def pull_model_name(model: CatalogModel, label: str | None) -> str:
    if label is None:
        return model.name
    return f"{model.name}:{label.lower()}"


def default_variant_label(model: CatalogModel) -> str | None:
    if len(model.labels) != 1:
        return None
    return model.labels[0]
