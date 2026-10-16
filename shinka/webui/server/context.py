"""Configuration shared by every request handler."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from .db_reader import ReadCache

WEBUI_DIR = Path(__file__).resolve().parent.parent


@dataclass
class ServerContext:
    """Immutable server settings plus the shared read cache."""

    search_root: Path
    static_dir: Path = WEBUI_DIR
    cache: ReadCache = field(default_factory=ReadCache)
    pdf_export_enabled: bool = True

    def __post_init__(self) -> None:
        self.search_root = Path(self.search_root).resolve()
        self.static_dir = Path(self.static_dir).resolve()
