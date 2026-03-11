import { admin } from "../controllers/admin";

export const adminRoutes = {
  "/admin": admin.index,
};
