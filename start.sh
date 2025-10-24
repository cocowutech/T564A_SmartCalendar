#!/bin/bash

# Smart Calendar Agent - Startup Script
# This ensures the virtual environment is activated before starting the server

cd "$(dirname "$0")"

# Activate virtual environment
source .venv/bin/activate

# Start the server
echo "Starting Smart Calendar Agent..."
echo "Open http://localhost:8000 in your browser"
echo ""

python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
