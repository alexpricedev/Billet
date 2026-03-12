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

    const cards = Array.from(list.children) as HTMLElement[];
    for (const card of cards) {
      const match = !q || (card.textContent ?? "").toLowerCase().includes(q);
      card.hidden = !match;
    }
  }, [q]);

  return (
    <div class="mb-4">
      <input
        type="text"
        placeholder="Search projects..."
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        class="w-full px-3 py-2 border border-(--color-border) rounded-md focus:outline-none focus:ring-2 focus:ring-(--color-primary) focus:border-transparent"
      />
      {q && (
        <p class="mt-2 text-sm text-(--color-text-tertiary)">
          Showing {matchCount} of {projects.length}
        </p>
      )}
    </div>
  );
}
