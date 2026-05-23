#!/bin/bash
cd "$(dirname "$0")"
source venv/bin/activate

while true; do
  PID=$(lsof -ti :8000)
  if [ -n "$PID" ]; then
    kill -15 $PID 2>/dev/null   # ask nicely first (SIGTERM)
    sleep 5
    kill -9 $PID 2>/dev/null    # force kill if still alive
  fi
  echo "$(date): Starting backend..."
  uvicorn main:app --port 8000
  echo "$(date): Backend crashed, restarting in 3s..."
  sleep 3
done
