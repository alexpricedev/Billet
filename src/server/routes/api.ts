import { getVisitorStats } from "../services/analytics";
import {
  createExample,
  deleteExample,
  getExampleById,
  getExamples,
  updateExample,
} from "../services/example";

export const apiRoutes = {
  "/api/stats": () => {
    return Response.json(getVisitorStats());
  },
  "/api/examples": async (req: Request) => {
    if (req.method === "GET") {
      const examples = await getExamples();
      return Response.json(examples);
    }

    if (req.method === "POST") {
      const body = await req.json();
      const example = await createExample(body.name);
      return Response.json(example, { status: 201 });
    }

    return new Response("Method not allowed", { status: 405 });
  },
  "/api/examples/:id": async (req: Request) => {
    const url = new URL(req.url);
    const id = Number.parseInt(url.pathname.split("/").pop() || "0", 10);

    if (req.method === "GET") {
      const example = await getExampleById(id);
      if (!example) {
        return new Response("Example not found", { status: 404 });
      }
      return Response.json(example);
    }

    if (req.method === "PUT") {
      const body = await req.json();
      const example = await updateExample(id, body.name);
      if (!example) {
        return new Response("Example not found", { status: 404 });
      }
      return Response.json(example);
    }

    if (req.method === "DELETE") {
      const deleted = await deleteExample(id);
      if (!deleted) {
        return new Response("Example not found", { status: 404 });
      }
      return new Response("", { status: 204 });
    }

    return new Response("Method not allowed", { status: 405 });
  },
};
