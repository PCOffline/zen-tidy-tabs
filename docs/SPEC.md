# Zen Tidy Tabs — Behaviour Specification

This document is the **single source of truth** for what Zen Tidy Tabs does. Every
behaviour the product guarantees is listed here with a stable ID. The end-to-end
tests under `tests/specs/` exist to verify these clauses and nothing else.

> [!IMPORTANT]
> **Change protocol.** A behaviour does not exist until it is written here, and a
> test must not assert anything that is not written here. Any change to behaviour
> flows **SPEC → tests → code**, in that order, in the same change. See
> [`.agents/skills/spec-sync/SKILL.md`](./.agents/skills/spec-sync/SKILL.md).

Each clause carries:

- a **stable ID** (e.g. `BADGE-2`) that tests reference in their title or a comment;
- a **Verified by** line naming the test(s) that prove it, or `Unverified` if no
  automated test covers it yet (these are gaps, not permission to skip the SPEC).

Terminology follows the codebase: the **Tidy control** is the "🧹 Tidy" button; a
**group badge** (or label) is a native Zen `tab-group` label; **inline edit** is the
in-place HTML input the script swaps in for the badge.

---

## 1. Tidy control (the "🧹 Tidy" button)

- **CONTROL-1** — A control with id `zen-tidy-tabs-button`, text/label `🧹 Tidy`, and
  tooltip `Tidy tabs with AI` is mounted in Zen's sidebar.
  _Verified by: `tidy-button.spec.ts › the tidy button exists`._

- **CONTROL-2** — Placement. When Zen's native **Clear** control is present, the Tidy
  control is a *twin*: the same element type as Clear, in Clear's parent, positioned
  immediately before Clear, so it inherits Clear's hover-reveal look from Zen's descendant
  styles. The twin reuses Clear's classes **except** the control class Zen keys its own
  bookkeeping on (see CONTROL-6). When no Clear control is present, it falls back to the
  active workspace tab section, inserted before the first normal (non-pinned, non-essential)
  node. The mount self-heals: a watcher upgrades the fallback to a twin if Clear later
  appears.
  _Verified by: `tidy-button.spec.ts › the tidy button's placement is correct`._

- **CONTROL-3** — **Left-click** (or a XUL `command` event) on the Tidy control starts a
  tidy run (see §2). The native action is suppressed (`preventDefault` + `stopPropagation`).
  _Verified by: `tidying.spec.ts › tidying the tabs actually works` (clicks the real control)._

- **CONTROL-4** — While a run is in progress the control shows `↻ Tidying…` and is
  non-interactive (`pointer-events: none`); both revert when the run ends.
  _Verified by: `tidy-run.spec.ts › the control shows a busy state while a run is in progress`._

- **CONTROL-5** — **Right-click** on the Tidy control opens the Settings modal (§5) and
  suppresses the native context menu.
  _Verified by: `settings.spec.ts › right-clicking the button opens the Zen Tidy Tabs configuration`._

- **CONTROL-6** — The Tidy twin must not impersonate Zen's Clear control. It never carries
  Zen's `zen-workspace-close-unpinned-tabs-button` class, so Zen's own first-match
  `querySelector` for that control always resolves to the real Clear button rather than the
  twin. As a result the real Clear control keeps its native icon and styling even with the
  Tidy twin mounted immediately before it.
  _Verified by: `tidy-button.spec.ts › the tidy twin does not steal Clear's control class`._

- **CONTROL-7** — The Tidy control follows the **active workspace**. Zen keeps one
  `<zen-workspace>` element per workspace in the DOM; on every workspace change (observed via
  `gZenWorkspaces.addChangeListeners`) the control is re-placed into the active workspace, so
  exactly one Tidy control exists and it is always present in the workspace the user is
  viewing — not only the first workspace.
  _Verified by: `workspace.spec.ts › the tidy control follows the active workspace`._

---

## 2. Tidy operation

- **TIDY-1** — A run requires a configured OpenRouter API key. With no key, the run
  aborts before any tab collection and surfaces a notification telling the user to set
  the key. _Verified by: `tidy-run.spec.ts › refuses to run without an API key and notifies`._

- **TIDY-2** — The run is re-entrant-safe: while one run is in progress, further
  activations are ignored.
  _Verified by: `tidy-run.spec.ts › ignores a second activation while a run is in progress`._

- **TIDY-3** — A tab is **eligible** for tidying iff it is not pinned, hidden, or closing,
  and is not a Zen empty/glance tab. Ineligible tabs are never collected, grouped, or sent
  to the model.
  _Verified by: `tidying.spec.ts › collecting skips pinned, empty, and glance tabs`._

- **TIDY-4** — **Minimum of 3 eligible tabs.** With fewer than 3, the run aborts *before*
  contacting the model (no network call, no group creation) and notifies the user.
  _Verified by: `min-tabs.spec.ts › refuses to tidy below the minimum and never calls the model`._

- **TIDY-5** — The model receives a compact snapshot, one entry per eligible tab:
  `{ i, title, url?, group? }`.
  - `title` is always sent (truncated to a max length).
  - `url` is included per the privacy preference (§6 `urlmode`): `detailed` = host + path,
    `compact` = hostname only, `minimal` = omitted. **Query strings and hashes are never
    sent.**
  - `group` is included **only** for tabs that are already in a group, and carries that
    group's current name as a *hint* for keeping existing groupings stable (§2 TIDY-7).
  _Verified by: `snapshot.spec.ts › the snapshot has the documented shape and strips query
  strings`, `› already-grouped tabs carry their group name and ungrouped tabs do not`, and
  `› the urlmode preference controls whether a url is sent`._

- **TIDY-6** — The prompt caps the number of groups at `clamp(ceil(tabCount / 3), 2, 8)`
  and instructs the model to group by what the user is *doing*, name groups in 1–3 words
  Title Case, and ground every group in the supplied titles/URLs. Groups must be
  **expandable categories**, not descriptions of a single tab: the model prefers multi-tab
  groups and does not make a group as specific as possible. A **single-tab group is allowed
  only when its name is a real category a future tab could naturally join** (e.g.
  `Chicken Recipes`, `World of Tanks`) — never when it merely re-describes that one tab.
  When a tab fits no reasonable category, or many tabs are mutually unrelated, they go into
  an **`Other`** group, which is a genuine last resort.
  _Verified by: `prompt.spec.ts › caps the group count (floor) at clamp(ceil(tabCount/3), 2, 8)`,
  `› scales the group count cap with the tab count`, and `› carries the grouping and naming
  rubric`._

- **TIDY-7** — **Stability of existing groups.** When existing groups are present, the
  prompt instructs the model to keep a sensible existing group, reuse its *exact* name,
  and only reorganise with a clear reason (e.g. new tabs make a broader category
  correct). On the apply side, a planned group whose normalised name matches an existing
  group is **kept in place** — its position and colour are preserved and only the tabs
  that actually changed are moved in. Genuinely new groups are created; existing groups
  the plan abandons are dissolved.
  _Verified by: `tidying.spec.ts › re-tidying never paints the old groups beneath the new ones`._

  > Note: position/colour are preserved only when the planned name matches an existing
  > group's name (case/space-insensitive). If the model renames a group, that group is
  > treated as new and may be repositioned. See Open Question OQ-4.

- **TIDY-8** — Plan parsing maps `{ groups: [{ name, tabs: [<index>] }] }` back to real
  tabs. Each tab index is used at most once. Any eligible tab the model omits is collected
  into the trailing **`Other`** group (see TIDY-13) so no tab is lost.
  _Verified by: `tidying.spec.ts › tidying the tabs actually works`._

- **TIDY-9** — Applying a plan **never nests** one group inside another, and **never shows
  the old groups stacked beneath the new ones** during a re-tidy (no husk flicker):
  emptied pre-existing groups are removed synchronously as the new layout is built.
  _Verified by: `tidying.spec.ts › re-tidying never paints the old groups beneath the new ones`._

- **TIDY-10** — On full success the run notifies how many tabs were sorted into how many
  groups (the group count is the number actually created, not the number requested). When
  some groups are created but others fail, the run notifies the partial outcome — how many
  groups were created and how many failed — as an error. When no group is created at all,
  the run notifies failure. A `gBrowser.addTabGroup` call that returns a falsy value counts
  as a failed creation, exactly like one that throws.
  _Verified by: `tidy-run.spec.ts › notifies success with the tab and group counts`,
  `› notifies failure when the model call fails`, and
  `› notifies failure when group creation silently fails`._

- **TIDY-11** — Eligible tabs are collected from the **active workspace only**: a tab that
  belongs to another workspace is never collected, even if it is otherwise eligible.
  _Unverified._

- **TIDY-12** — A re-tidy reconsiders the *whole* active workspace, **including
  already-grouped tabs** (`collect(includeGrouped)`), so existing groups can be reorganised
  rather than left untouched. Status readouts collect ungrouped tabs only.
  _Verified by: `tidying.spec.ts › re-tidying never paints the old groups beneath the new ones`
  (re-tidies already-grouped tabs)._

- **TIDY-13** — **Single-tab group budget.** A spray of one-tab groups is rarely
  meaningful, so plan parsing caps how many single-tab groups survive: the number of
  single-tab groups kept is **at most the number of multi-tab groups** (groups with ≥2
  tabs) in the plan. Single-tab groups are kept in plan order until that budget is
  exhausted; every tab from a surplus single-tab group, together with any tab the model
  omitted (TIDY-8), is folded into a single trailing **`Other`** group. `Other` is a last
  resort and **may itself hold a single tab**.
  _Verified by: `tidying.spec.ts › collapses surplus single-tab groups into Other`._

- **TIDY-14** — **Each notification dismisses only itself.** A notification is
  auto-removed after its own display duration (`notifyDurationMs`). Showing a later
  notification never causes an earlier notification's pending auto-dismissal to remove
  it: each scheduled dismissal targets the specific notification it was created for, not
  whichever notification currently occupies the shared `zen-tidy-tabs-msg` slot.
  _Verified by: `tidy-run.spec.ts › a notification's auto-dismiss never removes a later notification`._

- **TIDY-15** — **Deterministic sampling.** The model request sets `temperature: 0` and a
  fixed `seed` so a given set of tabs clusters as repeatably as the provider allows.
  `seed` is a *best-effort* reproducibility hint: providers and models that do not support
  it (e.g. the Anthropic API, which has no seed parameter) silently ignore it, and
  byte-for-byte determinism is never guaranteed across the heterogeneous OpenRouter model
  pool.
  _Verified by: `request.spec.ts › sends deterministic sampling parameters`._

- **TIDY-16** — **Schema-enforced output contract.** The request asks the provider to
  constrain the reply to the grouping schema via Structured Outputs
  (`response_format: { type: "json_schema", strict: true }`), whose schema is
  `{ groups: [{ name: string, tabs: integer[] }] }`. Because not every model supports it,
  the contract **degrades gracefully** on an HTTP 400 rejection, in order:
  `json_schema → json_object → none`. Plan parsing (TIDY-8) remains the sole authority on
  index hygiene regardless of which contract the provider accepted.
  _Verified by: `request.spec.ts › requests schema-enforced structured output` and
  `› degrades to a looser output contract when the model rejects json_schema`._

- **TIDY-17** — **Truncated-response handling.** If the reply is cut off by the output
  token limit (`finish_reason: "length"`), the run fails with a message that names the
  truncation and the token budget, instead of surfacing a generic "could not parse model
  output" error.
  _Verified by: `request.spec.ts › fails clearly when the model response is truncated`._

- **TIDY-18** — **Prompt placement.** The role, grouping rubric, hard constraints, output
  schema, and worked examples are sent as the **system** message; the per-run tab snapshot
  (TIDY-5) is the **user** message, wrapped in `<tabs>` tags as the only variable input.
  _Verified by: `request.spec.ts › puts the rubric in the system message and the snapshot in the user message`._

- **TIDY-19** — **Distinct group colours.** When a plan is applied, every **new** group is
  given a colour that differs from every kept group's colour and from every other new
  group's colour, as long as the palette (`CONFIG.grouping.colors`) still has an unused
  colour. Kept groups retain their own colour (TIDY-7); new groups draw from the palette,
  skipping colours already in use — regardless of the order new and kept groups appear in
  the plan. Once the plan needs more distinct groups than the palette holds, colours repeat
  predictably (the palette is reused in order) rather than failing.
  _Verified by: `tidying.spec.ts › a re-tidy never gives a new group a kept group's colour`._

---

## 3. Group badge — inline rename (left-click)

- **BADGE-1** — A **single left-click** on a group badge enters **inline edit**: the native
  XUL label is hidden and replaced in place by an HTML input
  (`.zen-tidy-tabs-inline-input`), and the badge gains the marker class
  `zen-tidy-tabs-inline-editing`. Zen's native click action (collapse/expand) is
  suppressed. A left-click **never** opens the native panel.
  _Verified by: `group-badge.spec.ts › left-clicking the group badge renames it inline`._

- **BADGE-2** — **Minimal visual impact.** The input copies the badge's computed font,
  colour, background, padding, border-radius, height, text-align, and text-shadow, so the
  field reads as the badge itself rather than a form control. It is sized to its text
  (content-box) and grows as you type, and never balloons to the sidebar width or
  overflows the tab strip.
  _Verified by: `group-badge.spec.ts › the inline input hugs its text and grows as you type`
  (headed only)._

- **BADGE-3** — **Enter saves.** Pressing Enter commits the rename. The new name is
  trimmed; the rename is applied only when it is non-empty and differs from the original.
  _Verified by: `group-badge.spec.ts › left-clicking the group badge renames it inline`._

- **BADGE-4** — **Escape cancels.** Pressing Escape abandons the edit and restores the
  original name; nothing typed is saved.
  _Verified by: `group-badge.spec.ts › pressing Escape during inline rename keeps the original name`._

- **BADGE-5** — **Click-away / blur commits the edit.** Pressing the mouse anywhere outside
  the input, or the input losing focus, ends the inline edit and **saves** the current
  value (same trim/non-empty/changed rule as Enter). A single click away is enough to
  leave edit mode.
  _Verified by: `group-badge.spec.ts › a single real click away saves the inline edit` (headed
  only)._

- **BADGE-6** — **One editor at a time, no stuck edits.** Only one inline editor is ever
  active; re-clicking the same badge refocuses it. Rapid, repeated, double, or alternating
  left-clicks keep the badge inline and usable and never strand a half-open edit.
  _Verified by: `group-badge.spec.ts › spam left-clicks…`, `› double left-click stays inline…`,
  `› erratic alternating clicks never leave a stuck inline edit`._

- **BADGE-7** — **Click-away works over window-drag regions.** Zen's empty sidebar area
  (`.zen-workspace-empty-space`) is a `-moz-window-dragging: drag` region, so a real mouse
  press there is taken by the window manager for window-dragging and never reaches the DOM
  — which would leave an inline edit stuck open (BADGE-5's dismissal handler never fires).
  While an inline edit is active the script marks the chrome root
  (`:root.zen-tidy-tabs-editing`) and forces such regions to `-moz-window-dragging: no-drag`,
  so a single click on the empty sidebar still ends the edit. The override is removed when
  the edit ends.
  _Verified by: `group-badge.spec.ts › inline edit disables window-dragging on the empty sidebar`._

- **BADGE-8** — **Editing never collapses the group.** Zen collapses/expands a group when
  its badge is clicked. During an inline edit the badge is hidden behind the input, so the
  second click of a double-click lands on the input; the script swallows clicks on the
  inline input so they never reach Zen's collapse handler. Double-clicking a badge therefore
  never collapses the group or leaves it stuck in the collapsed (selected-looking) style.
  _Verified by: `group-badge.spec.ts › clicking the inline input never collapses the group`._

---

## 4. Group badge — native edit panel (right-click)

- **PANEL-1** — A **single right-click** on a group badge opens **Zen's native group edit
  panel** (`gBrowser.tabGroupMenu.openEditModal`) exactly once. The native context menu is
  suppressed. The panel is Zen's own UI for renaming, recolouring, and closing the group.
  _Verified by: `group-badge.spec.ts › right-clicking the group badge opens Zen's native edit panel`._

- **PANEL-2** — Right-click works whether the badge is showing its label or the inline
  input. If an inline edit is in progress, the right-click **cancels** that inline edit and
  hands off to the native panel.
  _Verified by: `group-badge.spec.ts › right-clicking mid-rename opens the native panel and ends the inline edit`._

- **PANEL-3** — **No redundant "Save and close group".** Once the native panel is open,
  Zen Tidy Tabs hides its **Save and close group** action: for an already-saved group it is
  indistinguishable from **Delete group**. Guarded by the `CONFIG.panel.hideSaveAndClose`
  flag so a future Zen change can restore the native action without code edits.
  _Verified by: `group-badge.spec.ts › the native panel hides the redundant Save and close group action`._

- **PANEL-4** — **"Ungroup tabs" actually ungroups.** Zen's native *Ungroup tabs* action is
  currently inert (it does nothing). Zen Tidy Tabs intercepts that action in the panel's
  capture phase, ahead of Zen's own handler, and performs the ungroup itself: every tab is
  removed from the group (the tabs **stay open**), the now-empty group is dissolved, and the
  panel closes. Guarded by the `CONFIG.panel.overrideUngroup` flag so it can be handed back
  to Zen's native handler if Zen fixes it.
  _Verified by: `group-badge.spec.ts › the native panel's Ungroup tabs action ungroups the group and keeps its tabs`._

---

## 5. Settings modal (right-click the Tidy control)

- **SETTINGS-1** — Right-clicking the Tidy control opens a custom modal titled
  **"Zen Tidy Tabs Settings"** (overlay id `zen-tidy-tabs-overlay`).
  _Verified by: `settings.spec.ts › right-clicking the button opens the Zen Tidy Tabs configuration`._

- **SETTINGS-2** — The modal exposes these controls:
  - **OpenRouter API key** — password input.
  - **Model** — text input; placeholder is the default model (`openai/gpt-4o-mini`).
  - **Group labels** — segmented control: `Colored` (= `filled`) / `Text only` (= `text`).
  - **Tab info sent to AI** — segmented control: `Detailed` / `Compact` / `Minimal`.
  - Hint text explaining the privacy modes, and a link to `openrouter.ai/keys`.
  _Verified by: `settings.spec.ts › right-clicking the button opens the Zen Tidy Tabs configuration`
  (API key field) and `› saved settings persist…` (model + both segmented controls)._

- **SETTINGS-3** — **Save** persists every field to `about:config` prefs (§6), re-applies
  the label appearance immediately, closes the modal, and notifies. **Cancel**, the ✕
  button, Escape, and clicking outside the panel all close it without saving. Focus is
  trapped inside the modal while open.
  _Verified by: `settings.spec.ts › saved settings persist and are reflected when reopened`
  (save + persistence), `› closing the settings modal without saving discards changes`
  (Cancel/✕/Escape/click-outside), and `› focus stays trapped inside the open settings modal`._

- **SETTINGS-4** — Reopening the modal reflects the currently-saved values.
  _Verified by: `settings.spec.ts › saved settings persist and are reflected when reopened`._

---

## 6. Preferences (about:config)

All settings live under `about:config` and are editable both there and via the modal.

| Pref | Values | Default | Clause |
|---|---|---|---|
| `zen-tidy-tabs.apikey` | OpenRouter key string | empty | TIDY-1, SETTINGS-2 |
| `zen-tidy-tabs.model` | model slug | `openai/gpt-4o-mini` | TIDY-5, SETTINGS-2 |
| `zen-tidy-tabs.labelstyle` | `filled` \| `text` | `filled` | LABEL-1 |
| `zen-tidy-tabs.urlmode` | `detailed` \| `compact` \| `minimal` | `detailed` | TIDY-5 |

- **PREFS-1** — An unrecognised `urlmode` value falls back to `detailed`.
  _Verified by: `snapshot.spec.ts › an unrecognised urlmode falls back to detailed`._

_Verified by: `settings.spec.ts › saved settings persist and are reflected when reopened`
(all four prefs round-trip)._

---

## 7. Group appearance

- **LABEL-1** — With `labelstyle = text`, group badges render in an Arc-style text-only
  form (transparent background, neutral weight) using the theme's readable tab-text
  foreground colour (`--toolbox-textcolor`), **not** the accent colour (`--zen-primary-color`)
  which can be unreadable on some themes. With `labelstyle = filled` (default), badges keep
  Zen's native coloured style. Changing the setting re-applies immediately.
  _Verified by: `label-style.spec.ts › text labelstyle renders an Arc-style text-only badge`._

---

## 8. Group lifecycle

- **LIFECYCLE-1** — A group whose tabs all close (or are all dragged out) is **dissolved
  automatically**. A scheduled sweep runs after a tidy and after closing a group, and a
  mutation watcher catches drag-driven emptying. A group is **not** dissolved while the
  user is mid inline-rename on it.
  _Verified by: `empty-group.spec.ts › a group whose tabs all close is dissolved automatically`._

---

## Open questions / known divergences

These are unresolved contradictions between this SPEC, the shipped code, and other docs.
Each must be closed by editing the SPEC (and then tests + code) or by fixing the code —
never left silently divergent.

- **OQ-4 — Rename breaks position stability.** Per TIDY-7, an existing group keeps its
  position/colour only when the planned name matches its current name. If the model renames
  an otherwise-stable group, it is rebuilt and may move. Decide whether this is acceptable
  or whether reconciliation should match groups by membership as well as name.
