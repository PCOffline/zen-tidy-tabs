# AGENTS.md

## Source of truth

`SPEC.md` at the repo root is the single source of truth for the product's
behaviour. Tests under `tests/specs/` exist only to verify `SPEC.md` clauses.
Any behaviour change flows **SPEC.md → tests/specs → index.uc.js**, in that
order, in the same change. Use the `spec-sync` skill (see below) whenever you
touch behaviour, `SPEC.md`, the tests, or `index.uc.js`.

## Agent skills

### Spec sync

Keep `SPEC.md`, the tests, and the code in lockstep. See `.agents/skills/spec-sync/SKILL.md`.

### Issue tracker

Issues are tracked as GitHub issues on `PCOffline/zen-tidy-tabs` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, each mapped to its default label string. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
