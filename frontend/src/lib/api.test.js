import api from "@/lib/apiClient";
import { demoApi, masterAdminApi } from "@/lib/api";

jest.mock("@/lib/apiClient", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
  },
}));

describe("masterAdminApi user lifecycle endpoints", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("routes delete to the hard-delete endpoint", () => {
    const payload = { reason: "cleanup", confirmation_text: "teacher@example.com" };

    masterAdminApi.deleteUser("user-1", payload);

    expect(api.post).toHaveBeenCalledWith("/api/master-admin/users/user-1/delete", payload);
  });

  it("keeps freeze and revoke separate from hard delete", () => {
    const payload = { reason: "pause access" };

    masterAdminApi.freezeUser("user-1", payload);
    masterAdminApi.revokeUser("user-2", payload);

    expect(api.post).toHaveBeenCalledWith("/api/master-admin/users/user-1/freeze", payload);
    expect(api.post).toHaveBeenCalledWith("/api/master-admin/users/user-2/revoke", payload);
    expect(api.post).not.toHaveBeenCalledWith(
      expect.stringContaining("/delete"),
      expect.objectContaining({ reason: "pause access" })
    );
  });

  it("routes demo reset through the protected demo endpoint", () => {
    demoApi.reset("training");

    expect(api.post).toHaveBeenCalledWith("/api/demo/reset", null, {
      params: { persona: "training" },
    });
  });
});
