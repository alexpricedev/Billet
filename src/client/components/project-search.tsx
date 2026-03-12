/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";

interface ProjectItem {
  id: number;
  title: string;
}

export function ProjectSearch({ projects }: { projects: ProjectItem[] }) {
  const [query, setQuery] = useState("");

  const q = query.toLowerCase().trim();
  const matchCount = q
    ? projects.filter((p) => p.title.toLowerCase().includes(q)).length
    : projects.length;

  useEffect(() => {
    const list = document.getElementById("projects-list");
    if (!list) return;

    const rows = Array.from(list.querySelectorAll("tbody tr")) as HTMLElement[];
    for (const row of rows) {
      if (row.classList.contains("empty-row")) continue;
      const match = !q || (row.textContent ?? "").toLowerCase().includes(q);
      row.hidden = !match;
    }

    let emptyRow = list.querySelector(".empty-row") as HTMLElement | null;
    if (q && matchCount === 0) {
      if (!emptyRow) {
        const tbody = list.querySelector("tbody");
        if (tbody) {
          const colCount = list.querySelectorAll("thead th").length || 2;
          emptyRow = document.createElement("tr");
          emptyRow.className = "empty-row";
          const td = document.createElement("td");
          td.colSpan = colCount;
          td.className = "text-tertiary";
          td.style.textAlign = "center";
          td.textContent = "No matching projects found.";
          emptyRow.appendChild(td);
          tbody.appendChild(emptyRow);
        }
      }
      if (emptyRow) emptyRow.hidden = false;
    } else if (emptyRow) {
      emptyRow.hidden = true;
    }
  }, [q, matchCount]);

  return (
    <div class="search-container">
      <p class="search-count text-tertiary">
        Showing {matchCount} of {projects.length}
      </p>
      <input
        type="text"
        placeholder="Search projects..."
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
    </div>
  );
}
