import { canAccess } from "@/lib/roleRouter";

describe("canAccess — super_admin /videos route gate (regression: superadmin video playback)", () => {
  const superAdmin = { role: "super_admin" };
  const teacher = { role: "teacher" };
  const guest = null;

  it("allows super_admin to open a shared video player at /videos/:id", () => {
    // exact gate that previously returned false and bounced super-admins to RoleMismatch
    expect(
      canAccess(superAdmin, "/videos/abc123", ["teacher", "school_admin", "training_admin"])
    ).toBe(true);
  });

  it("allows super_admin to open the /videos index", () => {
    expect(
      canAccess(superAdmin, "/videos", ["teacher", "school_admin", "training_admin"])
    ).toBe(true);
  });

  it("FAIL-CLOSED: super_admin is still denied /privacy-review (not in SUPER_ADMIN_ROUTES)", () => {
    // /privacy-review is real and deliberately NOT in SUPER_ADMIN_ROUTES; proves we
    // widened by exactly /videos, not blanket-opened. If this is true, over-widened.
    expect(canAccess(superAdmin, "/privacy-review", ["school_admin"])).toBe(false);
  });

  it("FAIL-CLOSED: super_admin is still denied /cohorts", () => {
    expect(canAccess(superAdmin, "/cohorts", ["training_admin"])).toBe(false);
  });

  it("SYMMETRY: a teacher can open /videos/:id, an unauthenticated guest cannot", () => {
    expect(
      canAccess(teacher, "/videos/abc123", ["teacher", "school_admin", "training_admin"])
    ).toBe(true);
    expect(
      canAccess(guest, "/videos/abc123", ["teacher", "school_admin", "training_admin"])
    ).toBe(false);
  });
});
