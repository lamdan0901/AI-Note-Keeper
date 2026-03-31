# Plan: Mobile Hold-to-Talk AI Note Capture (Android v1)

## Status

Draft

## Date

2026-03-31

## Goal

Enable users to hold the Add Note button, speak naturally, and have AI prepare a structured note (title, content, reminder time, repeat rule), then always open a review step before final save.

## Locked Decisions

1. Review is always required before saving.
2. No auto-save confidence threshold is needed because save is always user-confirmed.
3. v1 is Android-only.
4. v1 includes follow-up clarification turns.
5. If title/content extraction confidence is low, keep raw transcript in note content.

## Why This Fits Current Codebase

- Existing Add Note entrypoint is the FAB press in apps/mobile/src/screens/NotesScreen.tsx.
- Existing save pipeline already handles offline-first write, outbox enqueue, sync, and reminder scheduling.
- Existing recurrence codec already maps canonical repeat and legacy fields.
- Existing reminder UI and note editor can be reused for review and final edits.
- Existing feature flag pattern supports safe rollout.

## Scope

### In Scope (v1)

- Android hold-to-talk UX from FAB.
- On-device speech recognition to transcript.
- AI parsing of transcript to structured draft.
- Follow-up clarification turns when AI needs missing details.
- Always-open review modal before save.
- Haptic feedback for key voice interaction transitions.
- Shimmer loading state while parse and clarification requests are in flight.
- Reuse existing note save and reminder scheduling pipeline.

### Out of Scope (v1)

- iOS implementation.
- Fully automatic save without review.
- Uploading raw audio to backend.
- Long-form chat memory outside one capture session.

## User Experience Flow

1. User taps FAB:
   - Current behavior remains unchanged (manual editor opens).
2. User holds FAB longer than hold threshold:
   - Enter Listening state.
   - Show Android microphone/listening overlay and live transcript.
3. User releases:
   - Stop speech recognition.
   - Enter Processing state.
4. App calls AI intent parser with transcript and local time context.
5. If parser needs missing detail:
   - Show clarification prompt (for example: "Do you mean 7 AM or 7 PM?").
   - User answers by voice (preferred) or quick text/chip reply.
   - Parser updates draft.
6. App opens review modal prefilled with extracted fields.
7. User edits and taps Save.
8. Save uses existing useNoteActions + saveNoteOffline path.

## Architecture

### Mobile Components

New modules:

- apps/mobile/src/voice/types.ts
- apps/mobile/src/voice/useVoiceCaptureSession.ts
- apps/mobile/src/voice/androidSpeechRecognizer.ts
- apps/mobile/src/voice/aiIntentClient.ts
- apps/mobile/src/voice/intentDraftMapper.ts
- apps/mobile/src/voice/ui/VoiceCaptureOverlay.tsx
- apps/mobile/src/voice/ui/VoiceClarificationSheet.tsx
- apps/mobile/src/components/HoldToTalkFab.tsx

Modified modules:

- apps/mobile/src/screens/NotesScreen.tsx
- apps/mobile/src/components/NoteEditorModal.tsx
- apps/mobile/src/hooks/useNoteEditor.ts
- apps/mobile/src/constants/featureFlags.ts
- apps/mobile/package.json
- apps/mobile/app.json (Android microphone permission text)

### Backend Components (Convex)

New modules:

- convex/functions/aiNoteCapture.ts
- convex/functions/aiSchemas.ts
- convex/functions/aiPrompts.ts

Optional telemetry/rate-limit module:

- convex/functions/aiUsage.ts

## API Contracts

### Mutation/Action: parseVoiceNoteIntent

Request:

- transcript: string
- userId: string
- timezone: string
- nowEpochMs: number
- locale: string | null
- sessionId: string

Response:

- draft:
  - title: string | null
  - content: string | null
  - reminderAtEpochMs: number | null
  - repeat: RepeatRule | null
  - keepTranscriptInContent: boolean
  - normalizedTranscript: string
- confidence:
  - title: number
  - content: number
  - reminder: number
  - repeat: number
- clarification:
  - required: boolean
  - question: string | null
  - missingFields: string[]

Validation rules:

- reminderAtEpochMs must be in the future.
- repeat must conform to shared RepeatRule.
- If reminderAtEpochMs is null, repeat must be null.
- If both title and content are empty after parse, fallback content uses transcript.

### Mutation/Action: continueVoiceClarification

Request:

- sessionId: string
- priorDraft: object
- clarificationAnswer: string
- timezone: string
- nowEpochMs: number

Response:

- same shape as parseVoiceNoteIntent response

## Follow-up Clarification Design (v1)

Clarification triggers:

- Ambiguous time expressions (for example: "at 7").
- Missing date context (for example: "next week" without day).
- Repeat intent present but incomplete (for example: "every week" with no weekday when needed).

Loop behavior:

1. Parse result with clarification.required = true.
2. Show single question.
3. Capture user answer by voice or text.
4. Call continueVoiceClarification.
5. Repeat until clarification.required = false or max turns reached.

Guardrails:

- Max clarification turns: 2.
- If still unresolved, open review with warning and transcript preserved.

## Data Mapping Rules

Draft to editor/save mapping:

- title -> editor title.
- content -> editor content.
- reminderAtEpochMs -> Date for reminder UI.
- repeat -> RepeatRule passed to existing recurrence codec.
- keepTranscriptInContent:
  - true: append transcript block when extracted content confidence is low.
  - false: use extracted content only.

Low-confidence transcript retention policy:

- If confidence.content < 0.6 OR parsed content is empty, set keepTranscriptInContent = true.
- Transcript block format at end of content:
  - "\n\nTranscript:\n<raw transcript>"

## Feature Flags

Add flags in apps/mobile/src/constants/featureFlags.ts:

- isMobileVoiceCaptureV1Enabled()
- isMobileVoiceClarificationV1Enabled()

Rollout plan:

1. Internal Android testers only.
2. Small production cohort.
3. Full Android rollout after stability metrics pass.

## Android-only v1 Notes

- Guard all voice entrypoints with Platform.OS === 'android'.
- On non-Android, FAB behavior remains manual editor only.
- Avoid exposing unavailable UI affordances on iOS for now.

## Platform and Build Requirements

- Voice capture implementation in v1 assumes an Expo Custom Dev Client (native module path), not Expo Go.
- The team should maintain a reproducible Android dev-build path for speech testing.

## Implementation Phases

### Phase 1: Hold-to-talk foundation (Android)

Tasks:

- Add Android speech dependency and permission flow.
- Set up and validate Expo Custom Dev Client for speech module integration.
- Build HoldToTalkFab with tap vs hold behavior.
- Add Listening/Processing overlays.
- Add haptic feedback for hold-start, listen-stop, and clarification prompts.

Exit criteria:

- Tap opens editor exactly as today.
- Hold captures transcript and release ends session reliably.

### Phase 2: AI parse backend and client wiring

Tasks:

- Add Convex AI parse action with strict output validation.
- Add mobile aiIntentClient.
- Map parse output to note draft fields.
- Configure AI provider calls with transcript zero-retention mode where supported.

Exit criteria:

- Transcript consistently produces valid draft object.
- Invalid AI output is safely rejected with user-facing fallback.

### Phase 3: Clarification turns + review-first flow

Tasks:

- Implement clarification loop (max 2 turns).
- Always open review UI with prefilled values.
- Ensure transcript retention on low-confidence extraction.
- Add shimmering loading states during parse and clarification round-trips.

Exit criteria:

- Clarification resolves common ambiguity cases.
- Save is always user-confirmed from review.

### Phase 4: Hardening and rollout

Tasks:

- Telemetry and error categorization.
- Retry and fallback UX.
- Controlled flag rollout.

Exit criteria:

- Crash-free and parse-failure metrics acceptable.
- Reminder extraction quality meets target.

## Testing Plan

### Unit Tests

- Hold-to-talk state machine transitions.
- Tap vs hold regression behavior.
- Intent mapping and confidence fallback logic.
- Clarification turn reducer and max-turn guard.

### Integration Tests

- Transcript -> parse -> clarification -> review pipeline.
- Review -> save -> outbox -> reminder scheduling integration.
- Network/API failure fallback to manual review path.
- Android permission denied/granted flows.

### Manual QA Scenarios

- "Remind me to call mom tomorrow at 7"
- "Pay rent every month on the 1st"
- "Doctor appointment next Friday"
- Ambiguous: "Remind me at 7" (must ask AM/PM)
- Low-confidence noisy transcript (must preserve transcript in content)

## Observability

Track:

- voice_session_start
- voice_session_cancel
- voice_transcript_length
- ai_parse_success
- ai_parse_failure
- ai_clarification_required
- ai_clarification_turn_count
- review_save_success
- review_save_cancel
- transcript_fallback_used

## Risks and Mitigations

1. STT quality variance across devices.
   - Mitigation: always-review flow + clarification turns + transcript retention fallback.
2. Time parsing mistakes.
   - Mitigation: timezone-aware parsing, future-time validation, explicit clarification questions.
3. Latency frustration.
   - Mitigation: immediate visual feedback, bounded timeouts, retry with clear errors.
4. Abuse/cost growth.
   - Mitigation: server-side rate limiting and transcript length limits.
5. Transcript privacy leakage.
   - Mitigation: zero-retention AI provider mode, redact transcript content in logs, and keep raw audio local.

## Definition of Done

1. Android user can hold FAB, speak, and receive a prefilled review draft.
2. Follow-up clarification works for ambiguous inputs.
3. Save is always manual from review step.
4. Existing save/sync/reminder pipeline remains the only persistence path.
5. Low-confidence extraction preserves transcript in note content.
6. Feature ships behind flags and passes regression tests for existing FAB tap behavior.
