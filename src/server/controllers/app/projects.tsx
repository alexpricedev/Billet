import type { BunRequest } from "bun";
import { getSessionContext, requireAuth } from "../../middleware/auth";
import { csrfProtection } from "../../middleware/csrf";
import { createCsrfToken } from "../../services/csrf";
import {
  createProject,
  deleteProject,
  getProjects,
} from "../../services/project";
import { setSessionCookie } from "../../services/sessions";
import type { ProjectsState } from "../../templates/projects";
import { Projects } from "../../templates/projects";
import { redirect, render } from "../../utils/response";
import { stateHelpers } from "../../utils/state";

const { getFlash, setFlash } = stateHelpers<ProjectsState>();

export const projects = {
  async index(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);
    const projectList = await getProjects();

    if (ctx.requiresSetCookie && ctx.sessionId) {
      setSessionCookie(req, ctx.sessionId);
    }

    let navCsrfToken: string | undefined;
    if (ctx.isAuthenticated && ctx.sessionId) {
      navCsrfToken = await createCsrfToken(
        ctx.sessionId,
        "POST",
        "/auth/logout",
      );
    }

    const state = getFlash(req);

    let createCsrfTokenValue: string | null = null;
    const deleteCsrfTokens: Record<number, string> = {};

    if (ctx.sessionId) {
      createCsrfTokenValue = await createCsrfToken(
        ctx.sessionId,
        "POST",
        "/projects",
      );
    }

    if (ctx.isAuthenticated && ctx.sessionId) {
      for (const project of projectList) {
        deleteCsrfTokens[project.id] = await createCsrfToken(
          ctx.sessionId,
          "POST",
          `/projects/${project.id}/delete`,
        );
      }
    }

    return render(
      <Projects
        createCsrfToken={createCsrfTokenValue}
        deleteCsrfTokens={deleteCsrfTokens}
        projects={projectList}
        isAuthenticated={ctx.isAuthenticated}
        state={state}
        user={ctx.user}
        csrfToken={navCsrfToken}
      />,
    );
  },

  async create(req: BunRequest): Promise<Response> {
    const ctx = await getSessionContext(req);

    if (!ctx.sessionId) {
      return redirect("/projects");
    }

    const csrfResponse = await csrfProtection(req, {
      method: "POST",
      path: "/projects",
    });
    if (csrfResponse) {
      return csrfResponse;
    }

    const formData = await req.formData();
    const title = formData.get("title") as string;

    if (!title || title.trim().length < 2) {
      return redirect("/projects");
    }

    const createdBy = ctx.user?.email ?? null;
    await createProject(title.trim(), createdBy);
    setFlash(req, { state: "submission-success" });
    return redirect("/projects");
  },

  async destroy<T extends `${string}:id${string}`>(
    req: BunRequest<T>,
  ): Promise<Response> {
    const authRedirect = await requireAuth(req);
    if (authRedirect) {
      return authRedirect;
    }

    const csrfResponse = await csrfProtection(req, {
      method: "POST",
      path: req.url,
    });
    if (csrfResponse) {
      return csrfResponse;
    }

    const idParam = req.params.id;
    const id = Number.parseInt(idParam, 10);

    if (!idParam || Number.isNaN(id)) {
      return redirect("/projects");
    }

    const deleted = await deleteProject(id);

    if (!deleted) {
      return redirect("/projects");
    }

    setFlash(req, { state: "deletion-success" });
    return redirect("/projects");
  },
};
