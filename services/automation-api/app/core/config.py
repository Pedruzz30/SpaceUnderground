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

    # Optional shared secret. When set, callers must send it as X-API-Token.
    # Unset is allowed in development and refused in production.
    api_token: str = ""

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
