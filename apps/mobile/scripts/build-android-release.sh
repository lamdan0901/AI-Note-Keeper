#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$APP_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" ]] && continue
    [[ "$line" =~ ^[[:space:]]*# ]] && continue

    if [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]}"
      value="${BASH_REMATCH[2]}"

      # Preserve values already exported in the current shell session.
      if [[ -z "${!key:-}" ]]; then
        export "$key=$value"
      fi
    fi
  done < "$ENV_FILE"
fi

if [[ -z "${EXPO_PUBLIC_API_BASE_URL:-}" && -z "${EXPO_PUBLIC_AUTH_API_URL:-}" ]]; then
  echo "Release build requires EXPO_PUBLIC_API_BASE_URL or EXPO_PUBLIC_AUTH_API_URL." >&2
  echo "Checked: $ENV_FILE and current shell environment." >&2
  exit 1
fi

echo "Building release APK with:"
echo "  EXPO_PUBLIC_API_BASE_URL=${EXPO_PUBLIC_API_BASE_URL:-<unset>}"
echo "  EXPO_PUBLIC_AUTH_API_URL=${EXPO_PUBLIC_AUTH_API_URL:-<unset>}"

cd "$APP_DIR/android"
exec ./gradlew clean assembleRelease "$@"
