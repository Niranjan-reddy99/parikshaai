#!/bin/bash
# ── Public API Server ─────────────────────────────────────────────────────────
# Runs the backend with ONLY public-facing routes (questions, practice, exams).
# Admin/ingestion endpoints are completely stripped.
# Use this for your web app users.
#
# Usage:  bash run_public.sh
# Port:   8000  (frontend should point to this)
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")"

source venv/bin/activate 2>/dev/null || true

export APP_ROLE=public
export PORT=${PORT:-8000}

echo "🌐 Starting PUBLIC API server on port $PORT..."
echo "   Admin routes: DISABLED"
echo "   User routes:  ENABLED (questions, practice, exams, explanations)"
echo ""

uvicorn main:app --host 0.0.0.0 --port "$PORT" --reload
