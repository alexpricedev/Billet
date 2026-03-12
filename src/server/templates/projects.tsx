import type { JSX } from "react";
import { CsrfField } from "../components/csrf-field";
import { DataTable } from "../components/data-table";
import { Flash } from "../components/flash";
import { Layout } from "../components/layouts";
import type { Project } from "../services/project";
import type { User } from "../services/users";

export interface ProjectsState {
  state?: "submission-success" | "deletion-success";
}

export type ProjectsProps = {
  projects: Project[];
  state: ProjectsState;
  isAuthenticated: boolean;
  createCsrfToken: string | null;
  deleteCsrfTokens: Record<number, string>;
  user: User | null;
  csrfToken?: string;
};

export const Projects = (props: ProjectsProps): JSX.Element => {
  return (
    <Layout
      title="CRUD - Billet"
      name="projects"
      user={props.user}
      csrfToken={props.csrfToken}
    >
      <h1>CRUD</h1>
      <p className="lead">
        Create, read, update, and delete with server-rendered forms, CSRF
        protection, and flash messages.
      </p>

      {props.state?.state && (
        <Flash type="success">
          {props.state.state === "submission-success" &&
            "Project added successfully."}
          {props.state.state === "deletion-success" &&
            "Project deleted successfully."}
        </Flash>
      )}

      <section className="card">
        <form method="POST" action="/projects" className="project-form">
          <CsrfField token={props.createCsrfToken} />
          <input
            type="text"
            name="title"
            placeholder="New project title"
            required
            minLength={2}
          />
          <button type="submit">Add Project</button>
        </form>
      </section>

      <div className="projects-header">
        <h2>Projects</h2>
        <div
          id="projects-search"
          data-projects={JSON.stringify(
            props.projects.map((p) => ({ id: p.id, title: p.title })),
          )}
        />
      </div>
      {!props.isAuthenticated && (
        <p className="text-tertiary">
          <a href="/login">Log in</a> to delete projects — the delete column
          only renders for authenticated users, showing how auth gates both
          controller logic and template output.
        </p>
      )}
      {props.projects.length === 0 ? (
        <p className="text-tertiary">No projects yet.</p>
      ) : (
        <div id="projects-list">
          <DataTable className="project-list">
            <thead>
              <tr>
                <th>Title</th>
                <th>Created by</th>
                {props.isAuthenticated && <th />}
              </tr>
            </thead>
            <tbody>
              {props.projects.map((project) => (
                <tr key={project.id}>
                  <td>{project.title}</td>
                  <td>
                    {project.created_by
                      ? project.created_by === props.user?.email
                        ? "You"
                        : "User"
                      : "Guest"}
                  </td>
                  {props.isAuthenticated &&
                    props.deleteCsrfTokens[project.id] && (
                      <td className="delete-cell">
                        <form
                          method="POST"
                          action={`/projects/${project.id}/delete`}
                          className="delete-form"
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
          </DataTable>
        </div>
      )}

      <section className="api-section">
        <h2>API Endpoints</h2>
        <p className="text-tertiary">
          The same service layer backs both the HTML forms above and the JSON
          API below — adding an API is simple when business logic lives in one
          place.
        </p>
        <div className="card">
          <DataTable className="endpoint-table">
            <tbody>
              <tr>
                <td>
                  <span className="method-get">GET</span>
                </td>
                <td className="endpoint-path">/api/projects</td>
                <td className="text-tertiary">List all projects</td>
              </tr>
              <tr>
                <td>
                  <span className="method-post">POST</span>
                </td>
                <td className="endpoint-path">/api/projects</td>
                <td className="text-tertiary">Create new project</td>
              </tr>
              <tr>
                <td>
                  <span className="method-get">GET</span>
                </td>
                <td className="endpoint-path">/api/projects/:id</td>
                <td className="text-tertiary">Get specific project</td>
              </tr>
              <tr>
                <td>
                  <span className="method-put">PUT</span>
                </td>
                <td className="endpoint-path">/api/projects/:id</td>
                <td className="text-tertiary">Update project</td>
              </tr>
              <tr>
                <td>
                  <span className="method-delete">DELETE</span>
                </td>
                <td className="endpoint-path">/api/projects/:id</td>
                <td className="text-tertiary">Delete project</td>
              </tr>
            </tbody>
          </DataTable>
        </div>
      </section>
    </Layout>
  );
};
