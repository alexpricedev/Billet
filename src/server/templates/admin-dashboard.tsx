import { Badge } from "@server/components/badge";
import { DataTable } from "@server/components/data-table";
import { Layout } from "@server/components/layouts";
import type { SessionContext } from "@server/middleware/auth";
import type { User } from "@server/services/users";

const formatDate = (date: Date): string =>
  new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

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
    <div className="admin-content">
      <div className="admin-header">
        <h1>Admin</h1>
        <p className="text-quaternary">Manage users and system settings</p>
      </div>

      <div className="admin-table-wrap">
        <DataTable>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>
            {props.users.length === 0 ? (
              <tr>
                <td colSpan={3} className="admin-empty">
                  No users found.
                </td>
              </tr>
            ) : (
              props.users.map((user) => (
                <tr key={user.id}>
                  <td className="admin-email">{user.email}</td>
                  <td>
                    <Badge variant={user.role === "admin" ? "admin" : "user"}>
                      {user.role}
                    </Badge>
                  </td>
                  <td className="admin-date">{formatDate(user.created_at)}</td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </div>
    </div>
  </Layout>
);
