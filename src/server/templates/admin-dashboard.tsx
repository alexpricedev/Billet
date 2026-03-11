import { Layout } from "@server/components/layouts";
import type { SessionContext } from "@server/middleware/auth";

export const AdminDashboard = (props: { auth: SessionContext }) => (
  <Layout title="Admin" name="admin">
    <h1>Admin</h1>
    <p>Logged in as {props.auth.user?.email}</p>
  </Layout>
);
