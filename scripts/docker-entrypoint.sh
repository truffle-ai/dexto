#!/bin/sh
set -eu

exec node /app/dist/index.js --mode server --agent "$CONFIG_FILE" "$@"
