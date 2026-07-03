---
name: minimal-scope
description: Enforce minimal viable scope on every feature, change, or task. Assume the smallest reasonable scope, never touch files or sections outside it without explicit permission, and ask clarifying questions to pin down scope first. Use when the user requests a feature, change, fix, or task.
---

# Minimal Scope

By default, assume the **minimal viable scope** for any request. Do the task that was asked, and nothing more.

## Core rules

1. **Smallest reasonable scope wins.** Implement only what is needed to satisfy the explicit request. Do not expand scope based on what you think would be nice, complete, or "while we're here."
2. **Never touch out-of-scope files or sections without explicit permission.** If completing the task seems to require changing files, modules, or sections outside the agreed scope, stop and ask before doing so.
3. **Related ≠ in scope.** Adjacent work is not implied. Examples that are *out* of scope unless explicitly requested:
   - Adding tests does **not** include updating the README or docs.
   - Fixing a bug does **not** include refactoring surrounding code.
   - Adding a feature does **not** include updating changelogs, version numbers, or unrelated config.
4. **Surface, don't act.** If you spot unrelated issues, improvements, or risks, finish the in-scope task first, then mention them separately. Do not silently fix or work around them.

## Clarify scope before starting

When a request is vague, broad, or has multiple valid interpretations, ask before coding. Confirm:

- **Which files / modules / components** are in scope, and which are explicitly out.
- **Whether adjacent artifacts are included**: tests, docs/README, types, config, migrations, call sites.
- **Edge cases and behaviors** the change must (and must not) cover.
- **Depth**: a targeted fix vs. a broader refactor.

If the answers are obvious from the request, proceed. If not, ask a focused question rather than guessing.

## When in doubt

Prefer asking over assuming. A smaller change that needs a follow-up is safer than a large change that overstepped. Expanding scope is cheap once approved; reverting unwanted changes is not.
