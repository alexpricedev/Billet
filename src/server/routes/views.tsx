import type { JSX } from "react";
import { renderToString } from "react-dom/server";
import { getVisitorStats } from "../services/analytics";
import { getExamples } from "../services/example";
import { About } from "../templates/about";
import { Contact } from "../templates/contact";
import { Examples } from "../templates/examples";
import { Home } from "../templates/home";

const render = (element: JSX.Element): Response =>
  new Response(renderToString(element), {
    headers: { "Content-Type": "text/html" },
  });

export const viewRoutes = {
  "/": (req: Bun.BunRequest<"/">) => {
    const stats = getVisitorStats();
    return render(<Home method={req.method} stats={stats} />);
  },
  "/about": () => render(<About />),
  "/contact": () => render(<Contact />),
  "/examples": async () => {
    const examples = await getExamples();
    return render(<Examples examples={examples} />);
  },
};
