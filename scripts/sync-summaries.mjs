#!/usr/bin/env node
// Keeps each project card's summary (tagline + description bullets) in data/projects.json
// in step with the marked summary section of that project's README.
//
//   node scripts/sync-summaries.mjs           update data/projects.json from the READMEs
//   node scripts/sync-summaries.mjs --dry-run  show what would change, write nothing
//   node scripts/sync-summaries.mjs --check README.md [more.md...]
//                                              validate local READMEs' summary sections
//
// The README section looks like this (see README.md in this repo for the full rules):
//
//   <!-- site-summary:start -->
//   One-line tagline.
//
//   - First bullet.
//   - Second bullet.
//   <!-- site-summary:end -->
//
// A project is synced when it has a GitHub "Source" link (or a "readme": "owner/repo" field) and
// does not set "summarySync": false. Only "tagline" and "description" are ever written; every
// other field, and the order of projects, is left exactly as the admin panel saved it.

import { readFile, writeFile, appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const START = "<!-- site-summary:start -->";
export const END = "<!-- site-summary:end -->";
const DATA_PATH = new URL("../data/projects.json", import.meta.url);
const MAX_TAGLINE = 160;
const MAX_BULLETS = 6;

// Markdown → the plain text the cards show (they escape HTML and render no markdown).
function plain(s) {
  return s
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "") // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url)
    .replace(/<\/?[a-z][^>]*>/gi, "") // stray inline HTML
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1$2")
    .replace(/\\([\\`*_{}[\]()#+\-.!>])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** Returns { tagline, description } from a README's text, or throws with a readable reason. */
export function parseSummary(markdown) {
  const text = markdown.replace(/\r\n?/g, "\n");
  const a = text.indexOf(START);
  if (a === -1) throw new Error(`no ${START} marker`);
  const b = text.indexOf(END, a);
  if (b === -1) throw new Error(`no ${END} marker after the start marker`);
  if (text.indexOf(START, a + START.length) !== -1) throw new Error("more than one summary section");
  const body = text.slice(a + START.length, b).replace(/<!--[\s\S]*?-->/g, "");

  const taglineLines = [];
  const bullets = [];
  for (const raw of body.split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) continue;
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) bullets.push(bullet[1]);
    else if (bullets.length && /^\s{2,}\S/.test(line)) bullets[bullets.length - 1] += " " + line.trim();
    else if (bullets.length) throw new Error("text after the bullets; put the one-line summary first");
    else taglineLines.push(line.replace(/^\s*>\s?/, "").replace(/^#+\s*/, ""));
  }
  const tagline = plain(taglineLines.join(" "));
  const description = bullets.map(plain).filter(Boolean);
  if (!tagline) throw new Error("missing the one-line summary before the bullets");
  if (tagline.length > MAX_TAGLINE) throw new Error(`one-line summary is ${tagline.length} characters (max ${MAX_TAGLINE})`);
  if (!description.length) throw new Error("no bullet points");
  if (description.length > MAX_BULLETS) throw new Error(`${description.length} bullets (max ${MAX_BULLETS})`);
  return { tagline, description };
}

/** "owner/repo" this project's summary comes from, or null. */
export function sourceRepo(project) {
  if (project.summarySync === false) return null;
  if (typeof project.readme === "string" && /^[\w.-]+\/[\w.-]+$/.test(project.readme)) return project.readme;
  for (const link of project.links ?? []) {
    const m = String(link.url ?? "").match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
    if (m) return `${m[1]}/${m[2]}`;
  }
  return null;
}

async function fetchReadme(repo) {
  const headers = { Accept: "application/vnd.github.raw+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "site-summary-sync" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com/repos/${repo}/readme`, { headers });
  if (res.status === 404) throw new Error("no README (or the repo isn't public)");
  if (!res.ok) throw new Error(`GitHub API ${res.status} ${res.statusText}`);
  return res.text();
}

async function check(files) {
  let failed = false;
  for (const file of files) {
    try {
      const { tagline, description } = parseSummary(await readFile(file, "utf8"));
      console.log(`✓ ${file}\n  ${tagline}\n${description.map((d) => `  • ${d}`).join("\n")}`);
    } catch (err) {
      failed = true;
      console.error(`✗ ${file}: ${err.message}`);
    }
  }
  process.exit(failed ? 1 : 0);
}

export async function sync({ dryRun }) {
  const original = await readFile(DATA_PATH, "utf8");
  const projects = JSON.parse(original);
  const report = [];
  for (const p of projects) {
    const repo = sourceRepo(p);
    if (!repo) {
      report.push(`- **${p.name}**: skipped (${p.summarySync === false ? "sync turned off" : "no GitHub source link"})`);
      continue;
    }
    try {
      const next = parseSummary(await fetchReadme(repo));
      const changed = p.tagline !== next.tagline || JSON.stringify(p.description ?? []) !== JSON.stringify(next.description);
      if (changed) {
        p.tagline = next.tagline;
        p.description = next.description;
      }
      report.push(`- **${p.name}** (${repo}): ${changed ? "updated" : "already current"}`);
    } catch (err) {
      // Keep whatever the card says now; a broken or missing README section never blanks a card.
      report.push(`- **${p.name}** (${repo}): ⚠️ kept the current summary (README: ${err.message})`);
    }
  }
  const updated = JSON.stringify(projects, null, 2) + "\n";
  const changed = updated !== original;
  if (changed && !dryRun) await writeFile(DATA_PATH, updated);

  const summary = `## Project summary sync\n\n${report.join("\n")}\n\n${changed ? (dryRun ? "Would update" : "Updated") + " data/projects.json." : "No changes."}\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

const args = process.argv.slice(2);
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (args[0] === "--check") await check(args.slice(1).length ? args.slice(1) : ["README.md"]);
  else await sync({ dryRun: args.includes("--dry-run") });
}
