#!/usr/bin/env bash

# ContentBot Dashboard - Quick Start Script
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "=========================================================="
echo "      🤖 Starting ContentBot AI & WhatsApp Dashboard       "
echo "=========================================================="

# Ensure MongoDB (100% Free Community Edition) is running
if ! nc -z 127.0.0.1 27017 2>/dev/null; then
  echo "📦 Starting MongoDB Server (Free Community Edition)..."
  if systemctl --user is-enabled mongod >/dev/null 2>&1; then
    systemctl --user start mongod
  else
    /home/sahadat/.local/bin/mongod --config /home/sahadat/.config/mongodb/mongod.conf &
  fi
  sleep 2
fi

if nc -z 127.0.0.1 27017 2>/dev/null; then
  echo "✅ MongoDB active on port 27017 (Persistent storage enabled)"
else
  echo "⚠️  MongoDB on port 27017 not detected (Backend will fallback to in-memory mode)"
fi

# Check LM Studio
if curl -s http://localhost:1234/v1/models >/dev/null 2>&1; then
  echo "✅ LM Studio detected on http://localhost:1234"
else
  echo "ℹ️  LM Studio not detected on http://localhost:1234 (Start LM Studio & load a model when ready)"
fi

echo ""
echo "🚀 Starting Backend on http://0.0.0.0:5000..."
cd "$DIR/backend"
node src/index.js &
BACKEND_PID=$!

echo "🚀 Starting Frontend on http://0.0.0.0:3001..."
cd "$DIR/frontend"
npm run dev &
FRONTEND_PID=$!

echo ""
echo "=========================================================="
echo "✨ Services are up and running!"
echo "👉 Local access:   http://localhost:3001"
echo "👉 LAN access:     http://192.168.0.114:3001"
echo "👉 Admin Account:  admin@contentbot.local"
echo "👉 Admin Password: Admin@123456"
echo "=========================================================="
echo "Press Ctrl+C to stop all services."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true; exit" SIGINT SIGTERM
wait
