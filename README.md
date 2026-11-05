# mendus59.github.io

Pat Mendus's project showcase, served by GitHub Pages at <https://mendus59.github.io/>.

Plain HTML, CSS and JavaScript with no build step. The project cards are generated from
[`data/projects.json`](data/projects.json).

## Adding a project

Add an entry to `data/projects.json`:

| Field | Meaning |
| --- | --- |
| `slug` | Short id, also the card's `#anchor` |
| `name`, `tagline` | Card title and one-line summary |
| `description` | A few short sentences, one per bullet |
| `icon` | Path to a square image under `assets/icons/` |
| `skills` | Broad skills; these become the filter chips |
| `stack` | Specific tools and libraries |
| `links` | Buttons; mark the main one `"primary": true` |
| `private` | Optional. `true` shows a "Private" badge; give no source link |
| `hidden` | Optional. `true` keeps the entry in the file but off the public page |
| `summarySync` | Optional. `false` stops the daily README sync for this card, so `tagline` and `description` stay as written here |
| `readme` | Optional. `"owner/repo"` to sync the summary from a repo other than the card's GitHub source link |

## Project summaries

Each card's `tagline` and `description` come from its project's README. Once a day (and on demand from the
Actions tab), [`sync-summaries.yml`](.github/workflows/sync-summaries.yml) runs
[`scripts/sync-summaries.mjs`](scripts/sync-summaries.mjs), which reads the README of the repo in the card's
GitHub source link, copies the marked section below into `data/projects.json`, commits to `main` if anything
changed, and redeploys the site. Nothing else in the file is touched, so admin-panel settings (order, hidden,
links, icons, tags) are kept.

```markdown
<!-- site-summary:start -->
One-line summary, plain text, at most 160 characters.

- One to six short bullets.
- Links and bold are stripped; nothing may follow the bullets.
<!-- site-summary:end -->
```

If a README has no section, or it is malformed, the card keeps its current text and the run's summary shows a
warning. Cards with `summarySync: false`, or without a GitHub source link, are written by hand (in the admin
panel or here). To check a README locally: `node scripts/sync-summaries.mjs --check path/to/README.md`.

Each project repo has a `Site summary` workflow that checks the section on every pull request, and a
`CLAUDE.md` note asking for the section to be updated whenever user-facing features change.

## Admin panel

[`/admin/`](https://mendus59.github.io/admin/) edits `data/projects.json` in the browser:
show or hide, add, edit, reorder and remove projects, upload icons, and preview each card.
A card whose summary syncs from a README shows its summary and description read-only; untick
"Keep the summary in sync with the project's README" to write them by hand instead.
Publishing makes one commit to `main` through the GitHub API, which redeploys the site.

There is no server and no secret in this repo. Sign in with your own
[fine-grained token](https://github.com/settings/personal-access-tokens/new) limited to this
repository with **Contents: Read and write**. The token is kept only in that browser
(for the tab, or until you sign out if you tick "Remember on this device").
Hidden projects are still in the public JSON file, so don't put anything secret in one.

## Run locally

Any static server works, for example `python -m http.server` from the repo root.
