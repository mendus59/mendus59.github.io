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

## Run locally

Any static server works, for example `python -m http.server` from the repo root.
