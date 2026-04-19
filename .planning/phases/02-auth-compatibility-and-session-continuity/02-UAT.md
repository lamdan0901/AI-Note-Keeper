---
status: testing
phase: 02-auth-compatibility-and-session-continuity
source: 02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md
started: 2026-04-18T04:48:12.8954177Z
updated: 2026-04-18T04:48:12.8954177Z
---

## Current Test

number: 1
name: Web Register Creates Authenticated Session
expected: |
On web, registering a new account with valid credentials succeeds and immediately enters authenticated state. Reloading the page keeps the session active without asking the user to log in again.
awaiting: user response

## Tests

### 1. Web Register Creates Authenticated Session

expected: On web, registering a new account with valid credentials succeeds and immediately enters authenticated state. Reloading the page keeps the session active without asking the user to log in again.
result: [pending]

### 2. Web Login and Logout Contract

expected: On web, login with valid credentials succeeds and logout ends only the current web session. After logout, protected actions require login again.
result: [pending]

### 3. Web Session Refresh Continuity

expected: On web, an authenticated session survives normal token refresh behavior and bootstrap checks without exposing refresh tokens in local storage.
result: [pending]

### 4. Mobile Login Persists Across App Restart

expected: On mobile, login succeeds and reopening the app restores authenticated state from secure storage without forcing a new login.
result: [pending]

### 5. Mobile Session Refresh Continuity

expected: On mobile, bootstrap refresh keeps the user signed in when refresh credentials are valid, and updates runtime session state without breaking note/reminder access.
result: [pending]

### 6. Legacy Session Silent Upgrade

expected: For legacy userId-only session state on web or mobile, bootstrap automatically upgrades the session through upgrade-session flow without showing an interrupting prompt.
result: [pending]

## Summary

total: 6
passed: 0
issues: 0
pending: 6
skipped: 0
blocked: 0

## Gaps

[none yet]
