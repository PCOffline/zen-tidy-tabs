---
name: no-slop
description: Keep code clean by suppressing AI slop in comments, logs, docs, and code itself. Use whenever writing or editing code, to avoid narrating implementation details, recording chat decisions, redundant docstrings, noise comments, unreadable names, type escape hatches like `as any`, hand-rolled loops, or reimplementing standard/library functions.
---

# No Slop

Write code, not commentary. The diff should speak for itself. When editing or
writing any code, apply the rules below before finishing.

## DON'T

- **Narrate the code.** No comments that restate what the next line does
  (`// increment counter`, `// loop over users`). This includes short label
  comments over an obvious branch or handler (`// left click`, `// right click`,
  `// error case`) — if the code already makes it obvious, the label adds nothing.
- **Record the conversation.** Don't turn chat decisions, "as we discussed",
  rationale for a refactor, or task context into comments, README edits, commit
  prose, or docstrings.
- **Add explanatory logs.** No `console.log` / `print` / debug logging added to
  explain or trace what code does. Only add logging that is genuinely part of
  the app's intended behavior.
- **Log nothing of diagnostic value.** A log that gives no debugging signal
  doesn't belong — and definitely not as a debug log. Don't make a log
  describe product behavior (`debug("left click renames, right click opens
  modal")`); that's documentation hiding in a log line. A debug log must report
  runtime state worth inspecting (values, counts, IDs, outcomes), not narrate
  what the feature does.
- **Use cryptic names or dense formatting.** No throwaway single-letter names
  (`b`, `z`) where a real name belongs, no minified-looking blocks (zero
  blank lines, crammed one-liners, a stray `for` loop with no context). This is
  classic AI slop: name things for what they are and keep normal spacing.
- **Write empty docstrings.** No JSDoc/docstring that just repeats the function
  name or signature and adds nothing (`@param id The id`).
- **Build comment walls.** No block of `// ----`, no comment before every line,
  no decorative dividers or em-dash/arrow annotations.
- **Leave change residue.** No "removed X", "changed to Y", "new version",
  "TODO from our chat" markers describing the edit itself.
- **Use unreadable names.** No vague or misleading identifiers (`data`, `tmp`,
  `result2`, `handleStuff`, `doIt`), no abbreviations that aren't standard in
  the domain, no names that lie about what the value holds. A name should let a
  reader predict the value's type and purpose without scanning the body.
- **Escape the type system.** No `as any`, `any`-typed params/returns, `@ts-ignore`,
  `# type: ignore`, unchecked casts, or `!` non-null assertions used to silence
  the checker. If a type is genuinely unknown, model it (`unknown` + narrowing,
  a union, a guard) instead of casting the problem away.
- **Hand-roll what the language gives you.** No manual index `for` loop to build
  an array (`for (let i...) out.push(...)`) when `map`/`filter`/`reduce`/
  comprehension says it directly, no manual accumulation when a built-in does it.
  Reach for the clear higher-level construct; drop to a raw loop only when it's
  actually clearer or required for performance.
- **Reinvent the standard library.** Don't reimplement what the language or an
  already-present dependency provides — `clamp`, `groupBy`, `debounce`, deep
  clone, `range`, date math, UUID generation, etc. Use the stdlib or a library
  the project already depends on. Don't add a new dependency just to avoid five
  obvious lines, and don't write fifty lines to avoid an existing one.

## DO

- **Let code self-document.** Prefer clear names and structure over a comment.
- **Explain *why*, rarely.** A comment is justified only when intent is
  non-obvious: a constraint, a gotcha, a tradeoff, a workaround for an external
  bug. If it explains *what*, delete it. If it explains *why* and the why isn't
  obvious from the code, keep it.
- **Keep docstrings that earn their place.** Public API docs that add real
  information (units, ranges, error conditions, side effects) are fine.
- **Match the file.** Follow the surrounding code's existing comment density and
  style. Don't introduce comments the rest of the file wouldn't have.

## Self-check before finishing

- [ ] No comment restates what the code plainly does
- [ ] No comment/doc/log records chat context or decisions
- [ ] No debug or "explanation" logs left behind
- [ ] Every docstring adds information beyond the signature
- [ ] No decorative dividers, arrow/em-dash annotations, or per-line comments
- [ ] No obvious label comments (`// left click`, `// error case`)
- [ ] Every log carries real diagnostic value; none merely describes behavior
- [ ] Names describe intent; no throwaway `b`/`z` or minified-looking blocks
- [ ] No vague/misleading names (`data`, `tmp`, `result2`, `doIt`)
- [ ] No `as any`, `@ts-ignore`, `type: ignore`, or casts that mask real types
- [ ] No hand-rolled loop where `map`/`filter`/`reduce` reads clearer
- [ ] No reimplementation of stdlib/existing-dependency helpers
- [ ] Each remaining comment explains a non-obvious *why*
