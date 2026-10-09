#!/bin/sh
set -e
# Fail when any command in a pipeline fails (e.g. `git clone ... | logger`), not just the last one
set -o pipefail

log() {
  node /scripts/logger.mjs system "$1"
}

trap 'EXIT_CODE=$?; if [ $EXIT_CODE -ne 0 ]; then node /scripts/logger.mjs system "BUILD_FAILED: Container process exited with code $EXIT_CODE"; fi; exit $EXIT_CODE' EXIT

log "========================================================"
log "Deployer Build Container started for deployment: $DEPLOYMENT_ID"
log "========================================================"

if [ -z "$REPO_URL" ]; then
  log "ERROR: REPO_URL environment variable is required."
  exit 1
fi

BRANCH="${BRANCH:-main}"

# 1. Clone repository directly inside container
log "Cloning repository: $REPO_URL (branch: $BRANCH)..."
git clone --branch "$BRANCH" --depth 1 --single-branch "$REPO_URL" /app 2>&1 | node /scripts/logger.mjs stdout

cd /app

# 2. Framework & build detection
log "Detecting project configuration..."
DETECT_JSON=$(node /scripts/detect.mjs /app)
log "Detection result: $DETECT_JSON"

HAS_BUILD_SCRIPT=$(node -e 'console.log(JSON.parse(process.argv[1]).hasBuildScript)' "$DETECT_JSON")
BUILD_CMD=$(node -e 'console.log(JSON.parse(process.argv[1]).buildCommand)' "$DETECT_JSON")
OUTPUT_SUBDIR=$(node -e 'console.log(JSON.parse(process.argv[1]).outputDir)' "$DETECT_JSON")
FRAMEWORK=$(node -e 'console.log(JSON.parse(process.argv[1]).framework)' "$DETECT_JSON")

# 3. Install dependencies & execute build
if [ "$HAS_BUILD_SCRIPT" = "true" ]; then
  log "Installing project dependencies with npm install..."
  npm install 2>&1 | node /scripts/logger.mjs stdout

  log "Executing build command: $BUILD_CMD ($FRAMEWORK)..."
  $BUILD_CMD 2>&1 | node /scripts/logger.mjs stdout
else
  log "No build script found. Project will be served as static assets."
fi

# 4. Resolve output artifact directory
if [ -d "/app/$OUTPUT_SUBDIR" ] && [ "$OUTPUT_SUBDIR" != "." ]; then
  FINAL_OUTPUT_DIR="/app/$OUTPUT_SUBDIR"
elif [ -d "/app/dist" ]; then
  FINAL_OUTPUT_DIR="/app/dist"
elif [ -d "/app/build" ]; then
  FINAL_OUTPUT_DIR="/app/build"
elif [ -d "/app/out" ]; then
  FINAL_OUTPUT_DIR="/app/out"
elif [ -d "/app/public" ]; then
  FINAL_OUTPUT_DIR="/app/public"
else
  FINAL_OUTPUT_DIR="/app"
fi

log "Resolved artifact directory: $FINAL_OUTPUT_DIR"
export OUTPUT_DIR="$FINAL_OUTPUT_DIR"

# 5. Upload artifacts to S3 via presigned POST
log "Uploading artifacts to S3..."
node /scripts/upload.mjs

log "Artifact upload complete."

# 6. Signal completion to log-service
log "BUILD_COMPLETE"

# Clear trap before successful exit
trap - EXIT
exit 0
