"""HTTP-level limits (sources cited per constant)."""

from typing import Final

# Tool inputs are small JSON bodies; the gateway enforces the same 64 KiB cap in front of the api.
MAX_REQUEST_BYTES: Final = 65_536

HTTP_BAD_REQUEST: Final = 400
HTTP_NOT_FOUND: Final = 404
HTTP_METHOD_NOT_ALLOWED: Final = 405
HTTP_PAYLOAD_TOO_LARGE: Final = 413
HTTP_UNPROCESSABLE: Final = 422
HTTP_INTERNAL: Final = 500
HTTP_CLIENT_ERROR_MIN: Final = 400

JSON_MEDIA_TYPE: Final = "application/json"
