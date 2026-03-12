import { Layout } from "@server/components/layouts";
import type { SessionContext } from "@server/middleware/auth";
import type { User } from "@server/services/users";
import type React from "react";

const formatDate = (date: Date): string =>
  new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

const thStyle: React.CSSProperties = {
  padding: "10px 24px",
  textAlign: "left",
  fontSize: "12px",
  fontWeight: 500,
  color: "var(--color-text-quaternary)",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid var(--color-border)",
};

const tdStyle: React.CSSProperties = {
  padding: "14px 24px",
  fontSize: "14px",
  borderBottom: "1px solid var(--color-border)",
};

const RoleBadge = ({ role }: { role: User["role"] }) => {
  const isAdmin = role === "admin";
  return (
    <span
      className="badge"
      style={{
        background: isAdmin
          ? "rgba(124, 133, 240, 0.12)"
          : "var(--color-surface-hover)",
        color: isAdmin
          ? "var(--color-primary)"
          : "var(--color-text-quaternary)",
      }}
    >
      {role}
    </span>
  );
};

export const AdminDashboard = (props: {
  auth: SessionContext;
  users: User[];
  user: User | null;
  csrfToken?: string;
}) => (
  <Layout
    title="Admin"
    name="admin"
    user={props.user}
    csrfToken={props.csrfToken}
  >
    <div style={{ maxWidth: "960px", margin: "0 auto", padding: "0 24px" }}>
      <div style={{ marginBottom: "32px" }}>
        <h1>Admin</h1>
        <p className="text-quaternary" style={{ margin: 0, fontSize: "14px" }}>
          Manage users and system settings
        </p>
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>Email</th>
              <th style={thStyle}>Role</th>
              <th style={thStyle}>Joined</th>
            </tr>
          </thead>
          <tbody>
            {props.users.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  style={{
                    ...tdStyle,
                    textAlign: "center",
                    color: "var(--color-text-quaternary)",
                  }}
                >
                  No users found.
                </td>
              </tr>
            ) : (
              props.users.map((user) => (
                <tr key={user.id}>
                  <td style={{ ...tdStyle, color: "var(--color-text)" }}>
                    {user.email}
                  </td>
                  <td style={tdStyle}>
                    <RoleBadge role={user.role} />
                  </td>
                  <td
                    style={{
                      ...tdStyle,
                      color: "var(--color-text-quaternary)",
                    }}
                  >
                    {formatDate(user.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  </Layout>
);
