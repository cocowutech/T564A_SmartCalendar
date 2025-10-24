from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api import get_api_router

app = FastAPI(title="Smart Calendar Agent", version="0.1.0")

# Mount static files
static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=str(static_dir)), name="static")

# Include API routes
app.include_router(get_api_router())


# Serve the main UI
@app.get("/")
async def read_root():
    return FileResponse(static_dir / "index.html")
