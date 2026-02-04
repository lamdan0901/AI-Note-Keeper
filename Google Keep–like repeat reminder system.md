# Repeat Reminder Spec — RN Android + Convex + FCM

Below is an implementation-ready **spec** for a Google Keep–like repeat reminder system (Android-only) using **React Native + Convex + FCM**, with **exact-ish local delivery** via AlarmManager and “Snooze until…” one-off overrides. This matches my choices: time-based only, daily/weekly/monthly + custom intervals, same-day-each-month, works when app is killed/rebooted, single-device for now, ~1-minute accuracy acceptable, no auth yet.

## 0) Product scope

### Supported (v1)

- Android only
- One reminder per note
- **Offline Reliability:** "Done" actions on repeating reminders work without internet (optimistic scheduling).
- Time-based reminders with repeats:
  - Daily
  - Weekly (select weekdays)
  - Monthly (Same day each month, e.g., 15th)
  - Custom Intervals (Every N days/weeks/months)
- Snooze: **Snooze until…** (one-off local datetime override)
- **Exact-ish Delivery:**
  - Works when app is killed/rebooted.
  - Notification appears immediately (no network fetch required at fire time).
- Single device (multi-device ready via FCM)

### Not in v1

- Location-based reminders
- Yearly repeats
- Shared notes / multi-user delivery

---

## 1) Keep-like behavior rules

### 1.1 Reminder fields (user-facing)

A reminder is defined by:

- Base date + time (local wall-clock time)
- Repeat rule (optional)
- Snooze-until (optional)

### 1.2 Fire behavior

When `nextTriggerAt` occurs:

- **Immediate:** Notification shows title/body immediately (data embedded in alarm).
- Actions:
  - **Done**
  - **Snooze until…**
  - Tap opens the note

### 1.3 Done

- Non-repeating: remove/disable reminder.
- Repeating:
  1. Clear snooze (if any).
  2. **Optimistically** compute next occurrence locally (so alarm is set even if offline).
  3. Sync to server.

### 1.4 Snooze until…

- Sets `snoozedUntil` override.
- Fires at `snoozedUntil` regardless of series schedule.
- "Done" on a snooze computes next repeating occurrence based on the _original_ schedule (not the snooze time).

### 1.5 Monthly “same day each month”

- If target day doesn’t exist (e.g., 31st in April) → Fire on **last day of month**.

### 1.6 Timezone Behavior (Floating vs. Absolute)

- **v1 Decision:** **Floating Time** (Keep-like).
- If I set "9:00 AM", it means "9:00 AM on my current clock," regardless of where I am.
- _Note:_ The `timezone` field in DB is stored for reference/conversions, but calculations use local device time.

---

## 2) Architecture (Hybrid Source of Truth)

### 2.1 Logic: Shared Recurrence Library

To solve the "Offline" problem, the recurrence math (calculating `nextTriggerAt`) is **shared code** (a pure JS/TS utility).

- **Client:** Uses it to schedule the _next_ alarm immediately after "Done" is tapped.
- **Server (Convex):** Uses it to validate and persist the canonical state.

### 2.2 Delivery: Native-First AlarmManager

- **Bundle Data:** The `PendingIntent` must contain the Note Title and Note ID. Do **not** fetch data when the alarm fires.
- **Reliability:** Use `setAndAllowWhileIdle` (approximate, battery friendly) or `setExactAndAllowWhileIdle` (if permission granted).

### 2.3 FCM role (Sync only)

- FCM is **not** used to trigger the alarm.
- FCM sends `REMINDER_CHANGED` to tell the device: "Recalculate and reset your local alarm" (e.g., if edited on another device).

---

## 3) Data model (Convex)

### 3.1 notes

```ts
{
  _id: Id<"notes">,
  title: string,
  content: string,
  updatedAt: number,
}

```

### 3.2 reminders (1 per note)

```ts
{
  _id: Id<"reminders">,
  noteId: Id<"notes">,

  enabled: boolean,

  timezone: string,         // e.g. "Asia/Ho_Chi_Minh" (Reference)
  baseAtLocal: string,      // ISO string "2026-02-01T09:00"
  startAt: number,          // Epoch ms of first intended occurrence (ANCHOR)

  repeat: null | RepeatRule,

  snoozedUntil?: number,    // Epoch ms override
  nextTriggerAt?: number,   // Canonical next fire time

  lastFiredAt?: number,
  lastAcknowledgedAt?: number,

  version: number,          // Optimistic concurrency control
}

```

### 3.3 RepeatRule

```ts
type RepeatRule =
  | { kind: 'DAILY'; interval: number }
  | { kind: 'WEEKLY'; interval: number; weekdays: number[] } // 0=Sun
  | { kind: 'MONTHLY'; interval: number; mode: 'DAY_OF_MONTH' };
```

---

## 4) Shared Recurrence Logic (Crucial)

This logic must exist in a shared file (e.g., `src/lib/recurrence.ts`) used by both React Native and Convex.

### 4.1 Inputs

- `now`: Current epoch
- `startAt`: The **Anchor Date**. (Calculations for "Every 2 weeks" are relative to this date).
- `baseAtLocal`: For extracting hour/minute/day-of-month.
- `repeat`: RepeatRule.

### 4.2 Algorithm Rules

1. **Non-repeating:** If `startAt > now`, return `startAt`. Else null.
2. **Repeating:** Find earliest occurrence strictly `> now`.

- **Daily (Interval N):** `startAt + (N * days)`.
- **Weekly (Interval N):**
- Determine the "Week Block" based on `startAt`.
- `weeks_diff = (current_week - start_week) % N`.
- Must match `weekdays` array.

- **Monthly (Interval N):**
- Target day = Day of month from `baseAtLocal`.
- If month doesn't have that day, clamp to `lastDayOfMonth`.

---

## 5) Convex API

### 5.1 Mutations

#### `setReminder(noteId, input)`

- Server calculates `startAt` and `nextTriggerAt` using Shared Logic.
- Bumps `version`.

#### `ackReminder(noteId, ackType, optimisticNextTrigger?)`

- `ackType = "DONE"`
- **Input:** Accepts an optional `optimisticNextTrigger` from client.
- **Server Logic:**
- Clear `snoozedUntil`.
- Re-run Shared Logic to verify `optimisticNextTrigger`.
- Update `nextTriggerAt`.
- Bump `version`.

#### `snoozeReminder(noteId, snoozedUntilLocal)`

- Updates `snoozedUntil`.
- Sets `nextTriggerAt = snoozedUntil`.

---

## 6) Android Client Implementation (React Native)

### 6.1 Modules

- `@react-native-firebase/messaging`
- `@notifee/react-native`
- **Native Module:** `AlarmScheduler` (Kotlin).

### 6.2 Scheduling Alarms (The "Bundle" Strategy)

When scheduling an alarm in Kotlin:

1. Create `Intent` for `AlarmReceiver`.
2. **Put Extras:**

- `NOTE_ID`: string
- `NOTE_TITLE`: string
- `NOTE_BODY`: string (truncated)
- `SNOOZE_ID`: int (random request code)

3. Set alarm using `AlarmManager`.

- _Android 12+ Warning:_ If using `setExact`, you need `SCHEDULE_EXACT_ALARM` permission. Fail gracefully to `setAndAllowWhileIdle` if permission denied.

### 6.3 AlarmReceiver (Native Kotlin - "Fetch-Free")

**CRITICAL:** Do not use Headless JS to fetch data here.

1. `onReceive(context, intent)` fires.
2. Extract `NOTE_TITLE` and `NOTE_BODY` from Intent extras.
3. Build Notifee Notification **immediately**.

- Add Action: "Done" (PendingIntent to BroadcastReceiver).
- Add Action: "Snooze" (PendingIntent to Activity/Headless).

4. `notificationManager.notify(...)`.

_Outcome: Notification appears instantly, 100% reliability even if app is dead._

### 6.4 Handling "Done" Action (Optimistic)

1. User taps "Done" on notification.
2. BroadcastReceiver triggers Headless JS task.
3. **Headless Task:**

- Loads reminder from Local Storage (AsyncStorage/MMKV).
- Runs **Shared Recurrence Logic** to find _new_ `nextTriggerAt`.
- Calls Native Module to **schedule next alarm**.
- Calls Convex `ackReminder` to sync state.

### 6.5 App Start / Reboot

1. **Reboot:** `BOOT_COMPLETED` receiver -> Load all active reminders from Local Storage -> Reschedule alarms.
2. **App Open:** Sync with Convex `listActiveReminders()` -> Update Local Storage -> Reschedule alarms if changed.

---

## 7) FCM Message Contracts

### 7.1 REMINDER_CHANGED

Payload: `{ type: "REMINDER_CHANGED", noteId, version }`

1. App receives background message.
2. Fetches latest reminder from Convex.
3. Updates Local Storage.
4. Reschedules/Cancels Alarm via Native Module.

---

## 8) Implementation Checklist

1. **Shared Logic:** Create `recurrence.ts` (pure JS, thoroughly tested with edge cases).
2. **Convex:** Implement `schema.ts` and mutations using `recurrence.ts`.
3. **Native Module (Kotlin):**

- `scheduleAlarm(timestamp, title, body, noteId)`
- `cancelAlarm(noteId)`
- `checkExactAlarmPermission()`

4. **Native Receivers:**

- `AlarmReceiver`: Extracts extras, shows Notification.
- `ActionReceiver`: Handles "Done" tap.
- `BootReceiver`: Reschedules from local storage.

5. **React Native UI:**

- Reminder setup screen (Repeat options).
- Snooze picker.

6. **Glue:**

- "Done" handler (Optimistic calc + Sync).
- `REMINDER_CHANGED` listener.
