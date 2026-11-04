const ALL = "All";

const escape = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const state = { projects: [], skill: ALL };

function renderFilters() {
  const skills = [...new Set(state.projects.flatMap((p) => p.skills))].sort((a, b) => a.localeCompare(b));
  const el = document.getElementById("filters");
  el.replaceChildren(
    ...[ALL, ...skills].map((skill) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.textContent = skill;
      b.setAttribute("aria-pressed", String(skill === state.skill));
      b.addEventListener("click", () => {
        state.skill = skill;
        renderFilters();
        renderProjects();
      });
      return b;
    }),
  );
}

function projectCard(p) {
  const li = document.createElement("li");
  li.className = "card";
  li.id = p.slug;
  li.innerHTML = `
    <div class="card-head">
      <img class="card-icon" src="${escape(p.icon)}" alt="" width="56" height="56">
      <div>
        <h3>${escape(p.name)}${p.private ? ' <span class="badge">Private</span>' : ""}</h3>
        <p class="card-tagline">${escape(p.tagline)}</p>
      </div>
    </div>
    <ul class="card-points">${p.description.map((d) => `<li>${escape(d)}</li>`).join("")}</ul>
    <ul class="stack" aria-label="Built with">${p.stack.map((s) => `<li>${escape(s)}</li>`).join("")}</ul>
    <div class="card-links">${(p.links ?? [])
      .map((l) => `<a class="btn${l.primary ? " btn-primary" : ""}" href="${escape(l.url)}">${escape(l.label)}</a>`)
      .join("")}</div>`;
  return li;
}

function renderProjects() {
  const shown = state.projects.filter((p) => state.skill === ALL || p.skills.includes(state.skill));
  document.getElementById("projects").replaceChildren(...shown.map(projectCard));
  const n = shown.length;
  document.getElementById("count").textContent =
    state.skill === ALL ? `${n} project${n === 1 ? "" : "s"}` : `${n} using ${state.skill}`;
}

async function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  try {
    const res = await fetch("data/projects.json");
    state.projects = await res.json();
  } catch {
    document.getElementById("count").textContent = "Projects couldn't load. Try refreshing.";
    return;
  }
  renderFilters();
  renderProjects();
}

init();
