"""Errors with a stable code.

The Admin branches on `code`, never on the message, so a status code alone is
not enough: a 503 can mean "this service is missing its own configuration"
(someone must fix a deploy) or "a dependency is down right now" (wait), and
reporting both the same way sends an operator to the wrong place.
"""

from __future__ import annotations

from fastapi import HTTPException, status

# Used when a handler raises a plain HTTPException. Anything not listed is
# reported as `error`, so a new status never leaks an ad-hoc string.
DEFAULT_CODES = {
    status.HTTP_400_BAD_REQUEST: "bad_request",
    status.HTTP_401_UNAUTHORIZED: "unauthorized",
    status.HTTP_403_FORBIDDEN: "forbidden",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_405_METHOD_NOT_ALLOWED: "method_not_allowed",
    status.HTTP_409_CONFLICT: "conflict",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "validation_error",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "internal_error",
    status.HTTP_502_BAD_GATEWAY: "upstream_error",
    status.HTTP_503_SERVICE_UNAVAILABLE: "unavailable",
}


class ApiError(HTTPException):
    """An HTTPException that names its own code."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(status_code=status_code, detail=message)
        self.code = code


def code_for(exc: HTTPException) -> str:
    return getattr(exc, "code", None) or DEFAULT_CODES.get(exc.status_code, "error")


def not_configured(message: str = "The automation service is not configured.") -> ApiError:
    return ApiError(status.HTTP_503_SERVICE_UNAVAILABLE, "not_configured", message)


def unavailable(message: str = "A dependency of the automation service is unavailable.") -> ApiError:
    return ApiError(status.HTTP_503_SERVICE_UNAVAILABLE, "unavailable", message)


def unauthorized(message: str = "Authentication is required.") -> ApiError:
    return ApiError(status.HTTP_401_UNAUTHORIZED, "unauthorized", message)


def forbidden(message: str = "This account is not allowed to do that.") -> ApiError:
    return ApiError(status.HTTP_403_FORBIDDEN, "forbidden", message)


def bad_request(message: str) -> ApiError:
    return ApiError(status.HTTP_400_BAD_REQUEST, "bad_request", message)


def not_found(message: str) -> ApiError:
    return ApiError(status.HTTP_404_NOT_FOUND, "not_found", message)


def upstream(message: str) -> ApiError:
    return ApiError(status.HTTP_502_BAD_GATEWAY, "upstream_error", message)
