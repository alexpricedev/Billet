import {
  createProject,
  deleteProject,
  getProjectById,
  getProjects,
  updateProject,
} from "../../services/project";

export const projectsApi = {
  async index(_req: Request): Promise<Response> {
    const projects = await getProjects();
    return Response.json(projects);
  },

  async show(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const id = Number.parseInt(url.pathname.split("/").pop() || "0", 10);
    const project = await getProjectById(id);

    if (!project) {
      return new Response("Project not found", { status: 404 });
    }

    return Response.json(project);
  },

  async create(req: Request): Promise<Response> {
    const body = await req.json();
    const project = await createProject(body.title, null);
    return Response.json(project, { status: 201 });
  },

  async update(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const id = Number.parseInt(url.pathname.split("/").pop() || "0", 10);
    const body = await req.json();
    const project = await updateProject(id, body.title);

    if (!project) {
      return new Response("Project not found", { status: 404 });
    }

    return Response.json(project);
  },

  async destroy(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const id = Number.parseInt(url.pathname.split("/").pop() || "0", 10);
    const deleted = await deleteProject(id);

    if (!deleted) {
      return new Response("Project not found", { status: 404 });
    }

    return new Response("", { status: 204 });
  },
};
