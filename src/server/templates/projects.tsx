import type { JSX } from "react";
import { CsrfField } from "../components/csrf-field";
import { Layout } from "../components/layouts";
import type { Project } from "../services/project";
import type { User } from "../services/users";

export interface ProjectsState {
  state?: "submission-success" | "deletion-success";
}

type PublicProjectsProps = {
  isAuthenticated: false;
  projects: Project[];
};

type AuthProjectsProps = {
  isAuthenticated: true;
  projects: Project[];
  state: ProjectsState;
  createCsrfToken: string | null;
  deleteCsrfTokens: Record<number, string>;
};

export type ProjectsProps = (PublicProjectsProps | AuthProjectsProps) & {
  user: User | null;
  csrfToken?: string;
};

export const Projects = (props: ProjectsProps): JSX.Element => {
  return (
    <Layout
      title="Projects - Billet"
      name="projects"
      user={props.user}
      csrfToken={props.csrfToken}
    >
      <h1>Projects</h1>

      {props.isAuthenticated && props.state?.state && (
        <div
          className={
            props.state.state === "submission-success"
              ? "flash-success"
              : "flash-success"
          }
        >
          {props.state.state === "submission-success" &&
            "Project added successfully."}
          {props.state.state === "deletion-success" &&
            "Project deleted successfully."}
        </div>
      )}

      <div
        id="projects-search"
        data-projects={JSON.stringify(
          props.projects.map((p) => ({ id: p.id, title: p.title })),
        )}
      />

      {props.isAuthenticated ? (
        <section className="card">
          <form
            method="POST"
            action="/projects"
            style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}
          >
            <CsrfField token={props.createCsrfToken} />
            <input
              type="text"
              name="title"
              placeholder="New project title"
              required
              minLength={2}
              style={{ flex: 1 }}
            />
            <button type="submit">Add Project</button>
          </form>
        </section>
      ) : (
        <div className="auth-prompt">
          <a href="/login">Sign in</a> to create projects.
        </div>
      )}

      {props.projects.length === 0 ? (
        <p className="text-tertiary">No projects yet.</p>
      ) : (
        <div id="projects-list">
          <table className="project-list">
            <thead>
              <tr>
                <th>Title</th>
                {props.isAuthenticated && <th />}
              </tr>
            </thead>
            <tbody>
              {props.projects.map((project) => (
                <tr key={project.id}>
                  <td>{project.title}</td>
                  {props.isAuthenticated &&
                    props.deleteCsrfTokens[project.id] && (
                      <td style={{ textAlign: "right" }}>
                        <form
                          method="POST"
                          action={`/projects/${project.id}/delete`}
                          style={{ display: "inline" }}
                        >
                          <CsrfField
                            token={props.deleteCsrfTokens[project.id]}
                          />
                          <button type="submit" className="delete-btn">
                            Delete
                          </button>
                        </form>
                      </td>
                    )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section style={{ marginTop: "2.5rem" }}>
        <h2>API Endpoints</h2>
        <div className="card">
          <table style={{ width: "100%" }}>
            <tbody>
              <tr>
                <td>
                  <span style={{ color: "var(--color-success)" }}>GET</span>
                </td>
                <td
                  style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
                >
                  /api/projects
                </td>
                <td className="text-tertiary">List all projects</td>
              </tr>
              <tr>
                <td>
                  <span style={{ color: "var(--color-primary)" }}>POST</span>
                </td>
                <td
                  style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
                >
                  /api/projects
                </td>
                <td className="text-tertiary">Create new project</td>
              </tr>
              <tr>
                <td>
                  <span style={{ color: "var(--color-success)" }}>GET</span>
                </td>
                <td
                  style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
                >
                  /api/projects/:id
                </td>
                <td className="text-tertiary">Get specific project</td>
              </tr>
              <tr>
                <td>
                  <span style={{ color: "var(--color-warning)" }}>PUT</span>
                </td>
                <td
                  style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
                >
                  /api/projects/:id
                </td>
                <td className="text-tertiary">Update project</td>
              </tr>
              <tr>
                <td>
                  <span style={{ color: "var(--color-danger)" }}>DELETE</span>
                </td>
                <td
                  style={{ fontFamily: "var(--font-mono)", fontSize: "13px" }}
                >
                  /api/projects/:id
                </td>
                <td className="text-tertiary">Delete project</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </Layout>
  );
};
