"""FastAPI application entry point.

Run locally with:

    uvicorn app.main:app --reload
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.v1.router import api_router
from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger, log_event
from app.schemas.common import ErrorResponse, HealthResponse

logger = get_logger("app")

# Maps an HTTP status onto the stable `code` clients branch on. Anything not
# listed is reported as `error`, so a new status never leaks an ad-hoc string.
ERROR_CODES = {
    status.HTTP_400_BAD_REQUEST: "bad_request",
    status.HTTP_401_UNAUTHORIZED: "unauthorized",
    status.HTTP_404_NOT_FOUND: "not_found",
    status.HTTP_422_UNPROCESSABLE_ENTITY: "validation_error",
    status.HTTP_500_INTERNAL_SERVER_ERROR: "internal_error",
    status.HTTP_502_BAD_GATEWAY: "upstream_error",
    status.HTTP_503_SERVICE_UNAVAILABLE: "not_configured",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    configure_logging(settings.log_level)

    log_event(
        logger,
        logging.INFO,
        "app.startup",
        env=settings.app_env,
        supabase=settings.supabase_configured,
        auth="token" if settings.api_token else "open",
    )

    # Worth saying out loud rather than discovering later: this process can
    # read the whole database, so running it open is a development-only choice.
    if not settings.api_token and not settings.is_production:
        log_event(
            logger,
            logging.WARNING,
            "app.startup.unauthenticated",
            hint="set API_TOKEN to require a secret",
        )

    yield

    log_event(logger, logging.INFO, "app.shutdown")


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="Space Underground Automation API",
        description=(
            "Processing layer for the Space Underground Admin: project analysis, "
            "operational reporting and automations. CRUD stays on Supabase."
        ),
        version=settings.version,
        lifespan=lifespan,
    )

    # Never "*": this service holds a key that can read every row.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "OPTIONS"],
        allow_headers=["Content-Type", "X-API-Token"],
    )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = ERROR_CODES.get(exc.status_code, "error")
        return JSONResponse(
            status_code=exc.status_code,
            content=ErrorResponse(code=code, message=str(exc.detail)).model_dump(),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        # The field-level detail is useful and safe: it describes the request
        # the caller just sent, not the server.
        log_event(logger, logging.INFO, "request.invalid", path=request.url.path)
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content=ErrorResponse(
                code="validation_error",
                message="Request validation failed.",
            ).model_dump(),
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
        # The traceback goes to the log, never to the client.
        logger.exception("unhandled error on %s", request.url.path)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(code="internal_error", message="Internal server error.").model_dump(),
        )

    # Root-level probe, outside the versioned surface, so an uptime check never
    # has to follow an API version.
    @app.get("/health", response_model=HealthResponse, tags=["health"], summary="Liveness probe")
    async def root_health() -> HealthResponse:
        return HealthResponse(status="ok", service=settings.service_name, version=settings.version)

    app.include_router(api_router)

    return app


app = create_app()
