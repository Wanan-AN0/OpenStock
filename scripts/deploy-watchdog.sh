#!/bin/bash
# OpenStock Deploy Watchdog — polling mode
# Polls GHCR for new image digests and auto-pulls when updated.
# Run: ./scripts/deploy-watchdog.sh
# Keep it running: nohup ./scripts/deploy-watchdog.sh >> logs/watchdog.log 2>&1 &
#
# Or via launchd (macOS):
#   ln -sf "$(pwd)/scripts/com.openstock.watchdog.plist" ~/Library/LaunchAgents/
#   launchctl load ~/Library/LaunchAgents/com.openstock.watchdog.plist

set -euo pipefail

COMPOSE_DIR="${DOCKER_COMPOSE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
IMAGE="${GHCR_IMAGE:-ghcr.io/wanan-an0/openstock}"
POLL_INTERVAL="${POLL_INTERVAL:-120}"   # seconds between checks
STATE_FILE="${HOME}/.openstock/.watchdog_state"

log() { echo "[$(date '+%H:%M:%S')] $*"; }

# Load previous digest
get_current_digest() {
  docker images --format '{{.Repository}}:{{.Tag}}' | grep "^${IMAGE}:" | head -1 || echo ""
}

get_remote_digest() {
  # Fetch the 'latest' tag digest from GHCR
  TOKEN=$(curl -s "https://ghcr.io/token?service=ghcr.io&scope=repository:${IMAGE#ghcr.io/}:pull" | python3 -c "import sys,json; print(json.load(sys.stdin)['token'])")
  DIGEST=$(curl -s -H "Authorization: Bearer ${TOKEN}" \
    -H "Accept: application/vnd.docker.distribution.manifest.v2+json" \
    "https://ghcr.io/v2/${IMAGE#ghcr.io/}/manifests/latest" 2>/dev/null || echo "")
  echo "$DIGEST"
}

pull_and_restart() {
  log "🆕 New image detected — pulling..."
  docker compose -f "${COMPOSE_DIR}/docker-compose.yml" down || true
  docker pull "${IMAGE}:latest"
  docker compose -f "${COMPOSE_DIR}/docker-compose.yml" up -d
  log "✅ Container restarted with latest image"
}

save_state() { echo "$1" > "$STATE_FILE"; }
load_state() { cat "$STATE_FILE" 2>/dev/null || echo ""; }
mkdir -p "$(dirname "$STATE_FILE")"

log "🚀 OpenStock Watchdog started"
log "   Image: ${IMAGE}"
log "   Poll interval: ${POLL_INTERVAL}s"
log "   Compose dir: ${COMPOSE_DIR}"
log "   Press Ctrl+C to stop"
echo ""

# Initial pull
if [[ -z "$(get_current_digest)" ]]; then
  log "📦 No local image found — pulling latest..."
  docker pull "${IMAGE}:latest"
  docker compose -f "${COMPOSE_DIR}/docker-compose.yml" up -d
fi

PREV_DIGEST=$(load_state)
while true; do
  CURR_DIGEST=$(get_remote_digest)
  if [[ -n "$CURR_DIGEST" && "$CURR_DIGEST" != "$PREV_DIGEST" ]]; then
    log "Digest changed: ${CURR_DIGEST:0:16}..."
    pull_and_restart
    PREV_DIGEST="$CURR_DIGEST"
    save_state "$CURR_DIGEST"
  else
    log "No update available (${POLL_INTERVAL}s)"
  fi
  sleep "$POLL_INTERVAL"
done
