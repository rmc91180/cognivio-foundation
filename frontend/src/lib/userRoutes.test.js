import { canAccess } from "@/lib/roleRouter";
import { getDefaultHomeRoute } from "@/lib/userRoutes";

describe("role route contract", () => {
  const superAdmin = { email: "rmc91180@gmail.com", role: "super_admin", tenant_role: "super_admin" };
  const schoolAdmin = { email: "admin@example.com", role: "admin", tenant_role: "school_admin" };
  const trainingAdmin = { email: "training@example.com", role: "admin", tenant_role: "training_admin" };
  const teacher = { email: "teacher@example.com", role: "teacher", tenant_role: "teacher" };

  it("routes each role to an existing home route", () => {
    expect(getDefaultHomeRoute(superAdmin)).toBe("/master-admin");
    expect(getDefaultHomeRoute(schoolAdmin)).toBe("/dashboard");
    expect(getDefaultHomeRoute(trainingAdmin)).toBe("/dashboard");
    expect(getDefaultHomeRoute(teacher)).toBe("/my-workspace");
  });

  it("allows each role to access its own home route", () => {
    expect(canAccess(superAdmin, "/master-admin")).toBe(true);
    expect(canAccess(schoolAdmin, "/dashboard")).toBe(true);
    expect(canAccess(trainingAdmin, "/dashboard")).toBe(true);
    expect(canAccess(teacher, "/my-workspace")).toBe(true);
  });

  it("honors explicit route guard tenant role allow-lists", () => {
    expect(canAccess(schoolAdmin, "/dashboard", ["school_admin"])).toBe(true);
    expect(canAccess(trainingAdmin, "/dashboard", ["school_admin"])).toBe(false);
    expect(canAccess(superAdmin, "/dashboard", ["school_admin"])).toBe(true);
    expect(canAccess(teacher, "/my-workspace", ["teacher"])).toBe(true);
  });

  it("does not point roles at legacy missing /admin or /teacher homes", () => {
    [superAdmin, schoolAdmin, trainingAdmin, teacher].forEach((user) => {
      expect(getDefaultHomeRoute(user)).not.toBe("/admin");
      expect(getDefaultHomeRoute(user)).not.toBe("/teacher");
    });
  });
});
