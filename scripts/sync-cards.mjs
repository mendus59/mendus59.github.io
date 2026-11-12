#!/usr/bin/env node
// Keeps each project card's icon and links in data/projects.json in step with the project itself.
// (The summary and bullets are kept in step by sync-summaries.mjs; this script does everything else.)
//
//   node scripts/sync-cards.mjs            update data/projects.json, assets/icons/ and apps/ pages
//   node scripts/sync-cards.mjs --dry-run  show what would change, write nothing
//
// For every card with a GitHub source link (or "readme": "owner/repo"):
//
// Icon (turn off per card with "iconSync": false; uploading an icon in the admin panel does that):
//   1. a file the README names with <!-- site-icon: path/in/repo.svg --> (or a full https:// URL), else
//   2. the icon of a browser extension's manifest.json at the repo root, else
//   3. the live app's own icon: an SVG favicon, the largest web-manifest icon, or the apple-touch-icon.
//   Raster icons must be PNG, at least 128px and square. The icon is saved as assets/icons/<slug>.<ext>.
//   If nothing qualifies, the card keeps the icon it has.
//
// Links (turn off per card with "linkSync": false):
//   - The live site: when the repo gains a GitHub Pages site or a homepage and the card has nothing
//     but GitHub links, an "Open <name>" main button is added. A card that discovery hid only because
//     it had no live site ("autoHidden": true) is shown.
//   - Downloads: a release-download link whose file is gone from its release is pointed at the newest
//     release that has a file of the same type (also in the apps/ About & install pages). A release file
//     type the card doesn't offer yet (.apk, .exe/.msi, .dmg, .AppImage/.deb) gets a download button.
//   - Store pages: Chrome Web Store, Google Play, App Store, Firefox and Edge add-on links found in the
//     README get a button if the card doesn't have one for that store.
//   Links are only ever added or repointed, never removed; anything that looks broken is reported.

import { readFile, writeFile, appendFile, readdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { cardRepo } from "./sync-summaries.mjs";

const ROOT = new URL("../", import.meta.url);
const DATA_PATH = new URL("data/projects.json", ROOT);
const MAX_ICON_BYTES = 512 * 1024;
const MIN_ICON_PX = 128;

const DOWNLOAD_KINDS = [
  { kind: "apk", test: /\.apk$/i, label: "Download Android APK" },
  { kind: "windows", test: /\.(exe|msi)$/i, label: "Download for Windows" },
  { kind: "mac", test: /\.dmg$/i, label: "Download for macOS" },
  { kind: "linux", test: /\.(appimage|deb)$/i, label: "Download for Linux" },
];

const STORES = [
  { host: /^(chromewebstore\.google\.com|chrome\.google\.com)$/, path: /\/detail\//, label: "Add to Chrome" },
  { host: /^play\.google\.com$/, path: /\/store\/apps\/details/, label: "Get it on Google Play" },
  { host: /^apps\.apple\.com$/, path: /\/app\//, label: "Download on the App Store" },
  { host: /^addons\.mozilla\.org$/, path: /\/addon\//, label: "Add to Firefox" },
  { host: /^microsoftedge\.microsoft\.com$/, path: /\/addons\/detail\//, label: "Add to Edge" },
];

// ---------- small helpers (exported for tests) ----------

/** Width and height of a PNG, or null if it isn't one. */
export function pngSize(buf) {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47 || buf.toString("ascii", 12, 16) !== "IHDR") return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const isSvg = (buf) => /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype[^>]*>\s*)?<svg[\s>]/i.test(buf.subarray(0, 4096).toString("utf8"));

/** "svg" | "png" | null — whether these bytes are usable as a card icon. */
export function iconKind(buf) {
  if (!buf?.length || buf.length > MAX_ICON_BYTES) return null;
  if (isSvg(buf)) return "svg";
  const s = pngSize(buf);
  if (s && Math.min(s.w, s.h) >= MIN_ICON_PX && Math.abs(s.w - s.h) <= s.w * 0.1) return "png";
  return null;
}

const attrs = (tag) =>
  Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)].map((m) => [m[1].toLowerCase(), m[2] ?? m[3] ?? m[4]]));

/** Icon candidates named by an HTML page, best first: SVG favicon, then manifest, apple-touch, PNG favicon. */
export function pageIconRefs(html) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map((m) => attrs(m[0]));
  const rel = (l) => String(l.rel ?? "").toLowerCase().split(/\s+/);
  const usable = (l) => l.href && !/data:/i.test(l.href.slice(0, 8));
  const refs = [];
  for (const l of links) if (usable(l) && rel(l).includes("icon") && (/svg/i.test(l.type ?? "") || /\.svg(\?|$)/i.test(l.href))) refs.push({ type: "href", href: l.href });
  for (const l of links) if (usable(l) && rel(l).includes("manifest")) refs.push({ type: "manifest", href: l.href });
  for (const l of links) if (usable(l) && rel(l).some((r) => r.startsWith("apple-touch-icon"))) refs.push({ type: "href", href: l.href });
  for (const l of links) if (usable(l) && rel(l).includes("icon") && !refs.some((r) => r.href === l.href)) refs.push({ type: "href", href: l.href });
  return refs;
}

/** Web-manifest / extension-manifest icons, largest first (SVG and "any" purpose preferred). */
export function manifestIconSrcs(manifest) {
  const list = [];
  if (Array.isArray(manifest?.icons)) {
    for (const i of manifest.icons) {
      if (!i?.src || /^data:/i.test(i.src)) continue;
      if (i.purpose && !String(i.purpose).split(/\s+/).includes("any")) continue;
      const svg = /svg/i.test(i.type ?? "") || /\.svg(\?|$)/i.test(i.src);
      const size = svg ? Infinity : Math.max(0, ...String(i.sizes ?? "").split(/\s+/).map((s) => parseInt(s, 10) || 0));
      list.push({ src: i.src, size });
    }
  } else if (manifest?.icons && typeof manifest.icons === "object") {
    // browser extension: { "16": "icons/16.png", "128": "icons/128.png" }
    for (const [size, src] of Object.entries(manifest.icons)) list.push({ src, size: parseInt(size, 10) || 0 });
  }
  return list.sort((a, b) => b.size - a.size).map((i) => i.src);
}

/** The path or URL a README names with <!-- site-icon: ... -->, or null. */
export const readmeIconRef = (md) => md?.match(/<!--\s*site-icon:\s*(\S+?)\s*-->/i)?.[1] ?? null;

/** Store links (deduped by store) in a README. */
export function storeLinks(md) {
  const found = [];
  for (const m of String(md ?? "").matchAll(/https:\/\/[^\s)<>"'\]]+/g)) {
    let u;
    try {
      u = new URL(m[0].replace(/[.,;:!?]+$/, ""));
    } catch {
      continue;
    }
    const store = STORES.find((s) => s.host.test(u.hostname) && s.path.test(u.pathname));
    if (store && !found.some((f) => f.store === store)) found.push({ store, url: u.href });
  }
  return found;
}

const norm = (u) => String(u ?? "").trim().toLowerCase().replace(/[?#].*$/, "").replace(/\/+$/, "");
const isGitHub = (u) => /^https:\/\/github\.com\//i.test(u ?? "");

/** {tag, asset} | {latest:true, asset} for a release-download link of this repo, else null. */
export function parseDownload(url, repo) {
  const m = String(url ?? "").match(/^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/releases\/(?:download\/([^/]+)|latest\/download)\/([^/?#]+)$/i);
  if (!m || m[1].toLowerCase() !== repo.toLowerCase()) return null;
  return { tag: m[2] ? decodeURIComponent(m[2]) : null, asset: decodeURIComponent(m[3]) };
}

/** Where a new link goes: before the repo's Source link if there is one, else at the end. */
function insertLink(links, link, repo) {
  const i = links.findIndex((l) => norm(l.url) === norm(`https://github.com/${repo}`));
  if (i === -1) links.push(link);
  else links.splice(i, 0, link);
}

// ---------- network ----------

async function api(path, accept = "application/vnd.github+json") {
  const headers = { Accept: accept, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "site-card-sync" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  const res = await fetch(`https://api.github.com${path}`, { headers });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status} ${res.statusText}`);
  return accept.includes("raw") ? Buffer.from(await res.arrayBuffer()) : res.json();
}

async function get(url) {
  const res = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(15000), headers: { "User-Agent": "site-card-sync" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return { buf: Buffer.from(await res.arrayBuffer()), url: res.url };
}

const repoFile = (repo, path) =>
  api(`/repos/${repo}/contents/${path.replace(/^\.?\//, "").split("/").map(encodeURIComponent).join("/")}`, "application/vnd.github.raw+json");

// ---------- icon ----------

async function findIcon({ repo, readme, live }) {
  const tried = [];
  const accept = async (from, load) => {
    try {
      const buf = await load();
      const kind = iconKind(buf);
      if (kind) return { buf, kind, from };
      tried.push(`${from} (not an SVG or a square PNG of ${MIN_ICON_PX}px or more)`);
    } catch (err) {
      tried.push(`${from} (${err.message})`);
    }
    return null;
  };

  const declared = readmeIconRef(readme);
  if (declared) {
    const hit = await accept(`README site-icon ${declared}`, () =>
      /^https:\/\//i.test(declared) ? get(declared).then((r) => r.buf) : repoFile(repo, declared).then((b) => b ?? Promise.reject(new Error("not found"))),
    );
    if (hit) return hit;
  }

  const ext = await repoFile(repo, "manifest.json").then((b) => b && JSON.parse(b.toString("utf8")), () => null);
  if (ext?.manifest_version) {
    for (const src of manifestIconSrcs(ext)) {
      const hit = await accept(`extension manifest ${src}`, () => repoFile(repo, src).then((b) => b ?? Promise.reject(new Error("not found"))));
      if (hit) return hit;
    }
  }

  if (live) {
    let page;
    try {
      page = await get(live);
    } catch (err) {
      tried.push(`live site ${live} (${err.message})`);
    }
    if (page) {
      for (const ref of pageIconRefs(page.buf.toString("utf8"))) {
        const abs = new URL(ref.href, page.url).href;
        if (ref.type === "manifest") {
          let manifest;
          try {
            manifest = JSON.parse((await get(abs)).buf.toString("utf8"));
          } catch (err) {
            tried.push(`web manifest ${abs} (${err.message})`);
            continue;
          }
          for (const src of manifestIconSrcs(manifest)) {
            const hit = await accept(`web manifest icon ${new URL(src, abs).href}`, () => get(new URL(src, abs).href).then((r) => r.buf));
            if (hit) return hit;
          }
        } else {
          const hit = await accept(`live site icon ${abs}`, () => get(abs).then((r) => r.buf));
          if (hit) return hit;
        }
      }
    }
  }
  return { tried };
}

// ---------- main ----------

export async function syncCards({ dryRun }) {
  const original = await readFile(DATA_PATH, "utf8");
  const projects = JSON.parse(original);
  const report = [];
  const iconWrites = new Map(); // relative path -> Buffer
  const urlMoves = []; // [oldUrl, newUrl] to apply to the apps/ pages too

  for (const p of projects) {
    const repo = cardRepo(p);
    if (!repo) {
      report.push(`- **${p.name}**: skipped (no GitHub source link)`);
      continue;
    }
    const notes = [];
    try {
      const info = await api(`/repos/${repo}`);
      if (!info || info.private) throw new Error("repo not found or not public");
      const readme = await api(`/repos/${repo}/readme`, "application/vnd.github.raw+json").then((b) => b?.toString("utf8") ?? "", () => "");
      const homepage = /^https?:\/\//i.test(info.homepage ?? "") ? info.homepage.trim() : "";
      const owner = info.owner.login.toLowerCase();
      const pagesUrl = info.has_pages ? `https://${owner}.github.io/${info.name}/` : "";
      const liveNow = homepage || pagesUrl;
      const links = (p.links ??= []);
      const cardLive = links.find((l) => /^https?:\/\//i.test(l.url) && !isGitHub(l.url))?.url ?? "";

      // ----- icon -----
      if (p.iconSync !== false) {
        const found = await findIcon({ repo, readme, live: cardLive || liveNow });
        if (found.buf) {
          const path = `assets/icons/${p.slug}.${found.kind}`;
          const current = p.icon && !/^https?:/i.test(p.icon) ? await readFile(new URL(p.icon, ROOT)).catch(() => null) : null;
          if (p.icon === path && current?.equals(found.buf)) {
            // already current
          } else if (current?.equals(found.buf)) {
            // same picture under another name; leave the card alone
          } else {
            iconWrites.set(path, found.buf);
            p.icon = path;
            notes.push(`icon updated from the ${found.from}`);
          }
        } else if (found.tried.length) {
          notes.push(`kept the current icon (looked at: ${found.tried.slice(0, 4).join("; ")})`);
        }
      }

      if (p.linkSync !== false) {
        // ----- live site -----
        if (liveNow && links.every((l) => isGitHub(l.url))) {
          if (!links.some((l) => norm(l.url) === norm(liveNow))) {
            links.forEach((l) => delete l.primary);
            links.unshift({ label: `Open ${p.name}`, url: liveNow, primary: true });
            notes.push(`added the live site ${liveNow}`);
          }
          if (p.autoHidden) {
            delete p.hidden;
            delete p.autoHidden;
            notes.push("now shown (it has a live site)");
          }
        }
        const pagesLink = links.find((l) => norm(l.url) === norm(`https://${owner}.github.io/${info.name}`));
        if (pagesLink && !info.has_pages) notes.push(`⚠️ "${pagesLink.label}" points at a GitHub Pages site the repo no longer has`);

        // ----- downloads -----
        const releases = ((await api(`/repos/${repo}/releases?per_page=30`)) ?? [])
          .filter((r) => !r.draft)
          .sort((a, b) => new Date(b.published_at ?? b.created_at) - new Date(a.published_at ?? a.created_at));
        const latestStable = releases.find((r) => !r.prerelease);
        const newestOf = (test) => {
          for (const r of releases) {
            const a = r.assets.find((x) => test.test(x.name));
            if (a) return `https://github.com/${repo}/releases/download/${encodeURIComponent(r.tag_name)}/${encodeURIComponent(a.name)}`;
          }
          return null;
        };
        for (const l of links) {
          const d = parseDownload(l.url, repo);
          if (!d) continue;
          const rel = d.tag ? releases.find((r) => r.tag_name === d.tag) : latestStable;
          if (rel?.assets.some((a) => a.name === d.asset)) continue;
          const ext = d.asset.match(/\.[^.]+$/)?.[0];
          const next = ext && newestOf(new RegExp(`${ext.replace(".", "\\.")}$`, "i"));
          if (next && next !== l.url) {
            urlMoves.push([l.url, next]);
            notes.push(`"${l.label}" repointed to ${next}`);
            l.url = next;
          } else {
            notes.push(`⚠️ "${l.label}" points at a release file that no longer exists (${l.url})`);
          }
        }
        for (const k of DOWNLOAD_KINDS) {
          if (links.some((l) => k.test.test(String(l.url).replace(/[?#].*$/, "")))) continue;
          const url = newestOf(k.test);
          if (url) {
            insertLink(links, { label: k.label, url }, repo);
            notes.push(`added "${k.label}"`);
          }
        }

        // ----- store pages -----
        for (const { store, url } of storeLinks(readme)) {
          const has = links.some((l) => {
            try {
              return store.host.test(new URL(l.url).hostname);
            } catch {
              return false;
            }
          });
          if (!has) {
            insertLink(links, { label: store.label, url }, repo);
            notes.push(`added "${store.label}"`);
          }
        }
      }
      report.push(`- **${p.name}** (${repo}): ${notes.length ? notes.join("; ") : "already current"}`);
    } catch (err) {
      report.push(`- **${p.name}** (${repo}): ⚠️ left as is (${err.message})`);
    }
  }

  // Keep the About & install pages' buttons pointing at the same files as the cards.
  const pageWrites = new Map();
  if (urlMoves.length) {
    for (const dir of await readdir(new URL("apps/", ROOT), { recursive: true }).catch(() => [])) {
      if (!dir.endsWith(".html")) continue;
      const file = new URL(`apps/${dir}`, ROOT);
      let html = await readFile(file, "utf8");
      const before = html;
      for (const [from, to] of urlMoves) html = html.split(from).join(to);
      if (html !== before) pageWrites.set(file, html);
    }
  }

  const updated = JSON.stringify(projects, null, 2) + "\n";
  const changed = updated !== original || iconWrites.size > 0 || pageWrites.size > 0;
  if (changed && !dryRun) {
    for (const [path, buf] of iconWrites) await writeFile(new URL(path, ROOT), buf);
    for (const [file, html] of pageWrites) await writeFile(file, html);
    await writeFile(DATA_PATH, updated);
  }

  const summary = `## Project icon and link sync\n\n${report.join("\n")}\n\n${changed ? (dryRun ? "Would update" : "Updated") + " the cards." : "No changes."}\n`;
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await syncCards({ dryRun: process.argv.includes("--dry-run") });
}
