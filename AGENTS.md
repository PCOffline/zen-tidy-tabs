# AGENTS.md

## Source of truth

`docs/SPEC.md` is the single source of truth for the product's
behaviour. Tests under `tests/specs/` exist only to verify `docs/SPEC.md` clauses.
Any behaviour change flows **docs/SPEC.md → tests/specs → index.uc.js**, in that
order, in the same change. Use the `spec-sync` skill (see below) whenever you
touch behaviour, `docs/SPEC.md`, the tests, or `index.uc.js`.

## Agent skills

### Spec sync

Keep `SPEC.md`, the tests, and the code in lockstep. See `.agents/skills/spec-sync/SKILL.md`.

### Issue tracker

Issues are tracked as GitHub issues on `PCOffline/zen-tidy-tabs` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Domain docs

This repo has **no** `CONTEXT.md` or `docs/adr/` yet. The `grill-with-docs` and
`improve-codebase-architecture` skills create them lazily when domain terms or
decisions are actually resolved. Until then, treat their absence as normal — see
`docs/agents/domain.md` for how the skills consume them once they exist.
