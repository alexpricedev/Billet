/** @jsxImportSource preact */
import { useEffect, useState } from "preact/hooks";

export function ExampleSearch({ total }: { total: number }) {
  const [query, setQuery] = useState("");
  const [visible, setVisible] = useState(total);

  useEffect(() => {
    const list = document.getElementById("examples-list");
    if (!list) return;

    const cards = Array.from(list.children) as HTMLElement[];
    const q = query.toLowerCase().trim();
    let count = 0;

    for (const card of cards) {
      const match = !q || (card.textContent ?? "").toLowerCase().includes(q);
      card.hidden = !match;
      if (match) count++;
    }

    setVisible(count);
  }, [query]);

  return (
    <div class="mb-4">
      <input
        type="text"
        placeholder="Search examples..."
        value={query}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
        class="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
      {query.trim() && (
        <p class="mt-2 text-sm text-gray-500">
          Showing {visible} of {total}
        </p>
      )}
    </div>
  );
}
