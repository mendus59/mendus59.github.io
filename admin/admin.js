// Projects admin: edits data/projects.json on main through the GitHub API.
// No server, no secrets in the repo: the owner signs in with their own fine-grained token,
// which stays in this browser (sessionStorage, or localStorage if "remember" is ticked).

import { projectCard, escape, safeUrl } from "../assets/card.js";

const OWNER = "mendus59";
const REPO = "mendus59.github.io";
const BRANCH = "main";
const DATA_PATH = "data/projects.json";
const ICON_DIR = "assets/icons";
const TOKEN_KEY = "admin.github-token";

const $ = (id) => document.getElementById(id);

const state = {
  token: null,
  baseCommit: null, // commit sha the data was loaded from
  saved: [], // projects as on GitHub
  projects: [], // working copy
  icons: new Map(), // repo path -> { base64, objectUrl } for uploads not yet published
  editing: null, // index being edited, or -1 for a new project
  draftLinks: [],
};

// ---------- storage ----------

function readToken() {
  try {
    return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeToken(token, remember) {
  try {
    (remember ? localStorage : sessionStorage).setItem(TOKEN_KEY, token);
  } catch {
    /* storage blocked: token lives in memory for this tab only */
  }
}

function clearToken() {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

// ---------- GitHub API ----------

class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function gh(path, { method = "GET", body } = {}) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${state.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).message || msg;
    } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.status === 204 ? null : res.json();
}

const b64ToText = (b64) =>
  new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));

async function loadFromGitHub() {
  const ref = await gh(`/git/ref/heads/${BRANCH}`);
  const sha = ref.object.sha;
  const file = await gh(`/contents/${DATA_PATH}?ref=${sha}`);
  const data = JSON.parse(b64ToText(file.content));
  if (!Array.isArray(data)) throw new Error(`${DATA_PATH} is not a list`);
  state.baseCommit = sha;
  state.saved = data;
  state.projects = structuredClone(data);
  clearIcons();
}

// One commit with projects.json plus any uploaded icons, fast-forwarded onto main.
async function publish(message) {
  const base = await gh(`/git/commits/${state.baseCommit}`);
  const used = new Set(state.projects.map((p) => p.icon));
  const tree = [{ path: DATA_PATH, mode: "100644", type: "blob", content: formatJson(state.projects) + "\n" }];
  for (const [path, icon] of state.icons) {
    if (!used.has(path)) continue;
    const blob = await gh(`/git/blobs`, { method: "POST", body: { content: icon.base64, encoding: "base64" } });
    tree.push({ path, mode: "100644", type: "blob", sha: blob.sha });
  }
  const newTree = await gh(`/git/trees`, { method: "POST", body: { base_tree: base.tree.sha, tree } });
  const commit = await gh(`/git/commits`, {
    method: "POST",
    body: { message, tree: newTree.sha, parents: [state.baseCommit] },
  });
  // force:false means this fails if main moved since we loaded, instead of overwriting someone else's change.
  await gh(`/git/refs/heads/${BRANCH}`, { method: "PATCH", body: { sha: commit.sha, force: false } });
  state.baseCommit = commit.sha;
  state.saved = structuredClone(state.projects);
  clearIcons();
}

// Same layout as the hand-written file: short lists and link objects stay on one line.
function formatJson(value, indent = "") {
  const inner = indent + "  ";
  const flat = JSON.stringify(value);
  if (value === null || typeof value !== "object") return flat;
  const simple = Array.isArray(value)
    ? value.every((v) => v === null || typeof v !== "object")
    : Object.values(value).every((v) => v === null || typeof v !== "object");
  if (simple && flat.length + inner.length <= 110) {
    if (Array.isArray(value)) return `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
    const kv = Object.entries(value).filter(([, v]) => v !== undefined);
    return kv.length ? `{ ${kv.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }` : "{}";
  }
  if (Array.isArray(value)) {
    if (!value.length) return "[]";
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`).join(",\n")}\n${indent}}`;
}

function clearIcons() {
  for (const icon of state.icons.values()) URL.revokeObjectURL(icon.objectUrl);
  state.icons.clear();
}

// ---------- views ----------

function show(view) {
  for (const id of ["signin", "list", "editor"]) $(id).hidden = id !== view;
  window.scrollTo(0, 0);
}

const dirty = () =>
  formatJson(state.projects) !== formatJson(state.saved) ||
  [...state.icons.keys()].some((k) => state.projects.some((p) => p.icon === k));

const iconSrc = (p) => state.icons.get(p.icon)?.objectUrl ?? (p.icon ? safeUrl(p.icon) : "");

function setStatus(text) {
  $("status").textContent = text;
}

function renderList() {
  const rows = $("rows");
  rows.replaceChildren(
    ...state.projects.map((p, i) => {
      const li = document.createElement("li");
      li.className = `row-item${p.hidden ? " is-hidden" : ""}`;
      const src = iconSrc(p);
      li.innerHTML = `
        ${src ? `<img class="card-icon" src="${escape(src)}" alt="" width="40" height="40">` : `<span class="icon-blank"></span>`}
        <div class="row-text">
          <strong>${escape(p.name || "(untitled)")}</strong>
          <span class="badge ${p.hidden ? "" : "badge-on"}">${p.hidden ? "Hidden" : "Visible"}</span>
          <p class="muted">${escape(p.tagline || "")}</p>
        </div>
        <div class="row-actions">
          <button class="btn btn-sm" data-act="toggle">${p.hidden ? "Show" : "Hide"}</button>
          <button class="btn btn-sm" data-act="edit">Edit</button>
          <button class="btn btn-sm" data-act="up" aria-label="Move ${escape(p.name)} up" ${i === 0 ? "disabled" : ""}>↑</button>
          <button class="btn btn-sm" data-act="down" aria-label="Move ${escape(p.name)} down" ${i === state.projects.length - 1 ? "disabled" : ""}>↓</button>
          <button class="btn btn-sm btn-danger" data-act="remove">Remove</button>
        </div>`;
      li.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => rowAction(b.dataset.act, i)));
      return li;
    }),
  );
  const visible = state.projects.filter((p) => !p.hidden).length;
  const isDirty = dirty();
  setStatus(
    `${state.projects.length} projects, ${visible} visible.` + (isDirty ? " You have unpublished changes." : ""),
  );
  $("publish-bar").hidden = !isDirty;
}

function rowAction(act, i) {
  const p = state.projects;
  if (act === "toggle") p[i].hidden ? delete p[i].hidden : (p[i].hidden = true);
  if (act === "up" && i > 0) [p[i - 1], p[i]] = [p[i], p[i - 1]];
  if (act === "down" && i < p.length - 1) [p[i + 1], p[i]] = [p[i], p[i + 1]];
  if (act === "remove" && confirm(`Remove "${p[i].name}"? Hide it instead if you might want it back.`)) p.splice(i, 1);
  if (act === "edit") return openEditor(i);
  renderList();
}

// ---------- editor ----------

const form = () => $("edit-form");
const splitList = (s) => s.split(",").map((x) => x.trim()).filter(Boolean);
const slugify = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function openEditor(index) {
  state.editing = index;
  const p = index === -1 ? { links: [] } : state.projects[index];
  const f = form();
  $("editor-title").textContent = index === -1 ? "Add project" : `Edit ${p.name}`;
  f.name.value = p.name ?? "";
  f.slug.value = p.slug ?? "";
  f.slug.dataset.auto = index === -1 ? "1" : "";
  f.tagline.value = p.tagline ?? "";
  f.description.value = (p.description ?? []).join("\n");
  f.skills.value = (p.skills ?? []).join(", ");
  f.stack.value = (p.stack ?? []).join(", ");
  f.icon.value = p.icon ?? "";
  f.iconFile.value = "";
  f.hidden.checked = !!p.hidden;
  f.private.checked = !!p.private;
  state.draftLinks = structuredClone(p.links ?? []);
  $("edit-error").textContent = "";
  renderLinks();
  renderPreview();
  show("editor");
  f.name.focus();
}

function renderLinks() {
  const el = $("links");
  el.replaceChildren(
    ...state.draftLinks.map((l, i) => {
      const row = document.createElement("div");
      row.className = "link-row";
      row.innerHTML = `
        <input aria-label="Link ${i + 1} label" placeholder="Label" value="${escape(l.label ?? "")}" data-k="label">
        <input aria-label="Link ${i + 1} URL" placeholder="https://…" value="${escape(l.url ?? "")}" data-k="url" type="url">
        <label class="check"><input type="radio" name="primary" ${l.primary ? "checked" : ""}> Main</label>
        <button class="btn btn-sm" type="button" data-act="up" aria-label="Move link up" ${i === 0 ? "disabled" : ""}>↑</button>
        <button class="btn btn-sm btn-danger" type="button" data-act="remove" aria-label="Remove link">✕</button>`;
      row.querySelectorAll("input[data-k]").forEach((input) =>
        input.addEventListener("input", () => {
          l[input.dataset.k] = input.value;
          renderPreview();
        }),
      );
      row.querySelector('input[type="radio"]').addEventListener("change", () => {
        state.draftLinks.forEach((x) => delete x.primary);
        l.primary = true;
        renderPreview();
      });
      row.querySelector('[data-act="remove"]').addEventListener("click", () => {
        state.draftLinks.splice(i, 1);
        renderLinks();
        renderPreview();
      });
      row.querySelector('[data-act="up"]').addEventListener("click", () => {
        [state.draftLinks[i - 1], state.draftLinks[i]] = [state.draftLinks[i], state.draftLinks[i - 1]];
        renderLinks();
        renderPreview();
      });
      return row;
    }),
  );
}

function readForm() {
  const f = form();
  const p = {
    slug: f.slug.value.trim(),
    name: f.name.value.trim(),
    tagline: f.tagline.value.trim(),
    description: f.description.value.split("\n").map((x) => x.trim()).filter(Boolean),
    icon: f.icon.value.trim() || undefined,
    skills: splitList(f.skills.value),
    stack: splitList(f.stack.value),
    links: state.draftLinks
      .map((l) => ({ label: (l.label ?? "").trim(), url: (l.url ?? "").trim(), ...(l.primary ? { primary: true } : {}) }))
      .filter((l) => l.label || l.url),
  };
  if (f.private.checked) p.private = true;
  if (f.hidden.checked) p.hidden = true;
  // Keep any fields this form doesn't know about.
  const orig = state.editing >= 0 ? state.projects[state.editing] : {};
  const extra = Object.fromEntries(
    Object.entries(orig).filter(([k]) => !(k in p) && !["icon", "private", "hidden"].includes(k)),
  );
  return { ...p, ...extra };
}

function validate(p) {
  if (!p.name) return "Give the project a name.";
  if (!/^[A-Za-z0-9_-]+$/.test(p.slug)) return "The slug can only use letters, numbers, - and _.";
  if (state.projects.some((x, i) => x.slug === p.slug && i !== state.editing)) return `Another project already uses the slug "${p.slug}".`;
  for (const l of p.links) {
    if (!l.label || !l.url) return "Every link needs both a label and a URL.";
    if (!/^(https?:\/\/|mailto:|\/|\.\/|[A-Za-z0-9_-])/.test(l.url) || /^(javascript|data|vbscript):/i.test(l.url))
      return `"${l.url}" isn't a usable link. Use a full https:// address.`;
  }
  return null;
}

function renderPreview() {
  const p = readForm();
  $("preview").replaceChildren(projectCard({ ...p, name: p.name || "Project name" }, { iconSrc: iconSrc(p) }));
}

function saveEditor(e) {
  e.preventDefault();
  const p = readForm();
  const err = validate(p);
  if (err) {
    $("edit-error").textContent = err;
    return;
  }
  if (state.editing === -1) state.projects.push(p);
  else state.projects[state.editing] = p;
  state.editing = null;
  renderList();
  show("list");
}

async function onIconFile() {
  const f = form();
  const file = f.iconFile.files[0];
  if (!file) return;
  if (file.size > 512 * 1024) {
    $("edit-error").textContent = "That image is over 512 KB. Use a smaller icon.";
    f.iconFile.value = "";
    return;
  }
  const ext = { "image/svg+xml": "svg", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" }[file.type];
  if (!ext) {
    $("edit-error").textContent = "Use a PNG, SVG, JPEG or WebP image.";
    return;
  }
  const slug = f.slug.value.trim() || slugify(f.name.value) || "project";
  const path = `${ICON_DIR}/${slug}.${ext}`;
  const dataUrl = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
  const old = state.icons.get(path);
  if (old) URL.revokeObjectURL(old.objectUrl);
  state.icons.set(path, { base64: dataUrl.split(",")[1], objectUrl: URL.createObjectURL(file) });
  f.icon.value = path;
  $("edit-error").textContent = "";
  renderPreview();
}

// ---------- wiring ----------

function describeError(err) {
  if (err instanceof ApiError) {
    if (err.status === 401) return "GitHub didn't accept that token. Check it hasn't expired.";
    if (err.status === 403 || err.status === 404)
      return "That token can't reach mendus59.github.io. Give it Contents: Read and write on that repository.";
    if (err.status === 422 || err.status === 409)
      return "The site changed on GitHub since you loaded it. Reload, then make your changes again.";
    return `GitHub said: ${err.message}`;
  }
  return err.message || String(err);
}

async function signIn(token) {
  state.token = token;
  setStatus("Loading projects…");
  show("list");
  await loadFromGitHub();
  renderList();
}

async function boot() {
  $("signin-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const token = $("token").value.trim();
    $("signin-error").textContent = "";
    try {
      await signIn(token);
      storeToken(token, $("remember").checked);
      $("token").value = "";
    } catch (err) {
      state.token = null;
      show("signin");
      $("signin-error").textContent = describeError(err);
    }
  });

  $("add").addEventListener("click", () => openEditor(-1));
  $("reload").addEventListener("click", async () => {
    if (dirty() && !confirm("Throw away your unpublished changes and reload from GitHub?")) return;
    try {
      setStatus("Loading projects…");
      await loadFromGitHub();
      renderList();
    } catch (err) {
      setStatus(describeError(err));
    }
  });
  $("signout").addEventListener("click", () => {
    if (dirty() && !confirm("You have unpublished changes. Sign out anyway?")) return;
    clearToken();
    state.token = null;
    clearIcons();
    show("signin");
  });
  $("discard").addEventListener("click", () => {
    if (!confirm("Discard your unpublished changes?")) return;
    state.projects = structuredClone(state.saved);
    clearIcons();
    renderList();
  });
  $("publish").addEventListener("click", async () => {
    const btn = $("publish");
    btn.disabled = true;
    setStatus("Publishing…");
    try {
      await publish($("commit-msg").value.trim() || "Update projects from the admin panel");
      $("commit-msg").value = "";
      renderList();
      setStatus("Published. The live site updates in about a minute.");
    } catch (err) {
      setStatus(describeError(err));
    } finally {
      btn.disabled = false;
    }
  });

  const f = form();
  f.addEventListener("submit", saveEditor);
  f.addEventListener("input", (e) => {
    if (e.target === f.slug) f.slug.dataset.auto = "";
    if (e.target === f.name && f.slug.dataset.auto) f.slug.value = slugify(f.name.value);
    if (e.target !== f.iconFile) renderPreview();
  });
  f.iconFile.addEventListener("change", () => onIconFile().catch((err) => ($("edit-error").textContent = describeError(err))));
  $("add-link").addEventListener("click", () => {
    state.draftLinks.push({ label: "", url: "", ...(state.draftLinks.length ? {} : { primary: true }) });
    renderLinks();
    renderPreview();
    $("links").lastElementChild?.querySelector("input")?.focus();
  });
  $("cancel-edit").addEventListener("click", () => {
    state.editing = null;
    show("list");
  });
  window.addEventListener("beforeunload", (e) => {
    if (state.token && dirty()) e.preventDefault();
  });

  const saved = readToken();
  if (!saved) return show("signin");
  try {
    await signIn(saved);
  } catch (err) {
    clearToken();
    state.token = null;
    show("signin");
    $("signin-error").textContent = describeError(err);
  }
}

boot();
