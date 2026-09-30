# PRO-01 — Sidebar UI Prototype

**Labels:** `wayfinder:prototype`
**Status:** Open (unclaimed)
**Blocked by:** RES-01, RES-02

---

## Question

What should the sidebar UI look like and feel like? Specifically:

1. **Panel type**: Native VS Code `TreeView` (structured list, follows VS Code theme) vs. `WebView` panel (fully custom HTML/CSS, rich UI)?
2. **Account card layout**: What information is visible at a glance vs. on expand? Does each account get a collapsed card, or is everything shown inline?
3. **Sort control**: Where does the sort selector live — top bar of the panel, right-click menu, or a dropdown per-account?
4. **Switch button**: When does the "Switch" button appear — always, or only when quota has refreshed? How prominent should it be?
5. **Quota display**: Bar chart, numeric (X/Y), percentage ring, or color-coded badge?
6. **Refresh indicator**: Countdown timer, absolute timestamp, or "refreshes in X mins" label?

Build a throwaway HTML prototype (a single `.html` file) that sketches the sidebar UI so the user can react to it. The goal is to make a concrete, clickable artifact to react to — fidelity matters less than coverage of all the UI decisions above.
