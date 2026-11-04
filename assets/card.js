// Card rendering shared by the public page and the admin preview.

export const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Only http(s), mailto and same-site relative links; anything else (javascript:, data:) becomes "#".
export function safeUrl(url) {
  const u = String(url ?? "").trim();
  if (/^(https?:|mailto:)/i.test(u)) return u;
  if (/^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//")) return "#";
  return u;
}

export function projectCard(p, { iconSrc } = {}) {
  const li = document.createElement("li");
  li.className = "card";
  li.id = p.slug;
  const icon = iconSrc ?? (p.icon ? safeUrl(p.icon) : "");
  li.innerHTML = `
    <div class="card-head">
      ${icon ? `<img class="card-icon" src="${escape(icon)}" alt="" width="56" height="56">` : ""}
      <div>
        <h3>${escape(p.name)}${p.private ? ' <span class="badge">Private</span>' : ""}</h3>
        <p class="card-tagline">${escape(p.tagline ?? "")}</p>
      </div>
    </div>
    <ul class="card-points">${(p.description ?? []).map((d) => `<li>${escape(d)}</li>`).join("")}</ul>
    <ul class="stack" aria-label="Built with">${(p.stack ?? []).map((s) => `<li>${escape(s)}</li>`).join("")}</ul>
    <div class="card-links">${(p.links ?? [])
      .map((l) => `<a class="btn${l.primary ? " btn-primary" : ""}" href="${escape(safeUrl(l.url))}">${escape(l.label)}</a>`)
      .join("")}</div>`;
  return li;
}
