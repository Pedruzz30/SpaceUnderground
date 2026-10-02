"""Runtime configuration, read once from the environment.

Nothing here has a production default. A value that must be a secret is never
given a fallback, so a missing one fails loudly at the edge that needs it
instead of silently running against the wrong project.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnv = Literal["development", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: AppEnv = "development"
    app_host: str = "127.0.0.1"
    app_port: int = 8000

    service_name: str = "space-underground-automation"
    version: str = "0.1.0"

    # Read-only credentials for the Supabase project. The service role key is
    # optional so the service can boot, serve /health and run its tests without
    # it; every endpoint that needs data reports 503 instead of guessing.
    supabase_url: str = ""
    supabase_service_role_key: str = ""
    supabase_timeout_seconds: float = 10.0

    # Only these origins may call the API from a browser. Never "*": this
    # service holds a key that can read every row in the database.
    #
    # The default covers the Admin's dev server on both hosts and both ports it
    # actually uses. A single-origin default looked tidy and silently failed:
    # `npm run dev` binds 127.0.0.1:5173, so the browser got no
    # access-control-allow-origin back and the Admin reported the service as
    # offline while it was answering 200 to curl.
    admin_origin: str = (
        "http://localhost:5174,http://127.0.0.1:5174,"
        "http://localhost:5173,http://127.0.0.1:5173"
    )

    # Optional shared secret, sent as X-API-Token. This is the service-to-service
    # credential: CI, scripts, technical administration. It is deliberately NOT
    # what the Admin uses -- a secret shipped in a browser bundle is not a
    # secret, so the Admin authenticates as its signed-in user instead.
    api_token: str = ""

    # When true, a caller may present a Supabase access token as
    # `Authorization: Bearer`. The service verifies it against Supabase and
    # requires the user to hold a row in public.admins.
    admin_jwt_auth: bool = True

    # How long a verified identity is trusted before it is checked again. The
    # Dashboard polls, and re-verifying every poll would add two Supabase round
    # trips per request for an answer that changes rarely.
    admin_jwt_cache_seconds: float = 60.0

    log_level: str = "INFO"

    @field_validator("supabase_url")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def service_role_key_is_public(self) -> bool:
        """Whether a *public* key was put in the service role slot.

        This is worth detecting because the symptom is otherwise baffling: the
        service authenticates fine, reads published rows fine, and then fails
        every write against a table whose RLS grants nothing -- which reads as
        "the database is broken" rather than "the wrong key is configured".

        Only provably public keys are rejected. An unrecognised shape is
        allowed through, because refusing a key that turns out to be valid
        would be a self-inflicted outage, while a wrong one fails loudly at the
        first write anyway.
        """
        key = self.supabase_service_role_key

        if key.startswith("sb_publishable_"):
            return True

        # Legacy keys are JWTs, and anon and service_role are indistinguishable
        # by prefix -- the role lives in the payload. Read it without verifying
        # the signature: this is a configuration check, not authentication.
        if key.startswith("eyJ"):
            import base64
            import json

            parts = key.split(".")
            if len(parts) < 2:
                return False
            try:
                padded = parts[1] + "=" * (-len(parts[1]) % 4)
                claims = json.loads(base64.urlsafe_b64decode(padded))
            except (ValueError, TypeError):
                return False

            return claims.get("role") in {"anon", "authenticated"}

        return False

    @property
    def allowed_origins(self) -> list[str]:
        """CORS allowlist. Comma-separated so a staging host can be added."""
        return [origin.strip() for origin in self.admin_origin.split(",") if origin.strip()]

    @property
    def has_local_origin(self) -> bool:
        """Whether the allowlist still contains a development origin."""
        return any(
            origin.startswith(("http://localhost", "http://127.0.0.1"))
            for origin in self.allowed_origins
        )

    @property
    def startup_problems(self) -> list[str]:
        """Configuration that makes production meaningless, not merely degraded.

        Only structural values are listed: things that cannot become correct on
        their own. A database that happens to be down is not here, because
        refusing to boot for that would turn a five-minute Supabase blip into an
        outage that needs a human to end.

        Read at startup in production, and reported by /ready everywhere.
        """
        problems: list[str] = []

        if not self.supabase_url:
            problems.append("SUPABASE_URL is not set.")
        if not self.supabase_service_role_key:
            problems.append("SUPABASE_SERVICE_ROLE_KEY is not set.")
        elif self.service_role_key_is_public:
            problems.append(
                "SUPABASE_SERVICE_ROLE_KEY holds a public key; a secret/service role key is required."
            )

        if not self.allowed_origins:
            problems.append("ADMIN_ORIGIN is empty; no browser origin may call this service.")
        elif self.has_local_origin:
            # A production deployment that kept the development default would
            # accept requests from any developer's laptop.
            problems.append(
                "ADMIN_ORIGIN still allows a localhost origin; set it to the deployed Admin origin."
            )

        if not self.api_token and not self.admin_jwt_auth:
            problems.append(
                "No authentication is enabled; set API_TOKEN or leave ADMIN_JWT_AUTH on."
            )

        return problems

    @property
    def supabase_configured(self) -> bool:
        # A public key in the service role slot counts as not configured: the
        # service cannot do privileged work with it, and saying so is more
        # useful than failing later at the first write.
        return bool(
            self.supabase_url
            and self.supabase_service_role_key
            and not self.service_role_key_is_public
        )


@lru_cache
def get_settings() -> Settings:
    """Cached so the environment is read once per process.

    Tests clear the cache with `get_settings.cache_clear()` after changing the
    environment.
    """
    return Settings()
