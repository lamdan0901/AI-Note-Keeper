# Expense Notes — Technical Design

**Status:** Draft (decisions locked — see §13)  
**Scope:** Web app first; mobile deferred  
**Last updated:** 2026-06-06  
**Design references:** [`design 1.png`](./design%201.png), [`design 2.png`](./design%202.png), [`design 3.png`](./design%203.png)

---

## 1. Summary

Expense Notes is a new top-level tab (alongside **Notes** and **Subscriptions**) for tracking monthly expenses in a **Notion-style database table**. Users select a **month–year** from a dropdown; each month is **one table** containing expense rows. Rows mix summary entries (e.g. "Initial budgets", "prev month") and line items (e.g. "winmart", "food"). A **SUM** rolls up the Amount column at the bottom.

**Settings** (popup/drawer) let users configure default column names, visibility, order, default cell values, and **seed rows** — all applied automatically when **future months** are first opened. Currency is **VND**. On first visit, the page opens the **current calendar month**.

> **Terminology:** In Notion, each row is a "page" (`+ New page`). In this feature, a **record = one row** in the month's table; a **month = one table**.

---

## 2. Design mock breakdown

### 2.1 `design 1.png` — Main table view

| Element | Detail |
|---------|--------|
| Layout | Single full-width Notion table on dark background |
| Columns | **Expense** (text, `Aa` icon), **#** (narrow number), **Amount** (currency `$`), **Date** (calendar), **Comment** (text) |
| Header actions | `+` add column, `…` table menu (opens property visibility) |
| Rows | Document icon + expense name; amounts formatted `$16,500.00`; negatives `-$76.00`; dates `June 4, 2026` |
| Row types | Summary rows ("Initial bugets", "prev month") and line items ("winmart", "food", "net") — same row model, no special type |
| Add row | `+ New page` footer button (left-aligned) |
| Total | `SUM $38,168.00` under Amount column |

**Example data from mock:**

| Expense | Amount | Date | Comment |
|---------|--------|------|---------|
| Initial bugets | $16,500.00 | | internet -175k |
| prev month | $22,306.00 | | |
| winmart | -$76.00 | June 4, 2026 | |
| winmart | -$80.00 | June 2, 2026 | |
| sell helmet | $200.00 | | |
| p1 | -$150.00 | | |
| food | -$130.00 | | |
| net | -$175.00 | | |
| winmart | -$227.00 | | |

### 2.2 `design 2.png` — Date cell editor

| Element | Detail |
|---------|--------|
| Trigger | Click Date cell → floating calendar popup |
| Picker | Month nav (`Jun 2026`), **Today** shortcut, chevron prev/next |
| Selection | Blue circle on selected day (e.g. Jun 6) |
| Input | Editable date field at top (`Jun 6, 2026`) |
| Options | End date toggle, Date format (`Full date`), Include time toggle, Remind (`None`), **Clear** |
| Theme | Dark panel, blue accent, rounded shadow |

**v1 scope:** Ship calendar picker + Clear + Full date format. Defer End date, Include time, and Remind to Phase 2.

### 2.3 `design 3.png` — Property visibility

| Element | Detail |
|---------|--------|
| Modal title | **Property visibility** |
| Search | `Search for a property…` |
| Section | **Shown in table** with **Hide all** link |
| Per property | Drag handle, type icon, name, eye toggle (visible/hidden) |
| Default columns | Expense, Amount, Date, Comment (all visible in mock) |

Column reorder and show/hide persist to the active month's schema and optionally to user defaults for future months.

---

## 3. Goals

| Goal | Detail |
|------|--------|
| Notion-like table | Inline grid, property icons, `+ New page`, SUM footer, property visibility modal |
| One table per month | Each month–year period = one expense sheet with rows |
| Month selector | Dropdown to switch months; default = current month |
| Default field settings | Column names, order, visibility, and default values for **future** months |
| Amount rollup | Auto SUM on Amount column (includes negatives) |
| Consistent with app | Express API, PostgreSQL, shared types, guest + auth users |
| Web-first | `apps/web` first; mobile later |

## 4. Non-goals (v1)

- Mobile UI
- Multiple tables per month
- AI categorization / receipt OCR
- Multi-currency conversion
- Import/export (CSV)
- Charts / budgeting dashboards
- Column formulas
- Realtime websockets (use existing poll pattern if needed)
- Date picker: end date, time, remind (Phase 2)

---

## 5. User experience

### 5.1 Navigation

Add third tab in `App.tsx`:

```
[ Notes ] [ Subscriptions ] [ Expenses ]
```

`ActiveTab` → `'notes' | 'subscriptions' | 'expenses'`.

| Control | Behavior |
|---------|----------|
| Month–year dropdown | Switch period; includes existing months **and future months** for planning; creates period on first open |
| `…` / column menu | Opens **Property visibility** modal (design 3) |
| `+` (header) | Add custom column (Phase 2; v1 uses fixed default columns) |
| Search (Phase 2) | Filter rows in active month by Expense / Comment text |
| Settings (gear) | Popup/drawer: default column names, default values, **seed rows** — all apply to newly opened future months |
| Trash (Phase 2) | Soft-delete rows |

### 5.2 Page layout

```
┌──────────────────────────────────────────────────────────────────┐
│ [June 2026 ▼]                                    [⚙ Defaults]    │
├──────────────────────────────────────────────────────────────────┤
│  Aa Expense  │  #  │  ₫ Amount       │  📅 Date    │  ≡ Comment │ + … │
├──────────────┼─────┼────────────────┼─────────────┼────────────┤
│ 📄 Initial bugets │  │  16.500 ₫      │             │ internet…  │
│ 📄 prev month     │  │  22.306 ₫      │             │            │
│ 📄 winmart        │  │  -76 ₫         │ June 4, 2026│            │
│ 📄 winmart        │  │  -80 ₫         │ June 2, 2026│            │
│ …                │  │               │             │            │
├──────────────────────────────────────────────────────────────────┤
│ + New page                                                       │
│                          SUM  38.168 ₫                           │
└──────────────────────────────────────────────────────────────────┘
```

### 5.3 Default month behavior

On tab mount:

1. Resolve `year` + `month` from local timezone.
2. `GET /periods/current` → get or create period for current month.
3. Load rows + schema for that period.
4. `localStorage` key `expense:lastPeriod` restores last viewed month on return visits; **first-ever visit** uses current month.

### 5.4 Row interactions

| Action | Behavior |
|--------|----------|
| Edit Expense / Comment | Click cell → text input; debounced save |
| Edit Amount | Click → number input; store as number; display VND via `Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })` |
| Edit Date | Click → calendar popup (design 2); Clear removes date |
| Add row | `+ New page` → new row with default cell values from schema |
| Delete row | Row `…` menu or keyboard shortcut (Phase 2) |
| Reorder rows | Drag handle (Phase 2); v1 append-only at bottom |
| SUM | Recomputed client-side on every Amount change; shown in footer |

### 5.5 Property visibility (design 3)

| Action | Behavior |
|--------|----------|
| Toggle eye | Show/hide column in current month's table |
| Drag handle | Reorder columns (updates `position` in schema) |
| Hide all | Set all columns `visible: false` except Expense (always visible) |
| Search | Filter property list in modal |

Changes save to the **active period's schema**. A checkbox **"Apply to future months"** in the modal (or Defaults settings) writes the same schema to `expense_user_settings`.

### 5.6 Default settings (future months)

**Settings popup/drawer** (gear icon) for defaults that apply when a **new month period is first created** (including future planning months):

| Setting | Applies to |
|---------|------------|
| Column display names | New months only (e.g. rename "Comment" → "Notes") |
| Default cell values | New rows added via `+ New page` |
| Column visibility + order | Schema snapshot when period is first created |
| **Seed rows** | Rows auto-created at period bootstrap (e.g. "Initial budgets", "prev month") |

**Seed row behavior:**

- User defines seed rows in the settings drawer (Expense name, optional Amount, optional Comment per row).
- When saved, seed rows apply to **the next newly opened months only** — not retroactively to months that already exist.
- On `POST /periods` or first open of a future month, server creates period + inserts seed rows in order before any user rows.
- Amount values are **static** from the template — no auto-fill from previous month's SUM (a row named "prev month" is just a label; its Amount is whatever the user configured).

Existing months keep their schema and rows unless user explicitly edits them.

**Default schema (matches mock):**

```json
{
  "columns": [
    { "id": "expense", "name": "Expense", "type": "text", "icon": "text", "visible": true, "position": 0, "defaultValue": "" },
    { "id": "row_number", "name": "#", "type": "number", "icon": "number", "visible": true, "position": 1, "defaultValue": null, "computed": "auto_increment" },
    { "id": "amount", "name": "Amount", "type": "currency", "icon": "currency", "visible": true, "position": 2, "defaultValue": 0, "role": "amount" },
    { "id": "date", "name": "Date", "type": "date", "icon": "date", "visible": true, "position": 3, "defaultValue": null, "role": "date" },
    { "id": "comment", "name": "Comment", "type": "text", "icon": "text", "visible": true, "position": 4, "defaultValue": "" }
  ]
}
```

> **`#` column:** Display-only auto-increment row index (1-based). Not stored in `cells`; computed at render from `position`. Can be hidden via property visibility.

---

## 6. Domain model

### 6.1 Entities

```
User
 └── ExpenseUserSettings (1:1)   — default schema + default values for future months
 └── ExpensePeriod (1:N)          — one per (user, year, month); owns schema snapshot + rows
      └── ExpenseRow (1:N)        — one record / "page" in the Notion table
```

No separate `ExpenseTable` entity — **period = table**.

### 6.2 TypeScript types (`packages/shared/types/expense.ts`)

```typescript
export type ExpenseColumnType = 'text' | 'number' | 'currency' | 'date';

export type ExpenseColumnIcon = 'text' | 'number' | 'currency' | 'date';

export type ExpenseColumnRole = 'amount' | 'date' | null;

export type ExpenseColumn = {
  id: string;                   // stable key, e.g. "expense", "amount"
  name: string;                 // display label (user-renamable in defaults)
  type: ExpenseColumnType;
  icon: ExpenseColumnIcon;
  visible: boolean;
  position: number;
  defaultValue: string | number | null;
  role?: ExpenseColumnRole;
  computed?: 'auto_increment';   // "#" column only
};

export type ExpenseTableSchema = {
  columns: ExpenseColumn[];
};

export type ExpenseCellValue = string | number | null;

export type ExpenseRow = {
  id: string;
  periodId: string;
  userId: string;
  position: number;
  cells: {
    expense?: string;
    amount?: number;
    date?: string | null;       // ISO date "YYYY-MM-DD" or epoch ms
    comment?: string;
    [customColumnId: string]: ExpenseCellValue | undefined;
  };
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

export type ExpensePeriod = {
  id: string;
  userId: string;
  year: number;
  month: number;                // 1–12
  label: string;                // "June 2026"
  schema: ExpenseTableSchema;   // snapshot at period creation
  createdAt: number;
  updatedAt: number;
};

export type ExpenseUserSettings = {
  userId: string;
  defaultSchema: ExpenseTableSchema;
  seedRows?: ExpenseSeedRow[];  // optional template rows for new months
  updatedAt: number;
};

export type ExpenseSeedRow = {
  expense: string;
  amount?: number;
  comment?: string;
};
```

### 6.3 Period identity

- Unique: `(userId, year, month)`.
- Label: `Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' })`.
- Dropdown sorted descending (newest first).

### 6.4 Amount & SUM rules

- Amount stored as **number** (not string). Negative = outflow.
- **Currency: VND** (fixed for v1). Display via `Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' })` — e.g. `16.500 ₫`, `-76 ₫`.
- No multi-currency or symbol picker in v1.
- `SUM` = arithmetic sum of all row `amount` values where `amount` is a finite number; blank/null = 0.
- SUM includes summary rows ("Initial budgets", "prev month") — no exclusion logic in v1.

---

## 7. Data storage (PostgreSQL)

Migration `00010_expense_notes.sql`:

```sql
CREATE TABLE expense_user_settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  default_schema JSONB NOT NULL,
  seed_rows JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE expense_periods (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  year INTEGER NOT NULL CHECK (year >= 1970 AND year <= 2100),
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  schema JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, year, month)
);

CREATE INDEX idx_expense_periods_user
  ON expense_periods (user_id, year DESC, month DESC);

CREATE TABLE expense_rows (
  id TEXT PRIMARY KEY,
  period_id TEXT NOT NULL REFERENCES expense_periods(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position INTEGER NOT NULL DEFAULT 0,
  cells JSONB NOT NULL DEFAULT '{}',
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_expense_rows_period
  ON expense_rows (period_id, position)
  WHERE deleted_at IS NULL;
```

**Rationale:**

- `schema` on `expense_periods` snapshots column layout at month creation.
- `cells` JSONB keyed by column `id` — matches Notion property bag per row.
- `#` column is UI-computed from `position`, not persisted.

---

## 8. API design

Base path: `/api/expenses` — same patterns as `subscriptions/routes.ts`.

### 8.1 Settings (defaults for future months)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/settings` | Default schema + seed rows (bootstrap if missing) |
| `PUT` | `/settings` | Update defaults for future months |

### 8.2 Periods

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/periods` | List summaries for dropdown |
| `GET` | `/periods/current` | Get or create current month with rows |
| `GET` | `/periods/by-month?year=&month=` | Resolve specific month |
| `GET` | `/periods/:periodId` | Period + rows + computed `sum` |
| `POST` | `/periods` | Create `{ year, month }` from defaults + seed rows |
| `PATCH` | `/periods/:periodId/schema` | Update column visibility/order/names for this month |

### 8.3 Rows

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/periods/:periodId/rows` | Add row (merge default cell values) |
| `PATCH` | `/rows/:rowId` | Update `cells` and/or `position` |
| `DELETE` | `/rows/:rowId` | Soft-delete row |

### 8.4 Example: period response

```json
{
  "period": {
    "id": "…",
    "year": 2026,
    "month": 6,
    "label": "June 2026",
    "schema": { "columns": ["…"] }
  },
  "rows": [
    {
      "id": "…",
      "position": 0,
      "cells": { "expense": "Initial bugets", "amount": 16500, "comment": "internet -175k" }
    }
  ],
  "sum": 38168
}
```

### 8.5 Auth

- `requireAccessUserOrWebGuest()` on all routes.
- Scope by `userId`.
- Include expenses in guest → account merge flow (Phase 2).

---

## 9. Web client architecture

### 9.1 File layout

```
apps/web/src/
  pages/
    ExpensesPage.tsx
  components/expenses/
    ExpenseMonthPicker.tsx
    ExpenseTable.tsx                 — full grid (design 1)
    ExpenseTableHeader.tsx           — property icons, +, …
    ExpenseTableRow.tsx              — row with 📄 icon + cells
    ExpenseTableFooter.tsx           — + New page + SUM
    ExpenseDatePicker.tsx            — calendar popup (design 2)
    ExpensePropertyVisibility.tsx    — modal (design 3)
    ExpenseDefaultsDrawer.tsx        — settings drawer: defaults + seed rows editor
    ExpenseAmountCell.tsx            — currency formatting
  services/
    expenses.ts
    expenseTypes.ts
    expenseUtils.ts                  — sum, formatAmount, formatDate, period helpers
  tests/
    expenseUtils.test.ts
    expenses.test.ts
```

### 9.2 Hooks

| Hook | Purpose |
|------|---------|
| `useExpensePeriods()` | Month dropdown options |
| `useExpensePeriod(periodId)` | Active month: schema + rows + sum |
| `useExpenseDefaults()` | User default settings |
| `useCreateExpenseRow()` | `+ New page` |
| `useUpdateExpenseRow()` | Debounced cell save (300ms) |
| `useUpdatePeriodSchema()` | Property visibility changes |

### 9.3 Key UI behaviors

| Component | Notes |
|-----------|-------|
| `ExpenseAmountCell` | Parse/format VND; allow negative; commit on blur |
| `ExpenseDatePicker` | Popover anchored to cell; `Full date` display like `June 4, 2026` |
| `ExpensePropertyVisibility` | Eye toggles, drag reorder, search filter |
| `ExpenseTableFooter` | `computeSum(rows)` live update |

### 9.4 Styling

- Match mock: dark grid, thin row dividers, property type icons in headers.
- Respect app `data-theme` (light + dark).
- Reuse existing nav, modal, and button patterns from Notes/Subscriptions.

---

## 10. Backend module

```
apps/backend/src/expenses/
  contracts.ts
  repository.ts
  service.ts       — period bootstrap, seed rows, sum validation
  routes.ts
apps/backend/src/tests/expenses/
  routes.test.ts
  service.test.ts
```

Register: `app.use('/api/expenses', createExpensesRoutes())`.

---

## 11. Validation

| Rule | Detail |
|------|--------|
| `expense` column | Required on save (non-empty string) when row is "complete"; allow empty draft row briefly |
| `amount` | Finite number; optional |
| `date` | ISO date string or null |
| `comment` | String or empty |
| Max rows per period | 500 |
| Max columns | 10 (v1 fixed set of 5) |
| SUM | Server recomputes on read; client mirrors for instant feedback |

---

## 12. Implementation phases

### Phase 1 — MVP (match design mocks)

- [ ] DB migration + shared types
- [ ] Settings + period + row APIs
- [ ] Expenses tab + month picker (default current month)
- [ ] Notion table: Expense, #, Amount, Date, Comment columns
- [ ] `+ New page`, inline edit, SUM footer
- [ ] Date picker popup (calendar + Clear)
- [ ] Property visibility modal (show/hide + reorder)
- [ ] Settings drawer (column defaults + **seed rows** for future months)
- [ ] VND amount formatting + SUM footer
- [ ] Month picker: future months for planning (lazy-create on select)
- [ ] Tests: sum util, period bootstrap + seed rows, routes

### Phase 2 — Polish

- [ ] Row delete + **trash**
- [ ] Search within month
- [ ] Date picker: format option, end date, time
- [ ] Add custom column (`+` in header)
- [ ] Row drag reorder
- [ ] Guest merge

### Phase 3 — Mobile

- [ ] Shared API client
- [ ] Simplified table + row editor sheet

---

## 13. Product decisions

| # | Question | Decision |
|---|----------|----------|
| 1 | Seed rows on new month | Configured in **settings popup/drawer**; when saved, **auto-applied to newly opened future months** (not retroactive) |
| 2 | Currency | **VND** (fixed for v1) |
| 3 | Month dropdown | **Allow future months** for planning; lazy-create period on first open |
| 4 | `#` column | **Auto-increment display only** (computed from row position, not stored) |
| 5 | Trash | **Deferred to Phase 2** |
| 6 | `prev month` seed row Amount | **Static** — uses the value from the seed template; no auto-fill from previous month's SUM |

---

## 14. References

- Tab shell: `apps/web/src/App.tsx`
- API patterns: `apps/backend/src/subscriptions/routes.ts`
- Shared types: `packages/shared/types/subscription.ts`
- Migrations: `apps/backend/src/db/migrations/`
- UI mocks: `docs/design 1.png`, `docs/design 2.png`, `docs/design 3.png`