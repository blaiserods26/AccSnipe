# GRL-02 — Extension Architecture & Build Spec

**Labels:** `wayfinder:grilling`
**Status:** Open (unclaimed)
**Blocked by:** RES-01, RES-02, GRL-01, PRO-01

---

## Question

With the quota API, switching mechanism, credential model, and UI approach all decided, what is the full build specification for the extension?

This is the final design session before execution begins. It should produce a complete spec covering:

1. **Extension type**: Pure VS Code extension, or Antigravity plugin/sidecar (`.agents/plugins/`)?
2. **Language & toolchain**: TypeScript + esbuild (standard VS Code extension), or something else?
3. **Module breakdown**:
   - `AccountStore` — CRUD for saved accounts (using decided credential strategy)
   - `QuotaPoller` — background service that calls the quota API on a schedule
   - `SidebarProvider` — TreeView or WebView that renders account cards
   - `SwitchCommand` — executes account switch using the decided mechanism
4. **Quota polling interval**: How often to refresh quota data (e.g. every 5 min)?
5. **Error states**: What does the UI show when quota fetch fails, or when a token expires?
6. **Package & publish**: Will this be published to the VS Code Marketplace, or just installed locally as a `.vsix`?

The output of this ticket is a written spec detailed enough to hand off to a build agent.
