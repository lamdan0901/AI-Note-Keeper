# Implementation Checklist: Mobile Hold-to-Talk AI Note Capture (Android v1)

Plan link: [002-mobile-hold-to-talk-ai-note-capture.md](./002-mobile-hold-to-talk-ai-note-capture.md)

## Sequence Rules

- [ ] Execute phases in order. Do not start a later phase until the previous phase gate is complete.
- [ ] Keep all persistence through the existing note save/reminder pipeline.
- [ ] Keep Android-only behavior for v1 at every integration point.

## Phase 1: Foundation and Feature Gating (Must Complete First)

### apps/mobile/package.json

- [x] Add Android speech recognition dependency compatible with Expo SDK 50.
- [x] Update lockfile by installing dependencies.
- [x] Verify no conflicting native voice packages are introduced.
- [x] Verify the speech dependency works in Expo Custom Dev Client (not Expo Go).

### apps/mobile/app.json

- [x] Add Android microphone permission rationale text for voice capture.
- [x] Confirm Android-only permission changes for v1.

### apps/mobile/.env.example

- [x] Add EXPO_PUBLIC_MOBILE_VOICE_CAPTURE_V1 flag.
- [x] Add EXPO_PUBLIC_MOBILE_VOICE_CLARIFICATION_V1 flag.

### apps/mobile/src/constants/featureFlags.ts

- [x] Add isMobileVoiceCaptureV1Enabled().
- [x] Add isMobileVoiceClarificationV1Enabled().
- [x] Keep default behavior off unless explicit env flag enables rollout.

### convex/.env.example

- [x] Add AI provider env placeholders (no secrets committed).
- [x] Document required keys for parse and clarification actions.
- [x] Document zero-retention provider setting for transcript processing.

Phase 1 gate:

- [x] App builds with new dependencies and flags while voice flow remains disabled by default.
- [x] Android dev-build workflow for speech testing is documented and reproducible.

## Phase 2: Backend Contract and AI Parsing

### convex/functions/aiSchemas.ts

- [ ] Define strict schema for parse request and response.
- [ ] Define clarification response schema and confidence shape.
- [ ] Reuse shared RepeatRule-compatible validation structure.

### convex/functions/aiPrompts.ts

- [ ] Define system prompt template for transcript-to-draft extraction.
- [ ] Define clarification prompt template for ambiguity resolution.
- [ ] Include timezone and current time grounding rules in prompts.

### convex/functions/aiNoteCapture.ts

- [ ] Implement parseVoiceNoteIntent action.
- [ ] Implement continueVoiceClarification action.
- [ ] Enforce validation: future reminder time, repeat compatibility, non-empty fallback behavior.
- [ ] Return deterministic response schema used by mobile mapper.

### convex/functions/aiUsage.ts (optional)

- [ ] Add request counters and rate-limit helper for parse endpoints.
- [ ] Add telemetry logging fields for parse success, clarification, and failures.

### convex/schema.ts (if usage tracking enabled)

- [ ] Add usage table(s) for per-user throttling and audit counters.
- [ ] Add indexes required for quota checks.

Phase 2 gate:

- [ ] parseVoiceNoteIntent and continueVoiceClarification return validated draft responses in local testing.

## Phase 3: Mobile Voice Domain Layer (No Screen Integration Yet)

### apps/mobile/src/voice/types.ts

- [ ] Define voice session states: Idle, Listening, Processing, Clarifying, Review, Error.
- [ ] Define parse request/response DTOs and clarification payload types.
- [ ] Define draft model used to prefill note editor fields.

### apps/mobile/src/voice/androidSpeechRecognizer.ts

- [ ] Implement Android speech permission checks and request flow.
- [ ] Implement start, partial transcript updates, final transcript return, stop, and cancel.
- [ ] Normalize recognizer errors into user-facing categories.

### apps/mobile/src/voice/aiIntentClient.ts

- [ ] Implement parseVoiceNoteIntent API call to Convex action.
- [ ] Implement continueVoiceClarification API call.
- [ ] Add timeout and retry policy with safe fallback.

### apps/mobile/src/voice/intentDraftMapper.ts

- [ ] Map AI draft output into editor-compatible fields (title, content, reminder Date, repeat).
- [ ] Apply transcript retention policy when content extraction confidence is low.
- [ ] Validate and sanitize reminder/repeat values before opening review.

### apps/mobile/src/voice/useVoiceCaptureSession.ts

- [ ] Implement state machine for hold start, transcript updates, release, parse call, clarification loop.
- [ ] Enforce max clarification turns (2) and fallback to review with warning.
- [ ] Expose callbacks for open review and error handling.

Phase 3 gate:

- [ ] Voice domain layer works in isolation with mocked UI and mocked backend responses.

## Phase 4: Voice UI Components

### apps/mobile/src/voice/ui/VoiceCaptureOverlay.tsx

- [ ] Build listening UI with transcript preview and processing state.
- [ ] Show clear controls for cancel and retry.
- [ ] Add accessibility labels for recording and processing states.
- [ ] Add shimmer loading treatment during parse and clarification requests.

### apps/mobile/src/voice/ui/VoiceClarificationSheet.tsx

- [ ] Show clarification question and response input options.
- [ ] Support voice response path and typed fallback response.
- [ ] Display turn count and unresolved-warning state.

### apps/mobile/src/components/HoldToTalkFab.tsx

- [ ] Implement FAB wrapper that preserves existing tap behavior for manual editor open.
- [ ] Add hold threshold handling to enter voice flow only after long press.
- [ ] Add Android-only behavior gate so non-Android keeps manual flow only.
- [ ] Trigger haptic feedback on key transitions (listen start, listen stop, clarification prompt).

Phase 4 gate:

- [ ] Voice overlays and hold FAB render and behave correctly in component-level testing.

## Phase 5: Screen and Editor Integration

### apps/mobile/src/hooks/useNoteEditor.ts

- [ ] Add helper to open editor from AI draft payload.
- [ ] Ensure reminder and repeat are set consistently with existing editor state behavior.
- [ ] Preserve current openEditor(note?) behavior for manual and existing flows.

### apps/mobile/src/components/NoteEditorModal.tsx

- [ ] Add prefill entrypoint for AI draft review mode.
- [ ] Surface transcript fallback content without blocking edits.
- [ ] Keep existing save and delete behavior unchanged.

### apps/mobile/src/screens/NotesScreen.tsx

- [ ] Replace direct FAB Pressable usage with HoldToTalkFab.
- [ ] Keep tap-to-open-editor behavior unchanged.
- [ ] Wire voice session lifecycle to overlay, clarification, and review-open handlers.
- [ ] Gate entry with isMobileVoiceCaptureV1Enabled() and Android platform check.

Phase 5 gate:

- [ ] End-to-end user flow works: hold -> transcript -> parse -> clarification (if needed) -> review -> save.

## Phase 6: Automated Tests (Strict Order)

### apps/mobile/tests/unit/intentMapper.test.ts

- [ ] Validate draft mapping for title/content/reminder/repeat.
- [ ] Validate transcript retention when low confidence or empty content.
- [ ] Validate invalid reminder/repeat fallback behavior.

### apps/mobile/tests/unit/voiceCaptureMachine.test.ts

- [ ] Cover tap path vs hold path and cancellation.
- [ ] Cover processing, clarification loop, and max-turn fallback.
- [ ] Cover error transitions (permission denied, recognizer failure, API timeout).

### tests/mobile/noteCardInteractions.test.ts

- [ ] Add regression case to ensure existing hold interaction utility behavior is unchanged.

### apps/mobile/tests/integration/voiceCaptureToSave.test.ts

- [ ] Cover transcript -> parse -> clarification -> review -> save flow.
- [ ] Verify saved note goes through existing offline outbox and reminder scheduling path.

Phase 6 gate:

- [ ] Unit and integration suites pass with no regressions in existing tap and note-save behavior.

## Phase 7: Rollout and Verification

### apps/mobile/src/constants/featureFlags.ts + runtime checks

- [ ] Verify feature remains disabled by default.
- [ ] Verify Android internal rollout can be enabled without affecting iOS/manual flow.

### Manual QA Checklist (Android)

- [ ] Ambiguous time prompt: "remind me at 7" requires clarification.
- [ ] Repeat extraction: "every Monday at 9" maps to weekly repeat.
- [ ] Low confidence speech keeps transcript in content.
- [ ] Permission denied path offers recoverable UX.
- [ ] Tap FAB behavior still opens manual editor immediately.
- [ ] Parse and clarification loading states show shimmer treatment.
- [ ] Transcript handling confirms provider zero-retention mode and no transcript body in info-level logs.

Phase 7 gate:

- [ ] Internal Android rollout quality is acceptable for broader release.

## Final Completion Gate

- [ ] All phase gates are complete in sequence.
- [ ] Existing note save/reminder behavior shows no regressions.
- [ ] Feature remains Android-only and review-first per plan decisions.
