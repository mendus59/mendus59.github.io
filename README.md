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

## Admin panel

[`/admin/`](https://mendus59.github.io/admin/) edits `data/projects.json` in the browser:
show or hide, add, edit, reorder and remove projects, upload icons, and preview each card.
Publishing makes one commit to `main` through the GitHub API, which redeploys the site.

There is no server and no secret in this repo. Sign in with your own
[fine-grained token](https://github.com/settings/personal-access-tokens/new) limited to this
repository with **Contents: Read and write**. The token is kept only in that browser
(for the tab, or until you sign out if you tick "Remember on this device").
Hidden projects are still in the public JSON file, so don't put anything secret in one.

## Run locally

Any static server works, for example `python -m http.server` from the repo root.
