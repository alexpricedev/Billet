import type { BunRequest } from "bun";
import {
  createProject,
  deleteProject,
  getProjectById,
  getProjectPage,
  updateProject,
} from "../../services/project";
import { jsonError } from "../../utils/response";
import {
  apiReadLimit,
  apiWriteLimit,
  readIdParam,
  readJsonBody,
  readPagination,
  readStringField,
} from "./request-guard";

const notFound = (): Response =>
  jsonError(404, "not_found", "No project exists with that id.");

const missingTitle = (): Response =>
  jsonError(400, "invalid_body", "A non-empty title is required.", {
    fields: { title: "Required." },
  });

// The reference CRUD endpoint. Every controller here runs the same three
// opening moves — rate limit, then read the path id, then the body — and each
// short-circuits with the response to send, so nothing unvalidated reaches a
// service. See `request-guard.ts` for why each guard exists.
export const projectsApi = {
  async index(req: BunRequest): Promise<Response> {
    const limited = apiReadLimit(req);
    if (limited) return limited;

    const page = readPagination(req);
    if (!page.ok) return page.response;

    const { projects, total } = await getProjectPage(page.limit, page.offset);

    // The collection is wrapped rather than returned as a bare array: `total`
    // has nowhere to live otherwise, and a top-level array leaves no room to
    // add one later without breaking every client.
    return Response.json({
      data: projects,
      pagination: { total, limit: page.limit, offset: page.offset },
    });
  },

  async show(req: BunRequest): Promise<Response> {
    const limited = apiReadLimit(req);
    if (limited) return limited;

    const param = readIdParam(req);
    if (!param.ok) return param.response;

    const project = await getProjectById(param.id);
    if (!project) return notFound();

    return Response.json({ data: project });
  },

  async create(req: BunRequest): Promise<Response> {
    const limited = apiWriteLimit(req);
    if (limited) return limited;

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;

    const title = readStringField(parsed.body, "title");
    if (title === null) return missingTitle();

    const project = await createProject(title, null);

    // 201 carries a Location header so the client learns the URL of what it
    // just made without having to assemble one from the id.
    return Response.json(
      { data: project },
      { status: 201, headers: { Location: `/api/projects/${project.id}` } },
    );
  },

  async update(req: BunRequest): Promise<Response> {
    const limited = apiWriteLimit(req);
    if (limited) return limited;

    const param = readIdParam(req);
    if (!param.ok) return param.response;

    const parsed = await readJsonBody(req);
    if (!parsed.ok) return parsed.response;

    const title = readStringField(parsed.body, "title");
    if (title === null) return missingTitle();

    const project = await updateProject(param.id, title);
    if (!project) return notFound();

    return Response.json({ data: project });
  },

  async destroy(req: BunRequest): Promise<Response> {
    const limited = apiWriteLimit(req);
    if (limited) return limited;

    const param = readIdParam(req);
    if (!param.ok) return param.response;

    const deleted = await deleteProject(param.id);
    if (!deleted) return notFound();

    // 204 has no body by definition, so there is nothing to shape here.
    return new Response(null, { status: 204 });
  },
};
