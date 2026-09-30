# PRO-01 — Resolution: Sidebar UI Prototype

**Status:** Closed ✅
**Resolved:** 2026-09-30

---

## Answer

The sidebar UI decisions have been locked via the interactive prototype:

### 1. Panel Implementation & Layout
- **Style:** **Variant B: Rich Visual Cards** (implemented via VS Code `WebviewViewProvider`).
- **Cards:** Each account has an independent visual card with rounded borders, hover elevation, and an active accent state.
- **Active Indicator:** Active account displays an illuminated green badge with a pulsing dot (`ACTIVE`) and an accent border (`#22c55e`).

### 2. Quota & Limit Presentation
- **Dual Visual Meters (Inline):**
  - **5-Hour Rolling Meter:** Top progress track displaying compute effort percentage remaining + reset timer countdown (e.g. `Refreshes in 42m` or `⚡ Quota Refreshed!`).
  - **Weekly Limit Meter:** Second progress track displaying remaining weekly quota + reset in days.
- **Dynamic Color Grading:**
  - `> 60%`: Green gradient (`#16a34a` -> `#22c55e`)
  - `25% - 60%`: Amber gradient (`#d97706` -> `#f59e0b`)
  - `< 25%`: Red warning gradient (`#dc2626` -> `#ef4444`)
- **Free Plan Handling:** Free tier accounts show "N/A (Free)" for 5-hour rolling cycle and rely solely on the weekly meter.

### 3. Account Switching Interaction
- **Switch Affordance:** Prominent action button on non-active accounts.
- **Refreshed Status ("Snipe Ready"):** When an account's 5-hour quota has fully refreshed or is above threshold, the button turns green with `⚡ Switch (Ready)` to allow immediate sniping.
- **Active State:** The currently active account replaces the button with a static `Active` badge.

### 4. Sort & Filter Controls
- **Location:** Top toolbar area directly beneath the panel header.
- **Control Type:** Native dropdown `<select>` with options:
  1. `Quota Remaining (High to Low)` (Default)
  2. `Refresh Time (Earliest First)`
  3. `Plan Tier (Pro > Plus > Free)`
  4. `Account Name (A-Z)`

### 5. Header Actions
- `＋` **Add Google Account:** Opens OAuth consent browser modal/window.
- `↻` **Refresh All Quotas:** Triggers immediate loopback/Cloud Code telemetry poll.

### Prototype Asset
- Tested and verified at [`prototype-sidebar.html`](file:///c:/Users/Blaise%20Rodrigues/Desktop/AntiGravity/AccSnipe/prototype-sidebar.html).
