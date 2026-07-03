---
name: spec-sync
description: Keep SPEC.md, the tests, and the code in lockstep for Zen Tidy Tabs. Use whenever you add, change, or remove any user-visible behaviour, edit SPEC.md, edit anything under tests/specs, or change index.uc.js in a way that affects what the product does. Enforces SPEC.md as the single source of truth.
---

# Spec Sync

`SPEC.md` at `docs/` is the **single source of truth** for Zen Tidy Tabs'
behaviour. The tests under `tests/specs/` exist only to verify clauses in `SPEC.md`.
This skill keeps the three in lockstep.

The invariant: **every behaviour is in SPEC.md ⇔ a test asserts it ⇔ the code does it.**
Nothing drifts out of that triangle silently.

## The golden rule

Changes always flow in this order, in a **single change/PR**:

```
SPEC.md  →  tests/specs/  →  index.uc.js
```

1. **SPEC first.** A behaviour does not exist until it has a clause (with a stable ID)
   in `SPEC.md`.
2. **Tests second.** Each new or changed clause gets a test that verifies it, named or
   commented with the clause ID.
3. **Code last.** Change `index.uc.js` until the tests pass.

Never change code behaviour without first updating `SPEC.md`. Never add a test asserting
something `SPEC.md` does not state. Never edit `SPEC.md` without updating the tests in the
same change.

## When this skill applies

Use it whenever you are about to:

- add / change / remove any user-visible behaviour;
- edit `SPEC.md`;
- edit anything under `tests/specs/`;
- edit `index.uc.js` in a way that changes what the product does (pure refactors with no
  behaviour change don't require a SPEC edit, but must keep all clause IDs passing).

## Clause IDs

Every clause in `SPEC.md` has a stable, prefixed ID: `CONTROL-*`, `TIDY-*`, `BADGE-*`,
`PANEL-*`, `SETTINGS-*`, `PREFS-*`, `LABEL-*`, `LIFECYCLE-*`.

- IDs are **append-only**: never renumber or reuse a retired ID. Removing a behaviour
  removes the clause; its ID is retired, not recycled.
- Each clause has a `Verified by:` line pointing at the test(s), or `Unverified.` if no
  automated test covers it yet. `Unverified` is a tracked gap, never an excuse to drop the
  clause.
- A test references its clause ID(s) in the test title or a top-of-test comment, so the
  mapping is greppable both ways.

## Procedures

### A. Introducing or changing a behaviour

1. Write or edit the clause in `SPEC.md`. Give a new clause the next free ID in its
   section. Reuse the codebase's vocabulary (Tidy control, group badge, inline edit,
   native panel, snapshot, reconcile).
2. If the change contradicts something already shipped, add or update an **Open question**
   (`OQ-*`) entry rather than silently asserting the new behaviour as fact — then resolve
   it with the user before changing code.
3. Add/adjust the test in `tests/specs/` and set the clause's `Verified by:` line to point
   at it.
4. Change `index.uc.js` to satisfy the test.
5. Run the verification steps below.

### B. Editing SPEC.md

For every clause you touch, immediately update its `Verified by:` test, or — if you are
deliberately leaving it `Unverified` — say so explicitly to the user and flag it as a gap.
Re-run the bidirectional audit (below) before finishing.

### C. Editing a test

A test must trace to a clause ID. If you find yourself asserting behaviour with no clause,
**stop**: either the behaviour belongs in `SPEC.md` (add the clause first) or the assertion
doesn't belong in the suite.

### D. Refactoring code with no behaviour change

`SPEC.md` need not change, but all clause IDs must still pass and selectors/IDs the tests
rely on (`tests/src/selectors.ts`) must stay valid. If a refactor forces a selector rename,
update `selectors.ts` too.

## Verification (run before finishing)

From `tests/`:

```sh
npm run lint        # biome
npm run typecheck   # tsc --noEmit
npm test            # headless playwright e2e (ZEN_HEADLESS=1)
```

The e2e suite drives a real Zen browser and is heavy; some `group-badge` clauses are
headed-only and self-skip headless. If you cannot run the full browser suite, say so
explicitly and at minimum run `lint` + `typecheck`, plus the bidirectional audit.

## Bidirectional audit (do this every time)

1. **SPEC → tests.** For each clause in `SPEC.md`, confirm its `Verified by:` test exists
   and actually asserts that behaviour (or it is honestly marked `Unverified`).
2. **tests → SPEC.** For each test in `tests/specs/`, confirm it maps to a clause ID. A
   test with no clause is a red flag — resolve it.
3. **SPEC → code.** Spot-check that `index.uc.js` actually implements each changed clause.
4. Report any clause that is `Unverified`, any test with no clause, and any open `OQ-*`.

## Done checklist

- [ ] Every changed behaviour has a clause in `SPEC.md` with a stable ID
- [ ] Every changed/added clause has a `Verified by:` test (or an explicit `Unverified` gap)
- [ ] Every test in `tests/specs/` traces to a clause ID
- [ ] `index.uc.js` matches the clauses it claims to implement
- [ ] `npm run lint`, `npm run typecheck`, and (if possible) `npm test` pass
- [ ] No clause contradicts another; new contradictions are filed as `OQ-*` and raised
      with the user
- [ ] `README.md` and other docs don't contradict `SPEC.md` (or the mismatch is filed as
      an `OQ-*`)
