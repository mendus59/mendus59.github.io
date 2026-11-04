import { projectCard } from "./card.js";

const ALL = "All";

const state = { projects: [], skill: ALL };

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

function renderProjects() {
  const shown = state.projects.filter((p) => state.skill === ALL || (p.skills ?? []).includes(state.skill));
  document.getElementById("projects").replaceChildren(...shown.map((p) => projectCard(p)));
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
  renderFilters();
  renderProjects();
}

init();
