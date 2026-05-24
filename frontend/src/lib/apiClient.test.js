let mockRequestUse;
let mockResponseUse;

jest.mock("axios", () => ({
  create: jest.fn(() => ({
    interceptors: {
      request: {
        use: mockRequestUse,
      },
      response: {
        use: mockResponseUse,
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
  clearPreviewSession: jest.fn(),
  getPreviewTargetUserId: jest.fn(() => null),
}));

describe("apiClient auth header and stale-session behavior", () => {
  let interceptor;
  let responseRejected;
  let axios;

  beforeEach(() => {
    jest.resetModules();
    localStorage.clear();
    interceptor = null;
    responseRejected = null;
    mockRequestUse = jest.fn((fn) => {
      interceptor = fn;
    });
    mockResponseUse = jest.fn((_fulfilled, rejected) => {
      responseRejected = rejected;
    });
    axios = require("axios");
    require("@/lib/apiClient");
  });

  it("uses the configured API base for login and current-user calls", () => {
    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({
        baseURL: "https://api.example.test",
      })
    );
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

  it("clears stale bearer tokens after protected 401 responses", async () => {
    localStorage.setItem("cognivio_token", "expired-token");
    const listener = jest.fn();
    window.addEventListener("cognivio:auth-stale", listener);

    await expect(
      responseRejected({
        config: { url: "/api/me" },
        response: {
          status: 401,
          data: { detail: "Authentication token expired" },
        },
      })
    ).rejects.toMatchObject({
      normalized: {
        status: 401,
        isAuthStale: true,
      },
    });

    expect(localStorage.getItem("cognivio_token")).toBeNull();
    expect(listener).toHaveBeenCalled();
    window.removeEventListener("cognivio:auth-stale", listener);
  });

  it("does not clear auth for public login 401 responses", async () => {
    localStorage.setItem("cognivio_token", "existing-token");

    await expect(
      responseRejected({
        config: { url: "/api/auth/login" },
        response: {
          status: 401,
          data: { detail: { reason_code: "invalid_credentials" } },
        },
      })
    ).rejects.toMatchObject({
      normalized: {
        reason_code: "invalid_credentials",
      },
    });

    expect(localStorage.getItem("cognivio_token")).toBe("existing-token");
  });
});
