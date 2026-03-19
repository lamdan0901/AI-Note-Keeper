# Plan: Migrate Mobile Styling System → Web App

## Status: Draft

## Priority: High

## Estimated Scope: Medium (CSS variable swap + icon library swap + font swap)

---

## 1. Problem Analysis

The mobile and web apps have completely divergent styling systems, making them look like two different products:

### Color Palette Differences

| Token              | Mobile (Light)             | Web (Light)                               | Gap                                |
| ------------------ | -------------------------- | ----------------------------------------- | ---------------------------------- |
| **Accent/Primary** | `#3B82F6` (blue)           | `#7b4dff` (purple)                        | Completely different hue           |
| **Accent hover**   | `#60A5FA`                  | `#6a3de8`                                 | Different hue                      |
| **CTA**            | `#F97316` (orange)         | _(none)_                                  | Web has no CTA color               |
| **Background**     | `#F8FAFC` (flat off-white) | Radial gradient (#fef7e0→#f6f0ff→#f4f7fb) | Flat vs gradient                   |
| **Text primary**   | `#1E293B` (slate)          | `#1d1b20` (warm dark)                     | Different undertone (cool vs warm) |
| **Text muted**     | `#475569`                  | `#8d8795`                                 | Different undertone                |
| **Border**         | `#E2E8F0`                  | `rgba(30, 24, 44, 0.08)`                  | Solid vs alpha                     |
| **Surface**        | `#FFFFFF`                  | `#ffffff`                                 | Same ✓                             |
| **Success**        | `#22c55e`                  | `#196836` (status-saved-text)             | Different shade                    |
| **Error**          | `#ef4444`                  | `#952222` (status-error-text)             | Different shade                    |

| Token              | Mobile (Dark)    | Web (Dark)                         | Gap                         |
| ------------------ | ---------------- | ---------------------------------- | --------------------------- |
| **Accent/Primary** | `#60A5FA` (blue) | `#7b4dff` (purple)                 | Different hue               |
| **Background**     | `#0F172A` (navy) | Gradient (#1f2435→#181b29→#12131d) | Flat vs gradient            |
| **Text primary**   | `#F8FAFC`        | `#f1ecfb`                          | Cool white vs warm lavender |
| **Surface**        | `#1E293B`        | `#2a2e3f`                          | Different shade             |
| **Border**         | `#334155`        | `rgba(241, 236, 251, 0.14)`        | Solid vs alpha              |

### Typography Differences

|                  | Mobile               | Web                              |
| ---------------- | -------------------- | -------------------------------- |
| **Font family**  | Plus Jakarta Sans    | Avenir Next, Segoe UI, system-ui |
| **Size scale**   | 12/14/16/20/24/32 px | Ad-hoc (12-24px, no scale)       |
| **Weight scale** | 300/400/500/600/700  | Ad-hoc (400/500/600/700)         |

### Icon Library Differences

|             | Mobile                          | Web                           |
| ----------- | ------------------------------- | ----------------------------- |
| **Library** | Ionicons (`@expo/vector-icons`) | Lucide React (`lucide-react`) |
| **Style**   | Filled + outlined mix           | Consistent stroke-based       |

### Theming Architecture Differences

|                 | Mobile                          | Web                                           |
| --------------- | ------------------------------- | --------------------------------------------- |
| **Approach**    | React Context + JS theme object | CSS custom properties on `:root`              |
| **Mode key**    | `'theme-mode'` in AsyncStorage  | `'ai-note-keeper:theme-mode'` in localStorage |
| **Mode values** | `'light' \| 'dark' \| 'auto'`   | `'light' \| 'dark' \| 'system'`               |
| **Transition**  | 240ms animated opacity fade     | None (instant)                                |

### Note Colors — Shared ✓

Both apps use the same 6 note color presets with identical hex values (red, yellow, green, blue, purple) in both light and dark modes.

---

## 2. Migration Strategy

**Direction: Adopt the mobile app's design tokens as the source of truth**, then adapt them for the web's CSS custom property system.

### Rationale

- The mobile theme is more structured (named scales for spacing, typography, radius)
- Blue accent is more conventional for a productivity note app than purple
- Plus Jakarta Sans is a modern, more distinctive font choice
- The mobile palette uses Tailwind-adjacent slate colors which are well-balanced

---

## 3. Implementation Plan

### Phase 1: Shared Design Tokens (Foundation)

**Create a shared token file** that both platforms can consume.

#### Step 1.1 — Create `packages/shared/tokens/colors.ts`

```ts
export const lightColors = {
  primary: '#3B82F6',
  secondary: '#60A5FA',
  cta: '#F97316',
  background: '#F8FAFC',
  text: '#1E293B',
  textMuted: '#475569',
  border: '#E2E8F0',
  surface: '#FFFFFF',
  success: '#22c55e',
  error: '#ef4444',
};

export const darkColors = {
  primary: '#60A5FA',
  secondary: '#3B82F6',
  cta: '#F97316',
  background: '#0F172A',
  text: '#F8FAFC',
  textMuted: '#ccd0d7',
  border: '#334155',
  surface: '#1E293B',
  success: '#4ADE80',
  error: '#F87171',
};
```

#### Step 1.2 — Create `packages/shared/tokens/typography.ts`

```ts
export const typography = {
  fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif",
  sizes: { xs: 12, sm: 14, base: 16, lg: 20, xl: 24, xxl: 32 },
  weights: { light: 300, regular: 400, medium: 500, semibold: 600, bold: 700 },
};
```

#### Step 1.3 — Create `packages/shared/tokens/spacing.ts`

```ts
export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };
export const borderRadius = { sm: 8, md: 12, lg: 16, xl: 24 };
```

#### Step 1.4 — Create `packages/shared/tokens/noteColors.ts`

Extract from mobile's `noteColors.ts` into shared package.

---

### Phase 2: Web App CSS Variable Migration

#### Step 2.1 — Add Google Font import for Plus Jakarta Sans

Add to `apps/web/index.html`:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700&display=swap"
  rel="stylesheet"
/>
```

#### Step 2.2 — Update `:root` CSS variables in `styles.css`

Replace the current purple-based palette with the mobile's blue-based palette:

```css
:root {
  color-scheme: light;
  font-family: 'Plus Jakarta Sans', system-ui, sans-serif;

  --app-background: #f8fafc;
  --color-text-primary: #1e293b;
  --color-text-secondary: #475569;
  --color-text-muted: #94a3b8;
  --color-accent: #3b82f6;
  --color-accent-hover: #2563eb;
  --color-accent-soft: rgba(59, 130, 246, 0.12);
  --color-border-soft: #f1f5f9;
  --color-border-strong: #e2e8f0;
  --color-hover-soft: rgba(30, 41, 59, 0.06);
  --color-overlay: rgba(15, 23, 42, 0.5);
  --color-cta: #f97316;
  --color-cta-hover: #ea580c;
  --color-surface: #ffffff;
  --color-success: #22c55e;
  --color-error: #ef4444;
  --color-input-placeholder: #94a3b8;

  --color-status-saving-bg: #fff7ed;
  --color-status-saving-text: #c2410c;
  --color-status-saved-bg: #f0fdf4;
  --color-status-saved-text: #15803d;
  --color-status-error-bg: #fef2f2;
  --color-status-error-text: #dc2626;

  /* shadows — keep existing, just adjust color base */
  --shadow-card: 0 2px 8px rgba(15, 23, 42, 0.08);
  --shadow-card-hover: 0 6px 18px rgba(15, 23, 42, 0.12);
  --shadow-dialog: 0 24px 64px rgba(15, 23, 42, 0.18);

  /* note colors stay the same */
}
```

#### Step 2.3 — Update dark mode `:root[data-theme='dark']`

```css
:root[data-theme='dark'] {
  color-scheme: dark;
  --app-background: #0f172a;
  --color-text-primary: #f8fafc;
  --color-text-secondary: #cbd5e1;
  --color-text-muted: #64748b;
  --color-accent: #60a5fa;
  --color-accent-hover: #3b82f6;
  --color-accent-soft: rgba(96, 165, 250, 0.2);
  --color-border-soft: rgba(248, 250, 252, 0.08);
  --color-border-strong: #334155;
  --color-hover-soft: rgba(248, 250, 252, 0.06);
  --color-overlay: rgba(2, 6, 23, 0.7);
  --color-cta: #f97316;
  --color-cta-hover: #fb923c;
  --color-surface: #1e293b;
  --color-success: #4ade80;
  --color-error: #f87171;
  --color-input-placeholder: #64748b;

  --color-status-saving-bg: rgba(194, 65, 12, 0.15);
  --color-status-saving-text: #fdba74;
  --color-status-saved-bg: rgba(21, 128, 61, 0.15);
  --color-status-saved-text: #86efac;
  --color-status-error-bg: rgba(220, 38, 38, 0.15);
  --color-status-error-text: #fca5a5;

  --shadow-card: 0 2px 12px rgba(0, 0, 0, 0.35);
  --shadow-card-hover: 0 8px 24px rgba(0, 0, 0, 0.42);
  --shadow-dialog: 0 24px 64px rgba(0, 0, 0, 0.45);

  /* dark note colors stay the same */
}
```

#### Step 2.4 — Update `body` background

Switch from gradient to flat:

```css
body {
  min-height: 100vh;
  background: var(--app-background);
  /* Remove gradient fallback if any */
}
```

#### Step 2.5 — Audit all hardcoded colors in `styles.css`

Search for any remaining hardcoded hex values or rgba values that reference the old purple palette and replace them with the new CSS variables.

---

### Phase 3: Icons — No Changes

Icons are **out of scope** for this migration. Each platform keeps its current icon library as-is:

- **Mobile**: Ionicons (`@expo/vector-icons`)
- **Web**: Lucide React (`lucide-react`)

No icon swaps, size standardization, or semantic alignment work is planned.

---

### Phase 4: Theme Mode Alignment

#### Step 4.1 — Rename web `'system'` mode to `'auto'` to match mobile

Update [apps/web/src/services/theme.ts](apps/web/src/services/theme.ts):

- Change type from `'system'` to `'auto'`
- Update storage key to `'theme-mode'` (drop the prefix for consistency)
- Or keep separate keys since they're different apps

#### Step 4.2 — Add theme transition on web

Add a smooth 200ms transition when switching themes:

```css
:root {
  transition:
    background-color 0.2s ease,
    color 0.2s ease;
}
```

---

### Phase 5: Typography Scale Alignment

#### Step 5.1 — Define consistent font size variables

Add to `:root`:

```css
:root {
  --font-xs: 12px;
  --font-sm: 14px;
  --font-base: 16px;
  --font-lg: 20px;
  --font-xl: 24px;
  --font-xxl: 32px;
}
```

#### Step 5.2 — ~~Replace ad-hoc font sizes~~ _(Skipped)_

_Not worth the churn — existing sizes work fine in context and a forced remap could introduce visual regressions._

---

## 4. Migration Checklist

- [ ] Create `packages/shared/tokens/` with colors, typography, spacing, noteColors
- [x] Add Plus Jakarta Sans font to web app
- [x] Update `:root` light mode CSS variables (purple → blue)
- [x] Update `:root[data-theme='dark']` CSS variables
- [x] Switch background from gradient to flat color
- [x] Add CSS font-size variables matching mobile scale
- ~~Replace all hardcoded sizes with scale variables~~ _(skipped — not worth the churn)_
- [x] Audit & remove all hardcoded old-palette colors
- [x] Add theme transition on web
- [x] Unify theme mode naming (`'auto'` vs `'system'`)
- [ ] Verify note color presets remain aligned
- [ ] Visual regression test on all pages (light + dark)

---

## 5. Files Changed

| File                                      | Change                               |
| ----------------------------------------- | ------------------------------------ |
| `packages/shared/tokens/colors.ts`        | New — shared color tokens            |
| `packages/shared/tokens/typography.ts`    | New — shared typography tokens       |
| `packages/shared/tokens/spacing.ts`       | New — shared spacing tokens          |
| `packages/shared/tokens/noteColors.ts`    | New — shared note color presets      |
| `apps/web/index.html`                     | Add Google Font link                 |
| `apps/web/src/styles.css`                 | Complete CSS variable overhaul       |
| `apps/web/src/services/theme.ts`          | Align mode naming                    |
| `apps/mobile/src/theme.ts`                | Import from shared tokens (optional) |
| `apps/mobile/src/constants/noteColors.ts` | Import from shared tokens (optional) |

---

## 6. Risk Assessment

| Risk                                   | Likelihood | Mitigation                        |
| -------------------------------------- | ---------- | --------------------------------- |
| Visual regressions in web UI           | Medium     | Thorough before/after screenshots |
| Font loading delay (FOUT)              | Low        | `display=swap` + fallback stack   |
| Colored note cards look different      | Low        | Same hex values already shared    |
| Mobile-specific tokens don't translate | Low        | Only foundational tokens shared   |
