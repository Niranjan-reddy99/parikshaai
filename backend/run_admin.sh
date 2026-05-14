#!/bin/bash
# ── Admin Ingestion Server ────────────────────────────────────────────────────
# Runs the backend with ALL routes — including PDF upload, extraction pipeline,
# audit tools, and question publishing.
# For YOUR use only. Do NOT expose this to the internet.
#
# Usage:  bash run_admin.sh
# Port:   8080  (Admin UI should point to this)
# ─────────────────────────────────────────────────────────────────────────────

set -e
cd "$(dirname "$0")"

source venv/bin/activate 2>/dev/null || true

export APP_ROLE=admin
export PORT=${PORT:-8080}

echo "🔐 Starting ADMIN server on port $PORT..."
echo "   Admin routes: ENABLED (upload, extract, audit, publish)"
echo "   User routes:  ENABLED"
echo "   ⚠️  Keep this private — do not expose publicly."
echo ""

uvicorn main:app --host 127.0.0.1 --port "$PORT" --reload
