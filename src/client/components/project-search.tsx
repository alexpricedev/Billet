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
      const match = !q || (row.textContent ?? "").toLowerCase().includes(q);
      row.hidden = !match;
    }
  }, [q]);

  return (
    <div class="search-container">
      <input
        type="text"
        placeholder="Search projects..."
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
      {q && (
        <p class="text-tertiary" style={{ fontSize: "13px", marginTop: "8px" }}>
          Showing {matchCount} of {projects.length}
        </p>
      )}
    </div>
  );
}
