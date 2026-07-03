# Releasing

Releases are cut with [`release-it`](https://github.com/release-it/release-it),
driven from the root `package.json`. The version in `package.json` is the source
of truth; on every release a hook syncs it into the two places the script is
actually consumed:

- the `@version` line of the `index.uc.js` UserScript header, and
- the `version` field of `theme.json` (Sine reads this to offer auto-updates).

## One-time setup

```sh
npm install
```

Creating the GitHub Release needs a token with `repo` (or fine-grained
`contents: write`) scope, exposed as `GITHUB_TOKEN`. Save it once in a
gitignored `.env` file at the repo root and the release scripts pick it up
automatically (via Node's `--env-file-if-exists`):

```sh
echo "GITHUB_TOKEN=ghp_..." >> .env
```

Alternatively, export it in your shell instead of using `.env`:

```sh
export GITHUB_TOKEN=ghp_...      # PowerShell: $env:GITHUB_TOKEN = "ghp_..."
```

## Cut a release

Pick the bump level — interactively:

```sh
npm run release            # release-it prompts: patch / minor / major / pre-release …
```

…or explicitly:

```sh
npm run release -- patch                      # 1.2.3 -> 1.2.4
npm run release -- minor                      # 1.2.3 -> 1.3.0
npm run release -- major                      # 1.2.3 -> 2.0.0
npm run release -- --preRelease=beta          # 1.2.3 -> 1.2.4-beta.0  (repeat -> -beta.1)
npm run release -- minor --preRelease=beta    # 1.2.3 -> 1.3.0-beta.0
```

`release-it` then:

1. bumps `package.json`,
2. runs `scripts/set-version.mjs` to sync `index.uc.js` and `theme.json`,
3. commits `Release vX.Y.Z` and creates an annotated `vX.Y.Z` tag,
4. pushes, and
5. creates the GitHub Release with auto-generated notes and `index.uc.js` +
   `theme.json` attached.

Tags with a pre-release suffix (e.g. `v1.2.4-beta.0`) are marked as
pre-releases on GitHub and are not shown as "latest".

### Dry run

Preview everything without changing or pushing anything:

```sh
npm run release:dry -- minor
```

Your working tree must be clean before releasing (`requireCleanWorkingDir`);
commit or stash other changes first.

## Changelog / release notes

Notes are GitHub's auto-generated notes (`github.autoGenerate`), built from the
pull requests merged since the previous tag and grouped by PR label per
[`.github/release.yml`](../.github/release.yml). Label PRs (`enhancement`,
`bug`, `documentation`, …) so they land in the right section; unlabelled PRs
fall under "Other changes".

## Configuration

- [`.release-it.json`](../.release-it.json) — release-it config (commit/tag
  format, GitHub release + assets, the `after:bump` hook).
- [`scripts/set-version.mjs`](../scripts/set-version.mjs) — the hook that writes
  the version into `index.uc.js` and `theme.json` and stages them.

> Releases run locally. If you'd prefer a CI-triggered pipeline (a
> `workflow_dispatch` button in the Actions tab that runs `release-it`), that
> can be added on top of this setup.
