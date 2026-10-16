"""Response objects and JSON serialization helpers."""

from __future__ import annotations

import json
import math
from dataclasses import dataclass, field
from typing import Any, Dict


class HttpError(Exception):
    """An error that maps directly to an HTTP status code."""

    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


class NotFound(HttpError):
    def __init__(self, message: str = "Not found"):
        super().__init__(404, message)


class Forbidden(HttpError):
    def __init__(self, message: str = "Access denied"):
        super().__init__(403, message)


class BadRequest(HttpError):
    def __init__(self, message: str = "Bad request"):
        super().__init__(400, message)


class ServiceUnavailable(HttpError):
    def __init__(self, message: str = "Service unavailable"):
        super().__init__(503, message)


@dataclass
class Response:
    status: int = 200
    body: bytes = b""
    content_type: str = "application/json"
    headers: Dict[str, str] = field(default_factory=dict)


def clean_nan_values(obj: Any) -> Any:
    """Recursively replace NaN and infinity with ``None`` (invalid in JSON)."""
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, dict):
        return {key: clean_nan_values(value) for key, value in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [clean_nan_values(item) for item in obj]
    return obj


def _json_default(obj: Any) -> Any:
    if isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return None
    if hasattr(obj, "to_dict"):
        return obj.to_dict()
    raise TypeError(f"Object of type {type(obj).__name__} is not JSON serializable")


def json_response(data: Any, status: int = 200) -> Response:
    payload = json.dumps(clean_nan_values(data), default=_json_default).encode("utf-8")
    return Response(
        status=status,
        body=payload,
        content_type="application/json",
        headers={"Cache-Control": "no-cache"},
    )


def error_response(status: int, message: str) -> Response:
    return json_response({"error": message, "status": status}, status=status)


def file_response(
    data: bytes,
    content_type: str,
    *,
    cache_seconds: int = 0,
    download_name: str | None = None,
) -> Response:
    headers: Dict[str, str] = {}
    if cache_seconds > 0:
        headers["Cache-Control"] = f"max-age={cache_seconds}"
    if download_name:
        safe_name = download_name.replace('"', "")
        headers["Content-Disposition"] = f'attachment; filename="{safe_name}"'
    return Response(status=200, body=data, content_type=content_type, headers=headers)
