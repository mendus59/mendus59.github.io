import { projectCard } from "./card.js";

const ALL = "All";

const state = { projects: [], categories: [], skill: ALL };
const OTHER = { id: "other", name: "Other projects" };

function renderFilters() {
  const skills = [...new Set(state.projects.flatMap((p) => p.skills ?? []))].sort((a, b) => a.localeCompare(b));
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

// One headed section per category, in the order of data/categories.json. Cards keep their
// projects.json order inside a section; a card with no known category goes under "Other projects".
function section(cat, projects) {
  const sec = document.createElement("section");
  sec.className = "category";
  sec.id = `category-${cat.id}`;
  sec.setAttribute("aria-labelledby", `${sec.id}-heading`);
  const head = document.createElement("div");
  head.className = "category-head";
  const h = document.createElement("h3");
  h.id = `${sec.id}-heading`;
  h.textContent = cat.name;
  const n = document.createElement("span");
  n.className = "muted";
  n.textContent = String(projects.length);
  head.append(h, n);
  if (cat.blurb) {
    const p = document.createElement("p");
    p.className = "muted category-blurb";
    p.textContent = cat.blurb;
    head.append(p);
  }
  const ul = document.createElement("ul");
  ul.className = "projects";
  ul.replaceChildren(...projects.map((p) => projectCard(p)));
  sec.append(head, ul);
  return sec;
}

function renderProjects() {
  const shown = state.projects.filter((p) => state.skill === ALL || (p.skills ?? []).includes(state.skill));
  const known = new Set(state.categories.map((c) => c.id));
  const groups = [...state.categories, OTHER].map((cat) => [
    cat,
    shown.filter((p) => (cat === OTHER ? !known.has(p.category) : p.category === cat.id)),
  ]);
  document
    .getElementById("projects")
    .replaceChildren(...groups.filter(([, ps]) => ps.length).map(([cat, ps]) => section(cat, ps)));
  const n = shown.length;
  document.getElementById("count").textContent =
    state.skill === ALL ? `${n} project${n === 1 ? "" : "s"}` : `${n} using ${state.skill}`;
}

async function init() {
  document.getElementById("year").textContent = new Date().getFullYear();
  try {
    const res = await fetch("data/projects.json");
    state.projects = (await res.json()).filter((p) => !p.hidden);
  } catch {
    document.getElementById("count").textContent = "Projects couldn't load. Try refreshing.";
    return;
  }
  try {
    state.categories = await (await fetch("data/categories.json")).json();
  } catch {
    state.categories = []; // everything falls under "Other projects"
  }
  renderFilters();
  renderProjects();
}

init();
