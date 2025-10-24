"""API route registration."""

from fastapi import APIRouter

from . import handlers


def get_api_router() -> APIRouter:
    router = APIRouter()
    router.include_router(handlers.router, prefix="/api")
    return router
