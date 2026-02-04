#!/usr/bin/env bash

# Decode and write google-services.json from environment variable
if [ -n "$GOOGLE_SERVICES_JSON" ]; then
  echo "Writing google-services.json from environment variable..."
  echo "$GOOGLE_SERVICES_JSON" | base64 -d > android/app/google-services.json
  echo "google-services.json created successfully"
else
  echo "Warning: GOOGLE_SERVICES_JSON environment variable not set"
fi
