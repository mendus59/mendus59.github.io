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
| `summarySync` | Optional. `false` stops the README sync for this card, so `tagline` and `description` stay as written here |
| `iconSync` | Optional. `false` keeps `icon` as set here instead of following the project's own icon |
| `linkSync` | Optional. `false` stops links being added or repointed automatically |
| `autoHidden` | Set by discovery on a card hidden only because it had no live site; the sync shows it once it has one |
| `readme` | Optional. `"owner/repo"` to sync the summary from a repo other than the card's GitHub source link |

## Keeping cards current

Every six hours (and on demand from the Actions tab), [`sync-summaries.yml`](.github/workflows/sync-summaries.yml)
refreshes each card from the repo in its GitHub source link, commits to `main` if anything changed, and redeploys
the site. Order, tags and the name are never touched, and a card is only ever shown automatically when discovery
hid it for having no live site (`autoHidden`), so admin-panel settings are kept.

| What | Where it comes from | Script | Opt out |
| --- | --- | --- | --- |
| Summary and bullets | The README's `site-summary` section (below) | [`sync-summaries.mjs`](scripts/sync-summaries.mjs) | `summarySync: false` |
| Icon | A file the README names with `<!-- site-icon: path/in/repo.svg -->`, else a browser extension's root `manifest.json` icon, else the live app's SVG favicon, web-manifest icon or apple-touch-icon (PNGs must be square and at least 128px). Saved as `assets/icons/<slug>.<ext>` | [`sync-cards.mjs`](scripts/sync-cards.mjs) | `iconSync: false` (set automatically when you upload an icon in the admin panel) |
| Live site | The repo's GitHub Pages site or homepage, added as the main button when the card only has GitHub links | `sync-cards.mjs` | `linkSync: false` |
| Downloads | GitHub releases: a download link whose file is gone is repointed to the newest release with that file type (in the `apps/` pages too), and a new file type (`.apk`, `.exe`/`.msi`, `.dmg`, `.AppImage`/`.deb`) gets a button | `sync-cards.mjs` | `linkSync: false` |
| Store pages | Chrome Web Store, Google Play, App Store, Firefox and Edge add-on links anywhere in the README | `sync-cards.mjs` | `linkSync: false` |

Links are only added or repointed, never removed; anything that looks broken (a Pages site that was turned off,
a download with no replacement) is listed as a warning in the run's summary. Release links that use a rolling tag
(like `releases/download/latest/app.apk`) always serve the newest build without any change here.

### The README summary section

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

## New projects

Once a day (and on demand from the Actions tab, with an optional dry run),
[`discover-projects.yml`](.github/workflows/discover-projects.yml) runs
[`scripts/discover-projects.mjs`](scripts/discover-projects.mjs), which lists the owner's public repos and adds
a card for each one that no card links to yet, then commits to `main` and redeploys the site. Forks, archived
repos, this site's repo and anything named in [`data/discover-ignore.json`](data/discover-ignore.json) (a list
of repo names) are skipped.

- A repo with a GitHub Pages site or a homepage gets a visible card whose main button opens it, plus a Source link.
- A repo with neither is added with `hidden: true` (and `autoHidden: true`, so the card sync shows it once it gets a live site), so it can be checked, given a Pages or install page, and shown
  from the admin panel.
- The summary comes from the README's site-summary section (then the card sync keeps it current), or the
  repo's GitHub description if there is none. Skills and stack come from the repo's languages and topics, and the
  card gets a generated monogram icon in `assets/icons/<slug>.svg`, which the card sync swaps for the app's own icon once it finds one.

To drop a discovered card for good, hide it, or remove it and add the repo's name to `data/discover-ignore.json`,
since a removed card comes back on the next run.

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
