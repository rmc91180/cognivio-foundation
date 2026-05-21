let mockRequestUse;

jest.mock("axios", () => ({
  create: jest.fn(() => ({
    interceptors: {
      request: {
        use: mockRequestUse,
      },
    },
  })),
}));

jest.mock("@/lib/runtimeConfig", () => ({
  runtimeConfig: {
    backendUrl: "https://api.example.test",
  },
}));

jest.mock("@/lib/previewMode", () => ({
  getPreviewTargetUserId: jest.fn(() => null),
}));

describe("apiClient auth header behavior", () => {
  let interceptor;

  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    interceptor = null;
    mockRequestUse = jest.fn((fn) => {
      interceptor = fn;
    });
    require("@/lib/apiClient");
  });

  it("does not send stale bearer tokens to public request-access", () => {
    localStorage.setItem("cognivio_token", "stale-token");

    const config = interceptor({ url: "/api/auth/request-access", headers: {} });

    expect(config.headers.Authorization).toBeUndefined();
  });

  it("sends bearer tokens to protected API routes", () => {
    localStorage.setItem("cognivio_token", "active-token");

    const config = interceptor({ url: "/api/me", headers: {} });

    expect(config.headers.Authorization).toBe("Bearer active-token");
  });
});
