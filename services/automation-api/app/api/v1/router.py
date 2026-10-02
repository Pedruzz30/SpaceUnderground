"""Assembles the v1 API surface."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.v1 import automations, health, projects, reports

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
api_router.include_router(projects.router)
api_router.include_router(reports.router)
api_router.include_router(automations.router)
