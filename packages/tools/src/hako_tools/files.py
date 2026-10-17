"""Generated files (ElevenLabs audio) kept on hako-api's data volume for 24 h and served at `GET /v1/files/<id>`.

One file per id plus a JSON sidecar with its media type and expiry. Expired files are removed whenever a new one is
written, so the folder never grows past a day of output.
"""

import re
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

import orjson

from hako_core.settings import get_settings

FILE_TTL_S = 86_400  # @hako/cards: "bytes stored by hako-api, served at /v1/files/<id> for 24 h"
FILES_DIR = "files"
FILES_ROUTE = "/v1/files"
ID_BYTES = 16
FILE_ID_PATTERN = re.compile(r"^[0-9a-f]{32}$")
SIDECAR = ".json"


@dataclass(frozen=True, slots=True)
class StoredFile:
    id: str
    mime_type: str
    bytes: int
    expires_at: str  # ISO 8601, UTC

    @property
    def url(self) -> str:
        """Where the caller fetches it: the public gateway, which forwards /v1/files/<id> to hako-api."""
        return f"{get_settings().public_base_url.rstrip('/')}{FILES_ROUTE}/{self.id}"


def _dir() -> Path:
    path = Path(get_settings().data_dir) / FILES_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def _sweep(folder: Path, now: datetime) -> None:
    for meta in folder.glob(f"*{SIDECAR}"):
        try:
            expires = datetime.fromisoformat(orjson.loads(meta.read_bytes())["expires_at"])
        except (OSError, ValueError, KeyError, orjson.JSONDecodeError):
            continue
        if expires <= now:
            meta.with_suffix("").unlink(missing_ok=True)
            meta.unlink(missing_ok=True)


def save(data: bytes, mime_type: str) -> StoredFile:
    folder = _dir()
    now = datetime.now(UTC)
    _sweep(folder, now)
    file_id = secrets.token_hex(ID_BYTES)
    expires = (now + timedelta(seconds=FILE_TTL_S)).isoformat(timespec="seconds")
    (folder / file_id).write_bytes(data)
    (folder / f"{file_id}{SIDECAR}").write_bytes(orjson.dumps({"mime_type": mime_type, "expires_at": expires}))
    return StoredFile(id=file_id, mime_type=mime_type, bytes=len(data), expires_at=expires)


def find(file_id: str) -> tuple[Path, str] | None:
    """The file's path and media type, or None when unknown or expired."""
    if not FILE_ID_PATTERN.match(file_id):
        return None
    folder = _dir()
    meta_path, path = folder / f"{file_id}{SIDECAR}", folder / file_id
    try:
        meta = orjson.loads(meta_path.read_bytes())
    except (OSError, orjson.JSONDecodeError):
        return None
    if datetime.fromisoformat(meta["expires_at"]) <= datetime.now(UTC) or not path.exists():
        return None
    return path, str(meta["mime_type"])
