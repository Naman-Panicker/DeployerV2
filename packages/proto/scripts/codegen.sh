#!/bin/bash
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DIR/../../.." && pwd)"
PROTO_DIR="$ROOT_DIR/proto"
OUT_DIR="$DIR/../src/generated"

mkdir -p "$OUT_DIR"

# Find protoc binary (check PATH first, then homebrew)
PROTOC_BIN="$(which protoc 2>/dev/null || true)"
if [ -z "$PROTOC_BIN" ] && [ -x "/opt/homebrew/bin/protoc" ]; then
  PROTOC_BIN="/opt/homebrew/bin/protoc"
fi

if [ -z "$PROTOC_BIN" ]; then
  echo "Error: protoc not found in PATH or /opt/homebrew/bin/protoc" >&2
  exit 1
fi

# Find protoc-gen-ts_proto plugin binary
PLUGIN_BIN="$ROOT_DIR/node_modules/.bin/protoc-gen-ts_proto"
if [ ! -f "$PLUGIN_BIN" ]; then
  PLUGIN_BIN="$(which protoc-gen-ts_proto 2>/dev/null || true)"
fi

if [ ! -f "$PLUGIN_BIN" ]; then
  echo "Error: protoc-gen-ts_proto not found in $ROOT_DIR/node_modules/.bin or PATH" >&2
  exit 1
fi

echo "Running proto codegen..."
echo "Using protoc: $PROTOC_BIN"
echo "Using plugin: $PLUGIN_BIN"

"$PROTOC_BIN" \
  --plugin="protoc-gen-ts_proto=$PLUGIN_BIN" \
  --ts_proto_out="$OUT_DIR" \
  --ts_proto_opt=outputServices=grpc-js \
  --ts_proto_opt=esModuleInterop=true \
  --proto_path="$PROTO_DIR" \
  "$PROTO_DIR"/*.proto

echo "Proto codegen completed successfully -> $OUT_DIR"
