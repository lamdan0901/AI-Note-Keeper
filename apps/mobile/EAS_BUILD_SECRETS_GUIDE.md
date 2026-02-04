# EAS Build: Providing Gitignored Files Guide

## Overview

This guide explains how to provide gitignored files (like `google-services.json`, `.env`, API keys, etc.) to EAS Build without committing them to your repository.

**Key Concept**: EAS Build only uploads files tracked by git. For sensitive or environment-specific files that are gitignored, you must provide them via EAS secrets and environment variables.

---

## Table of Contents

1. [Understanding the Problem](#understanding-the-problem)
2. [Solution Overview](#solution-overview)
3. [Method 1: File-Based Secrets (e.g., google-services.json)](#method-1-file-based-secrets)
4. [Method 2: String-Based Secrets (e.g., .env variables)](#method-2-string-based-secrets)
5. [Using Build Hooks](#using-build-hooks)
6. [Complete Example](#complete-example)
7. [Troubleshooting](#troubleshooting)

---

## Understanding the Problem

### Why Files Are Missing

When you run an EAS build:

1. EAS only uploads files tracked by git
2. Gitignored files (`.env`, `google-services.json`, etc.) are NOT uploaded
3. Your build fails because required files are missing

### Common Error Messages

```
"google-services.json" is missing, make sure that the file exists.
Remember that EAS Build only uploads the files tracked by git.
```

---

## Solution Overview

There are two main approaches:

| Approach                 | Best For                   | Example Files                                      |
| ------------------------ | -------------------------- | -------------------------------------------------- |
| **File-based secrets**   | Binary files, JSON configs | `google-services.json`, `GoogleService-Info.plist` |
| **String-based secrets** | Environment variables      | `.env` variables, API keys                         |

Both approaches use:

- **EAS Secrets**: Store sensitive data securely on EAS servers
- **Environment Variables**: Reference secrets in your build configuration
- **Build Hooks**: Scripts that run during the build to reconstruct files

---

## Method 1: File-Based Secrets

Use this for configuration files like `google-services.json`.

### Step 1: Encode the File to Base64

**On macOS/Linux:**

```bash
base64 -w 0 android/app/google-services.json > google-services-base64.txt
```

**On Windows (PowerShell):**

```powershell
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("android\app\google-services.json")) | Out-File -FilePath "google-services-base64.txt" -NoNewline
```

This creates a text file with the base64-encoded content.

### Step 2: Create EAS Secret

```bash
# Using the new command (recommended)
eas env:create --scope project --name GOOGLE_SERVICES_JSON --value "$(cat google-services-base64.txt)"

# Or using the deprecated command
npx eas-cli secret:create --scope project --name GOOGLE_SERVICES_JSON --type string --value "$(cat google-services-base64.txt)"
```

> **Note**: Paste the entire base64 string as the value. You can also create the secret interactively by omitting `--value`.

### Step 3: Add to eas.json

Reference the secret in your build configuration:

```json
{
  "build": {
    "preview": {
      "env": {
        "GOOGLE_SERVICES_JSON": "@GOOGLE_SERVICES_JSON"
      }
    },
    "production": {
      "env": {
        "GOOGLE_SERVICES_JSON": "@GOOGLE_SERVICES_JSON"
      }
    }
  }
}
```

> **Key**: The `@` prefix tells EAS to load the value from secrets.

### Step 4: Create Build Hook to Decode File

Create `eas-build-pre-install.sh` in your project root:

```bash
#!/usr/bin/env bash

# Decode and write google-services.json
if [ -n "$GOOGLE_SERVICES_JSON" ]; then
  echo "📝 Writing google-services.json from environment variable..."
  echo "$GOOGLE_SERVICES_JSON" | base64 -d > android/app/google-services.json
  echo "✅ google-services.json created successfully"
else
  echo "⚠️  Warning: GOOGLE_SERVICES_JSON environment variable not set"
fi
```

> **Important**: EAS automatically detects and runs `eas-build-pre-install.sh` if it exists. No need to reference it in `eas.json`!

### Step 5: Make Script Executable (if on macOS/Linux)

```bash
chmod +x eas-build-pre-install.sh
```

---

## Method 2: String-Based Secrets

Use this for individual environment variables from your `.env` file.

### Step 1: Identify Variables

List all environment variables from your `.env` file:

```env
EXPO_PUBLIC_API_KEY=abc123
EXPO_PUBLIC_CONVEX_URL=https://example.convex.cloud
EXPO_PUBLIC_USER_ID=local-user
```

### Step 2: Create EAS Secrets for Each Variable

```bash
# Create secret for each variable
eas env:create --scope project --name EXPO_PUBLIC_API_KEY --value "abc123"
eas env:create --scope project --name EXPO_PUBLIC_CONVEX_URL --value "https://example.convex.cloud"
eas env:create --scope project --name EXPO_PUBLIC_USER_ID --value "local-user"
```

**Alternative**: Create interactively without `--value`:

```bash
eas env:create --scope project --name EXPO_PUBLIC_API_KEY
# You'll be prompted to enter the value
```

### Step 3: Add to eas.json

```json
{
  "build": {
    "preview": {
      "env": {
        "EXPO_PUBLIC_API_KEY": "@EXPO_PUBLIC_API_KEY",
        "EXPO_PUBLIC_CONVEX_URL": "@EXPO_PUBLIC_CONVEX_URL",
        "EXPO_PUBLIC_USER_ID": "@EXPO_PUBLIC_USER_ID"
      }
    }
  }
}
```

> **No build hook needed**: EAS automatically injects these as environment variables during the build.

---

## Using Build Hooks

EAS supports several build hooks that run at different stages:

| Hook File                           | When It Runs                     |
| ----------------------------------- | -------------------------------- |
| `eas-build-pre-install.sh`          | Before installing dependencies   |
| `eas-build-post-install.sh`         | After installing dependencies    |
| `eas-build-pre-upload-artifacts.sh` | Before uploading build artifacts |

### Auto-Detection

EAS automatically detects and runs these scripts if they exist in your project root. **No configuration in eas.json needed!**

### Example: Multi-File Hook

```bash
#!/usr/bin/env bash

# Decode google-services.json for Android
if [ -n "$GOOGLE_SERVICES_JSON" ]; then
  echo "📝 Writing google-services.json..."
  echo "$GOOGLE_SERVICES_JSON" | base64 -d > android/app/google-services.json
  echo "✅ google-services.json created"
fi

# Decode GoogleService-Info.plist for iOS
if [ -n "$GOOGLE_SERVICE_INFO_PLIST" ]; then
  echo "📝 Writing GoogleService-Info.plist..."
  echo "$GOOGLE_SERVICE_INFO_PLIST" | base64 -d > ios/GoogleService-Info.plist
  echo "✅ GoogleService-Info.plist created"
fi

# Create .env file if variables are set
if [ -n "$EXPO_PUBLIC_API_KEY" ]; then
  echo "📝 Creating .env file..."
  cat > .env << EOF
EXPO_PUBLIC_API_KEY=$EXPO_PUBLIC_API_KEY
EXPO_PUBLIC_CONVEX_URL=$EXPO_PUBLIC_CONVEX_URL
EOF
  echo "✅ .env file created"
fi
```

---

## Complete Example

Here's a complete setup for a React Native/Expo project with Convex and Firebase.

### Project Structure

```
apps/mobile/
├── android/app/
│   └── google-services.json          # Gitignored
├── .env                               # Gitignored
├── eas.json                           # Tracked
└── eas-build-pre-install.sh          # Tracked
```

### .gitignore

```gitignore
# Sensitive files
.env*
apps/mobile/google-services.json
google-services.json

# Standard ignores
node_modules/
*.log
```

### eas.json

```json
{
  "cli": {
    "version": ">= 5.9.1"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "env": {
        "GOOGLE_SERVICES_JSON": "@GOOGLE_SERVICES_JSON",
        "EXPO_PUBLIC_CONVEX_URL": "@EXPO_PUBLIC_CONVEX_URL",
        "EXPO_PUBLIC_USER_ID": "@EXPO_PUBLIC_USER_ID",
        "EXPO_PUBLIC_API_KEY": "@EXPO_PUBLIC_API_KEY"
      }
    },
    "preview": {
      "distribution": "internal",
      "android": {
        "buildType": "apk"
      },
      "env": {
        "GOOGLE_SERVICES_JSON": "@GOOGLE_SERVICES_JSON",
        "EXPO_PUBLIC_CONVEX_URL": "@EXPO_PUBLIC_CONVEX_URL",
        "EXPO_PUBLIC_USER_ID": "@EXPO_PUBLIC_USER_ID",
        "EXPO_PUBLIC_API_KEY": "@EXPO_PUBLIC_API_KEY"
      }
    },
    "production": {
      "env": {
        "GOOGLE_SERVICES_JSON": "@GOOGLE_SERVICES_JSON",
        "EXPO_PUBLIC_CONVEX_URL": "@EXPO_PUBLIC_CONVEX_URL",
        "EXPO_PUBLIC_USER_ID": "@EXPO_PUBLIC_USER_ID",
        "EXPO_PUBLIC_API_KEY": "@EXPO_PUBLIC_API_KEY"
      }
    }
  }
}
```

### eas-build-pre-install.sh

```bash
#!/usr/bin/env bash

echo "🚀 Running pre-install build hook..."

# Decode google-services.json
if [ -n "$GOOGLE_SERVICES_JSON" ]; then
  echo "📝 Writing google-services.json..."
  echo "$GOOGLE_SERVICES_JSON" | base64 -d > android/app/google-services.json
  echo "✅ google-services.json created"
else
  echo "⚠️  GOOGLE_SERVICES_JSON not set"
fi

# Log environment variables (for debugging)
echo "🔍 Environment check:"
echo "  - EXPO_PUBLIC_CONVEX_URL: ${EXPO_PUBLIC_CONVEX_URL:0:30}..."
echo "  - EXPO_PUBLIC_USER_ID: $EXPO_PUBLIC_USER_ID"

echo "✅ Pre-install hook completed"
```

### Setup Commands

```bash
# 1. Encode google-services.json (Windows)
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("android\app\google-services.json")) | Out-File -FilePath "google-services-base64.txt" -NoNewline

# 2. Create file-based secret
eas env:create --scope project --name GOOGLE_SERVICES_JSON
# Paste the base64 content when prompted

# 3. Create environment variable secrets
eas env:create --scope project --name EXPO_PUBLIC_CONVEX_URL --value "https://your-url.convex.cloud"
eas env:create --scope project --name EXPO_PUBLIC_USER_ID --value "local-user"
eas env:create --scope project --name EXPO_PUBLIC_API_KEY --value "your-api-key"

# 4. Build
eas build --platform android --profile preview
```

---

## Troubleshooting

### Error: "eas.json is not valid - prebuild is not allowed"

**Problem**: You tried to add `"prebuild": { "script": "..." }` in eas.json.

**Solution**: Remove it! EAS auto-detects hook files. Just create `eas-build-pre-install.sh` in your project root.

### Error: "Secret not found"

**Problem**: You referenced `@SECRET_NAME` in eas.json but didn't create the secret.

**Solution**: Create the secret first:

```bash
eas env:create --scope project --name SECRET_NAME
```

### Error: "base64: invalid input"

**Problem**: The base64 string is corrupted or incomplete.

**Solution**: Re-encode the file and ensure you copy the ENTIRE output:

```bash
# Verify the base64 encoding
cat google-services-base64.txt | base64 -d > test-output.json
# Check if test-output.json matches the original
```

### File Still Missing After Build Hook

**Problem**: The hook script ran but the file wasn't created.

**Solution**: Check these:

1. Environment variable is set in eas.json: `"VAR_NAME": "@VAR_NAME"`
2. Secret exists: `eas env:list`
3. Hook script has correct path: `echo "$VAR" | base64 -d > correct/path/to/file`
4. Hook script is executable (macOS/Linux): `chmod +x eas-build-pre-install.sh`

### Windows vs Unix Line Endings

**Problem**: Hook script fails on EAS (Linux) due to CRLF line endings.

**Solution**: Convert to LF line endings:

```bash
# Git will handle this if you add to .gitattributes:
*.sh text eol=lf
```

---

## Best Practices

### Security

- ✅ **DO**: Keep sensitive files gitignored
- ✅ **DO**: Use EAS secrets for all sensitive data
- ✅ **DO**: Use different secrets for different environments (preview vs production)
- ❌ **DON'T**: Commit `.env` files or API keys to git
- ❌ **DON'T**: Share base64 files in public channels

### Organization

- Create separate secrets for each environment if values differ:
  ```bash
  eas env:create --scope project --name PROD_API_KEY
  eas env:create --scope project --name DEV_API_KEY
  ```
- Use clear naming conventions:

  ```bash
  # Good
  GOOGLE_SERVICES_JSON
  EXPO_PUBLIC_FIREBASE_API_KEY

  # Bad
  SECRET1
  CONFIG
  ```

### Maintenance

- **Document your secrets**: Keep a list of required secrets in your README
- **Verify secrets exist**: Run `eas env:list` before building
- **Clean up old secrets**: Remove unused secrets with `eas env:delete`

---

## Quick Reference

### Common Commands

```bash
# List all secrets
eas env:list

# Create a secret (interactive)
eas env:create --scope project --name SECRET_NAME

# Create a secret (non-interactive)
eas env:create --scope project --name SECRET_NAME --value "secret-value"

# Delete a secret
eas env:delete --name SECRET_NAME

# Build with profile
eas build --platform android --profile preview
```

### File Encoding Patterns

**Base64 encode (macOS/Linux):**

```bash
base64 -w 0 path/to/file.json
```

**Base64 encode (Windows PowerShell):**

```powershell
[Convert]::ToBase64String([System.IO.File]::ReadAllBytes("path\to\file.json"))
```

**Base64 decode in hook:**

```bash
echo "$ENV_VAR" | base64 -d > path/to/output.json
```

---

## Additional Resources

- [EAS Build Environment Variables](https://docs.expo.dev/build-reference/variables/)
- [EAS Build Hooks](https://docs.expo.dev/build-reference/custom-build-config/)
- [Managing Secrets](https://docs.expo.dev/build-reference/variables/#using-secrets-in-environment-variables)

---

**Last Updated**: January 2026
