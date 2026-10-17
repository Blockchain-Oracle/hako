"""JSON response rendered with orjson."""

from typing import Any

import orjson
from starlette.responses import JSONResponse


class HakoJSONResponse(JSONResponse):
    media_type = "application/json"

    def render(self, content: Any) -> bytes:
        return orjson.dumps(content, option=orjson.OPT_NON_STR_KEYS)
