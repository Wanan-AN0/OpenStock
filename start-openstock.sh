#!/bin/bash
# Start OpenStock container + auto-update watchdog
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Starting OpenStock..."
docker rm -f openstock 2>/dev/null || true

docker run -d \
  --name openstock \
  --restart unless-stopped \
  -p 3001:3000 \
  --add-host mongodb:host-gateway \
  --env-file "$DIR/.env" \
  ghcr.io/wanan-an0/openstock:latest

echo "✅ OpenStock started at http://localhost:3001"

echo "🚀 Starting watchdog..."
mkdir -p "$DIR/logs"
nohup bash "$DIR/scripts/deploy-watchdog.sh" \
  >> "$DIR/logs/watchdog.log" 2>&1 &

echo "✅ Watchdog running (PID: $!)"
echo "   Logs: $DIR/logs/watchdog.log"
