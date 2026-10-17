"""structlog JSON logging."""

import logging

import structlog

# HTTP clients log every request URL at INFO, and some providers take their key in the query string (OpenWeather's
# `appid`, NASA's `api_key`): keep those loggers at WARNING so no credential reaches a log line.
_URL_LOGGERS = ("httpx", "httpx2", "httpcore")


def configure_logging(level: str) -> None:
    logging.basicConfig(format="%(message)s", level=level.upper())
    for name in _URL_LOGGERS:
        logging.getLogger(name).setLevel(logging.WARNING)
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            structlog.processors.JSONRenderer(),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(level.upper())),
    )
