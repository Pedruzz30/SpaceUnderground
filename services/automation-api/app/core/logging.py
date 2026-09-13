"""Structured logging for the service.

One formatter, configured once. Application code asks for a logger and passes
context as keyword arguments rather than formatting strings by hand, so a log
line always carries the same shape:

    2026-09-13 14:22:10 INFO  automation.project.published  project_id=...

There is no log shipping here on purpose. When logs need to reach Supabase or
the Admin, a handler is added in one place instead of rewriting call sites.
"""

from __future__ import annotations

import logging
import sys
from typing import Any

_CONFIGURED = False


class ContextFormatter(logging.Formatter):
    """Appends `extra={"context": {...}}` to the message as key=value pairs."""

    def format(self, record: logging.LogRecord) -> str:
        base = super().format(record)
        context = getattr(record, "context", None)
        if not context:
            return base

        pairs = " ".join(f"{key}={value}" for key, value in context.items())
        return f"{base}  {pairs}"


def configure_logging(level: str = "INFO") -> None:
    """Installs the handler. Safe to call more than once."""
    global _CONFIGURED
    if _CONFIGURED:
        return

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        ContextFormatter(
            fmt="%(asctime)s %(levelname)-5s %(name)s  %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    )

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level.upper())

    # Uvicorn installs its own handlers; let them flow through this one.
    for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(name).handlers.clear()
        logging.getLogger(name).propagate = True

    _CONFIGURED = True


def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)


def log_event(logger: logging.Logger, level: int, event: str, /, **context: Any) -> None:
    """Logs a named event with structured context.

    `event` is the stable identifier (automation.project.published); the context
    carries the variable parts. Keeping them separate is what makes these lines
    greppable later.

    The first three parameters are positional-only so a caller may log an
    `event=` field in its context without colliding with this signature.
    """
    logger.log(level, event, extra={"context": context})
