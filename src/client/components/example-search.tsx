/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";

interface ExampleItem {
  id: number;
  name: string;
}

export function ExampleSearch({ examples }: { examples: ExampleItem[] }) {
  const [query, setQuery] = useState("");

  const q = query.toLowerCase().trim();
  const matchCount = q
    ? examples.filter((ex) => ex.name.toLowerCase().includes(q)).length
    : examples.length;

  useEffect(() => {
    const list = document.getElementById("examples-list");
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
        placeholder="Search examples..."
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {q && (
        <p class="mt-2 text-sm text-gray-500">
          Showing {matchCount} of {examples.length}
        </p>
      )}
    </div>
  );
}
