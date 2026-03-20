# Plan: Subscription Tracking & Reminder Feature (Web Only)

## Summary

Add a dedicated Subscriptions screen to the web app that lets users track third-party service subscriptions (Netflix, Spotify, custom, etc.) with billing reminders. New Convex `subscriptions` table; nav tab switcher in App.tsx; reminders fire both as in-app banners AND through the existing Convex push pipeline.

---

## Decisions

- Web only; mobile deferred
- Storage: new Convex `subscriptions` table (not reusing notes table)
- Reminders: in-app banner + Convex cron → push notifications via existing push.ts pipeline
- Reminder timing: [1, 3, 7] days before, configurable per subscription
- Navigation: simple top-level tab switcher (no React Router added)
- Preset catalog (static list in `servicePresets.ts`) + free-form custom entry
- Fields: name, price, billingCycle, nextBillingDate, category, notes, trialEndDate, status
- Total summary: monthly-equivalent cost for active subscriptions shown in header
- Auto-advance nextBillingDate via Convex cron after billing date passes
- userId hardcoded to 'local-user' (same as notes)

---

## Phase 1 — Convex Backend

### Step 1: Schema — `convex/schema.ts`

Add `subscriptions` table:

```
id, userId, serviceName, category, price, currency, billingCycle,
billingCycleCustomDays?, nextBillingDate, notes?, trialEndDate?,
status ('active'|'cancelled'|'paused'), reminderDaysBefore (number[]),
nextReminderAt?, lastNotifiedBillingDate?, active (soft delete), createdAt, updatedAt
```

### Step 2: Convex functions — `convex/functions/subscriptions.ts`

Queries:

- `listSubscriptions(userId)` — all active subscriptions for user
- `getSubscription(id)` — single record

Mutations:

- `createSubscription(args)` — create + compute nextReminderAt
- `updateSubscription(id, patch)` — update + recompute nextReminderAt
- `deleteSubscription(id)` — soft delete (active: false)

Internal helpers:

- `computeNextReminderAt(nextBillingDate, reminderDaysBefore[])` — returns earliest future reminder timestamp
- `advanceBillingDate(nextBillingDate, billingCycle, customDays?)` — adds 1 period

### Step 3: Cron — `convex/crons.ts`

Add `check-subscription-reminders` cron (every hour, same as existing reminder cron):

- Query subscriptions where `nextReminderAt <= now`
- For each: call `push.ts` pipeline to send notification
- Recompute `nextReminderAt` (next reminder in the array, or next billing cycle's reminder)
- Auto-advance `nextBillingDate` when `nextBillingDate <= now` (after billing date passes)

---

## Phase 2 — Shared Types

### Step 4: `packages/shared/types/subscription.ts`

Define `Subscription`, `SubscriptionCreate`, `SubscriptionUpdate` types.
Define `BillingCycle`, `SubscriptionCategory`, `SubscriptionStatus` enums.

---

## Phase 3 — Web Service Layer

### Step 5: `apps/web/src/services/subscriptions.ts`

Hooks mirroring `services/notes.ts` pattern:

- `useSubscriptions()` — `useQuery(api.functions.subscriptions.listSubscriptions, { userId })`
- `useCreateSubscription()`, `useUpdateSubscription()`, `useDeleteSubscription()` — useMutation wrappers
- `mapDocToWebSubscription()` converter

### Step 6: `apps/web/src/services/subscriptionUtils.ts`

Pure utilities:

- `computeMonthlyCost(price, billingCycle)` — normalizes to monthly
- `computeTotalMonthlyCost(subscriptions[])` — sums active only
- `getDaysUntilBilling(nextBillingDate)` — days remaining
- `isReminderDue(subscription)` — checks if billing is within reminderDaysBefore window
- `formatBillingCycle(billingCycle)` — display string

### Step 7: `apps/web/src/constants/servicePresets.ts`

Static array of ~20 preset services:
`{ name, category, defaultColor }` — e.g. Netflix/streaming, Spotify/music, GitHub/tools, etc.

---

## Phase 4 — Web UI

### Step 8: `apps/web/src/pages/SubscriptionsPage.tsx`

Main page component:

- Fetches subscriptions via `useSubscriptions()`
- Local state: searchQuery, editorOpen, editingSubscription, viewMode (grid/list)
- Renders: `<SubscriptionReminderBanner>`, `<SubscriptionsHeader>`, `<SubscriptionsList>`
- Passes CRUD handlers down

### Step 9: `apps/web/src/components/subscriptions/SubscriptionCard.tsx`

Card showing:

- Service name + category badge + status indicator
- Price + billing cycle
- "Next billing: X days" countdown (color: green/yellow/red)
- Trial end badge (if applicable)
- Edit / Delete action buttons
- CSS styling reusing existing card patterns

### Step 10: `apps/web/src/components/subscriptions/SubscriptionEditorModal.tsx`

Create/edit modal:

- Service name input with preset autocomplete dropdown (servicePresets.ts)
- Category select
- Price + billing cycle select
- Next billing date input (date picker)
- Status select (active/cancelled/paused)
- Trial end date input (optional)
- Reminder settings: checkboxes for [1, 3, 7] days
- Notes textarea
- Save / Cancel buttons
- Reuses modal overlay pattern from NoteEditorModal

### Step 11: `apps/web/src/components/subscriptions/SubscriptionReminderBanner.tsx`

Top-of-page alert banner:

- Computes which subscriptions have upcoming billing (within reminderDaysBefore window)
- Shows dismissible banner per subscription or grouped summary
- Uses `isReminderDue()` from subscriptionUtils

### Step 12: Update `apps/web/src/App.tsx`

- Add `activeTab: 'notes' | 'subscriptions'` state
- Render `<NavTabs>` at top (two buttons: Notes | Subscriptions)
- Conditionally render `<NotesPage>` or `<SubscriptionsPage>`

---

## Relevant Files

- `apps/web/src/App.tsx` — add tab state + NavTabs
- `apps/web/src/pages/NotesPage.tsx` — reference for page structure pattern
- `apps/web/src/services/notes.ts` — reference for Convex hook pattern
- `apps/web/src/services/reminderUtils.ts` — reference for utility pattern
- `apps/web/src/components/NoteEditorModal.tsx` — reference for modal pattern
- `apps/web/src/components/NoteCard.tsx` — reference for card pattern
- `convex/schema.ts` — add subscriptions table
- `convex/crons.ts` — add subscription reminder cron
- `convex/functions/reminders.ts` — reference for Convex function patterns
- `convex/_generated/` — regenerated after schema changes (automatic)
- `packages/shared/types/note.ts` — reference for type structure

---

## Verification

1. Run `npx convex dev` — verify schema deploys without errors
2. Create a subscription via the editor modal → confirm it appears in the list
3. Set nextBillingDate = today+2 days → confirm ReminderBanner shows it
4. Set nextBillingDate = past → confirm cron advances it on next tick (test via Convex dashboard)
5. Run `npm test` in root → existing tests still pass
6. Run `npm run lint` in `apps/web/` → no new TS errors

---

## Excluded Scope

- Mobile (deferred)
- Currency conversion (price stored as-is, user selects currency label)
- Import/export (CSV, etc.)
- Shared subscriptions between users
- Webhook integrations to detect actual billing events
