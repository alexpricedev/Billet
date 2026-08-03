import type { BunRequest } from "bun";
import { getSessionContext, requireAuth } from "../../middleware/auth";
import { checkCsrf, isRecoverableCsrfFailure } from "../../middleware/csrf";
import { createCsrfToken } from "../../services/csrf";
import {
  createProject,
  deleteProject,
  getProjects,
} from "../../services/project";
import { setSessionCookie } from "../../services/sessions";
import type { ProjectsState } from "../../templates/projects";
import { Projects } from "../../templates/projects";
import { readFormValues } from "../../utils/form-data";
import { redirect, render } from "../../utils/response";
import { fitFlashState, stateHelpers } from "../../utils/state";

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

    const csrf = await checkCsrf(req, { method: "POST", path: "/projects" });
    if (!csrf.ok) {
      // Forged, missing or cross-origin: fail hard, exactly as before.
      if (!isRecoverableCsrfFailure(csrf)) {
        return csrf.response;
      }

      // Stale but authentic. Don't create - hand the title back with a fresh
      // token so the user can resubmit.
      const stale = await readFormValues(req, ["title"]);
      setFlash(
        req,
        fitFlashState<ProjectsState>(
          { state: "csrf-expired", title: stale.title },
          ["title"],
        ),
      );
      return redirect("/projects");
    }

    const { title } = await readFormValues(req, ["title"]);

    if (!title || title.length < 2) {
      setFlash(
        req,
        fitFlashState<ProjectsState>({ state: "validation-error", title }, [
          "title",
        ]),
      );
      return redirect("/projects");
    }

    const createdBy = ctx.user?.email ?? null;
    await createProject(title, createdBy);
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

    const csrf = await checkCsrf(req, {
      method: "POST",
      path: new URL(req.url).pathname,
    });
    if (!csrf.ok) {
      if (!isRecoverableCsrfFailure(csrf)) {
        return csrf.response;
      }

      // Stale but authentic. Nothing to preserve, and a delete must never be
      // replayed silently - bounce back so the row re-renders with a fresh
      // token and the user confirms with a deliberate second click.
      setFlash(req, { state: "delete-csrf-expired" });
      return redirect("/projects");
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
