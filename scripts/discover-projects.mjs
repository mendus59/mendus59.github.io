#!/usr/bin/env node
// Finds the owner's public GitHub repos that have no card yet and adds a card for each to
// data/projects.json, in the same shape as the hand-made cards (see "Adding a project" in README.md).
//
//   node scripts/discover-projects.mjs            add cards for new repos
//   node scripts/discover-projects.mjs --dry-run  show what would be added, write nothing
//
// Which repos get a card:
//   - public, not a fork, not archived, not this site's own repo, not in data/discover-ignore.json;
//   - not already on a card (any card link to github.com/<owner>/<repo> or <owner>.github.io/<repo>,
//     or a "readme" field naming it, counts, hidden cards included).
// A repo with a GitHub Pages site (or a homepage) gets a visible card that links to it. A repo with
// neither is added hidden, so it can be checked and shown from the admin panel (or given a Pages site).
//
// The card's summary comes from the README's site-summary section when it has one (the same section
// sync-summaries.mjs keeps in step every day), otherwise from the repo's GitHub description.
// Skills and stack come from the repo's languages and topics, and each card gets a generated
// monogram icon under assets/icons/ that can be replaced from the admin panel.

import { readFile, writeFile, appendFile, access } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseSummary } from "./sync-summaries.mjs";

const ROOT = new URL("../", import.meta.url);
const DATA_PATH = new URL("data/projects.json", ROOT);
const IGNORE_PATH = new URL("data/discover-ignore.json", ROOT);
const OWNER = process.env.SITE_OWNER || process.env.GITHUB_REPOSITORY_OWNER || "mendus59";
const SITE_REPO = `${OWNER}.github.io`.toLowerCase();

// Language → the skill chip already used on the site. Anything else is used as-is.
const LANGUAGE_SKILL = { "Jupyter Notebook": "Python", Vue: "JavaScript", Svelte: "JavaScript" };
const MARKUP = new Set(["HTML", "CSS", "SCSS", "Less", "Shell", "PowerShell", "Batchfile", "Dockerfile", "Makefile", "Procfile"]);
// Repo topic → skill chip.
const TOPIC_SKILL = {
  react: "React",
  firebase: "Firebase",
  supabase: "Postgres",
  postgres: "Postgres",
  postgresql: "Postgres",
  pwa: "PWA",
  game: "Game development",
  gamedev: "Game development",
  "game-development": "Game development",
  android: "Mobile apps",
  ios: "Mobile apps",
  "react-native": "Mobile apps",
  "chrome-extension": "Browser extensions",
  "browser-extension": "Browser extensions",
  maps: "Maps & geospatial",
  gis: "Maps & geospatial",
  geospatial: "Maps & geospatial",
  "machine-learning": "AI & machine learning",
  ai: "AI & machine learning",
  llm: "AI & machine learning",
};

const api = async (path, accept = "application/vnd.github+json") => {
  const headers = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "site-project-discovery" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status} ${res.statusText}`);
  return accept.includes("raw") ? res.text() : res.json();
};

async function listRepos() {
  const repos = [];
  for (let page = 1; ; page++) {
    const batch = await api(`/users/${OWNER}/repos?type=owner&per_page=100&page=${page}`);
    if (!batch?.length) break;
    repos.push(...batch);
    if (batch.length < 100) break;
  }
  return repos;
}

/** Lower-case "owner/repo" names every existing card already points at. */
export function listedRepos(projects, owner = OWNER) {
  const seen = new Set();
  const o = owner.toLowerCase();
  for (const p of projects) {
    if (typeof p.readme === "string") seen.add(p.readme.toLowerCase());
    for (const l of p.links ?? []) {
      const url = String(l.url ?? "").toLowerCase();
      let m = url.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:[/?#]|$)/);
      if (m) seen.add(`${m[1]}/${m[2]}`);
      m = url.match(/^https:\/\/([\w-]+)\.github\.io\/([\w.-]+)/);
      if (m) seen.add(`${m[1]}/${m[2]}`);
    }
  }
  seen.add(`${o}/${o}.github.io`);
  return seen;
}

const slugify = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "project";

/** "costal_forager" → "Costal Forager", "TideWidget" → "Tide Widget". */
export function humanize(name) {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** The README's first "# Heading", if it reads like a product name. */
function readmeTitle(md) {
  const m = md?.match(/^#\s+(.+?)\s*#*\s*$/m);
  if (!m) return null;
  const t = m[1].replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").trim();
  return t && t.length <= 40 ? t : null;
}

// A rounded-square monogram, coloured from the repo name so it stays the same between runs.
export function monogramSvg(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  const letters = (name.match(/\b\p{L}|\p{Lu}/gu) ?? [name[0] ?? "?"]).slice(0, 2).join("").toUpperCase();
  const size = letters.length > 1 ? 24 : 30;
  const esc = letters.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="hsl(${hue} 45% 32%)"/><circle cx="50" cy="14" r="5" fill="hsl(${(hue + 40) % 360} 70% 70%)"/><text x="32" y="33" dominant-baseline="central" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,sans-serif" font-size="${size}" font-weight="700" fill="#f4f1e8">${esc}</text></svg>\n`;
}

const exists = (url) => access(url).then(() => true, () => false);

async function buildCard(repo, taken) {
  const full = repo.full_name;
  const [readme, languages, workflows] = await Promise.all([
    api(`/repos/${full}/readme`, "application/vnd.github.raw+json").catch(() => null),
    api(`/repos/${full}/languages`).catch(() => ({})),
    api(`/repos/${full}/contents/.github/workflows`).catch(() => null),
  ]);

  const name = readmeTitle(readme) ?? humanize(repo.name);
  let slug = slugify(repo.name);
  for (let i = 2; taken.has(slug); i++) slug = `${slugify(repo.name)}-${i}`;
  taken.add(slug);

  let tagline = (repo.description ?? "").trim();
  let description = [];
  let summaryNote = "no site-summary section in the README, used the repo description";
  if (readme) {
    try {
      ({ tagline, description } = parseSummary(readme));
      summaryNote = "summary from the README";
    } catch (err) {
      summaryNote = `README summary not used (${err.message}), used the repo description`;
    }
  } else summaryNote = "no README, used the repo description";
  if (!tagline) tagline = `${name}, a project by ${OWNER}.`;

  const total = Object.values(languages ?? {}).reduce((a, b) => a + b, 0) || 1;
  const langs = Object.entries(languages ?? {})
    .sort((a, b) => b[1] - a[1])
    .filter(([, bytes]) => bytes / total >= 0.05)
    .map(([lang]) => lang);
  const skills = [];
  const add = (s) => s && !skills.includes(s) && skills.push(s);
  langs.filter((l) => !MARKUP.has(l)).slice(0, 2).forEach((l) => add(LANGUAGE_SKILL[l] ?? l));
  if (!skills.length && langs.length) add(LANGUAGE_SKILL[langs[0]] ?? langs[0]);
  (repo.topics ?? []).forEach((t) => add(TOPIC_SKILL[t]));
  if (Array.isArray(workflows) && workflows.length) add("GitHub Actions");
  const stack = langs.slice(0, 5);

  const homepage = /^https?:\/\//i.test(repo.homepage ?? "") ? repo.homepage.trim() : "";
  const pagesUrl = repo.has_pages ? `https://${OWNER.toLowerCase()}.github.io/${repo.name}/` : "";
  const live = homepage || pagesUrl;
  const source = { label: "Source", url: repo.html_url };
  const links = live ? [{ label: `Open ${name}`, url: live, primary: true }, source] : [{ ...source, primary: true }];

  const iconPath = `assets/icons/${slug}.svg`;
  const card = { slug, name, tagline, description, icon: iconPath, skills, stack, links };
  if (!live) card.hidden = true;
  return { card, icon: monogramSvg(name), iconPath, summaryNote };
}

export async function discover({ dryRun }) {
  const original = await readFile(DATA_PATH, "utf8");
  const projects = JSON.parse(original);
  const ignore = new Set(
    (await readFile(IGNORE_PATH, "utf8").then(JSON.parse, () => [])).map((r) => String(r).toLowerCase().replace(/^[^/]+\//, "")),
  );
  const listed = listedRepos(projects);
  const taken = new Set(projects.map((p) => p.slug));

  const report = [];
  const candidates = [];
  for (const r of await listRepos()) {
    const key = r.full_name.toLowerCase();
    let why = null;
    if (r.private) why = "private";
    else if (r.fork) why = "fork";
    else if (r.archived) why = "archived";
    else if (r.name.toLowerCase() === SITE_REPO) why = "this site";
    else if (ignore.has(r.name.toLowerCase())) why = "in data/discover-ignore.json";
    else if (listed.has(key)) why = "already has a card";
    if (why) report.push(`- ${r.name}: skipped (${why})`);
    else candidates.push(r);
  }

  const added = [];
  for (const r of candidates) {
    const { card, icon, iconPath, summaryNote } = await buildCard(r, taken);
    added.push(card);
    if (!dryRun) {
      const iconUrl = new URL(iconPath, ROOT);
      if (!(await exists(iconUrl))) await writeFile(iconUrl, icon);
    }
    report.unshift(
      `- **${card.name}** (${r.full_name}): ➕ added${card.hidden ? " as a **hidden** card (no Pages site or homepage yet; show it from the admin panel)" : ""}; ${summaryNote}`,
    );
  }

  if (added.length && !dryRun) await writeFile(DATA_PATH, JSON.stringify([...projects, ...added], null, 2) + "\n");
  const summary = `## Project discovery\n\n${report.join("\n") || "- No public repos found."}\n\n${
    added.length ? `${dryRun ? "Would add" : "Added"} ${added.length} card(s) to data/projects.json.` : "No new projects."
  }\n`;
  console.log(summary);
  if (dryRun && added.length) console.log(JSON.stringify(added, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `added=${added.map((c) => c.name).join(", ")}\n`);
  return added;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await discover({ dryRun: process.argv.includes("--dry-run") });
}
