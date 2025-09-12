import {
  createExample,
  deleteExample,
  getExampleById,
  getExamples,
  updateExample,
} from "../../services/example";

export const examplesApi = {
  async index(_req: Request): Promise<Response> {
    const examples = await getExamples();
    return Response.json(examples);
  },

  async show(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const id = Number.parseInt(url.pathname.split("/").pop() || "0", 10);
    const example = await getExampleById(id);

    if (!example) {
      return new Response("Example not found", { status: 404 });
    }

    return Response.json(example);
  },

  async create(req: Request): Promise<Response> {
    const body = await req.json();
    const example = await createExample(body.name);
    return Response.json(example, { status: 201 });
  },

  async update(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const id = Number.parseInt(url.pathname.split("/").pop() || "0", 10);
    const body = await req.json();
    const example = await updateExample(id, body.name);

    if (!example) {
      return new Response("Example not found", { status: 404 });
    }

    return Response.json(example);
  },

  async destroy(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const id = Number.parseInt(url.pathname.split("/").pop() || "0", 10);
    const deleted = await deleteExample(id);

    if (!deleted) {
      return new Response("Example not found", { status: 404 });
    }

    return new Response("", { status: 204 });
  },
};
