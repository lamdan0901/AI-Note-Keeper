# Google Keep-like Repeat Reminder System — Implementation Tasks

> [!NOTE]
> This task breakdown is based on the spec at [Google Keep–like repeat reminder system.md](file:///c:/prj/ai-note-keeper/Google%20Keep%E2%80%93like%20repeat%20reminder%20system.md) and gap analysis of the current codebase.

## Current State Summary

The codebase has foundational reminder infrastructure:

- **Convex**: Schema with basic reminder fields, CRUD mutations, cron-based triggers
- **Mobile**: `ReminderModule.kt` (AlarmManager), `ReminderReceiver.kt`, `scheduler.ts`
- **Shared**: Basic types (`Reminder`, `ReminderRepeatRule`)

## Gap Analysis vs Spec

| Spec Requirement                                | Current State                     | Gap               |
| ----------------------------------------------- | --------------------------------- | ----------------- |
| Shared `recurrence.ts` library                  | ❌ None                           | **Critical**      |
| Structured `RepeatRule` type                    | ❌ String-based (`'daily'`, etc.) | Need rich type    |
| Fields: `startAt`, `baseAtLocal`, `lastFiredAt` | ❌ Missing                        | Schema update     |
| `ackReminder()` mutation                        | ❌ Missing                        | New mutation      |
| `snoozeReminder()` mutation                     | ❌ Missing                        | New mutation      |
| Done/Snooze notification actions                | ❌ Missing                        | Native + RN work  |
| BootReceiver for rescheduling                   | ❌ Missing                        | Kotlin work       |
| FCM `REMINDER_CHANGED` handler                  | ⚠️ Partial (push exists)          | Needs enhancement |

---

## Task Breakdown

### Phase 1: Shared Recurrence Logic (Foundation)

- [ ] **1.1** Create `packages/shared/lib/recurrence.ts` with:
  - [ ] `RepeatRule` type definition (DAILY, WEEKLY, MONTHLY with intervals)
  - [ ] `computeNextTrigger(now, startAt, baseAtLocal, repeat)` function
  - [ ] Handle edge cases: Monthly day overflow, weekly weekday selection
- [ ] **1.2** Write comprehensive unit tests for recurrence logic
  - [ ] Daily interval tests
  - [ ] Weekly with weekdays tests
  - [ ] Monthly "same day each month" with day clamping tests
  - [ ] Non-repeating reminder tests

### Phase 2: Data Model Updates

- [ ] **2.1** Update Convex schema (`convex/schema.ts`):
  - [ ] Add `startAt: v.optional(v.number())`
  - [ ] Add `baseAtLocal: v.optional(v.string())`
  - [ ] Add `lastFiredAt: v.optional(v.number())`
  - [ ] Add `lastAcknowledgedAt: v.optional(v.number())`
  - [ ] Add `version: v.optional(v.number())` for OCC
- [ ] **2.2** Update shared types (`packages/shared/types/reminder.ts`):
  - [ ] Add new `RepeatRule` discriminated union type
  - [ ] Add new fields to `Reminder` interface
- [ ] **2.3** Update local SQLite migrations for mobile

### Phase 3: Convex API Enhancements

- [ ] **3.1** Create `ackReminder()` mutation:
  - [ ] Accept `ackType`, optional `optimisticNextTrigger`
  - [ ] Clear `snoozedUntil` on Done
  - [ ] Run shared recurrence logic to compute next trigger
  - [ ] Bump version, emit change event
- [ ] **3.2** Create `snoozeReminder()` mutation:
  - [ ] Accept `snoozedUntilLocal` timestamp
  - [ ] Update `snoozedUntil` and `nextTriggerAt`
  - [ ] Emit change event
- [ ] **3.3** Update existing mutations to use shared recurrence logic

### Phase 4: Android Native Enhancements

- [ ] **4.1** Add notification action buttons:
  - [ ] "Done" action in `ReminderReceiver.kt`
  - [ ] "Snooze until…" action
- [ ] **4.2** Create `ActionReceiver.kt` for handling notification actions:
  - [ ] Handle "Done" tap → trigger Headless JS
  - [ ] Handle "Snooze" tap → open picker activity
- [ ] **4.3** Create `BootReceiver.kt`:
  - [ ] Listen for `BOOT_COMPLETED`
  - [ ] Trigger alarm reschedule from local storage
- [ ] **4.4** Update `AndroidManifest.xml` with new receivers

### Phase 5: React Native Integration

- [ ] **5.1** Implement Headless JS task for "Done" handling:
  - [ ] Load reminder from local storage
  - [ ] Run shared recurrence logic
  - [ ] Schedule next alarm via native module
  - [ ] Sync with Convex `ackReminder()`
- [ ] **5.2** Implement alarm rescheduling on app start/wake:
  - [ ] Fetch latest from Convex
  - [ ] Update local storage
  - [ ] Reschedule if changed
- [ ] **5.3** Create Snooze picker UI component

### Phase 6: UI Updates

- [ ] **6.1** Enhance reminder setup screen:
  - [ ] Add repeat interval selection UI
  - [ ] Add weekday picker for weekly repeats
  - [ ] Monthly "same day" option
- [ ] **6.2** Update reminder status display to show repeat info

### Phase 7: FCM & Sync

- [ ] **7.1** Handle `REMINDER_CHANGED` FCM message:
  - [ ] Fetch latest reminder from Convex
  - [ ] Update local storage
  - [ ] Reschedule/cancel alarm accordingly
- [ ] **7.2** Add offline resilience testing

---

## Verification Plan

### Automated Tests

- [ ] Unit tests for `recurrence.ts` (all repeat rule types, edge cases)
- [ ] Contract tests for new Convex mutations
- [ ] Integration tests for alarm scheduling

### Manual Tests

- [ ] Create repeating reminder → verify notification fires repeatedly
- [ ] Test "Done" on repeating reminder → verify next occurrence scheduled
- [ ] Test Snooze → verify fires at snooze time, then resumes series
- [ ] Reboot device → verify alarms are rescheduled
- [ ] Offline Done → verify alarm scheduled locally, synced when online
