import { normalizeApiError } from "@/lib/apiErrors";

describe("normalizeApiError", () => {
  it("keeps network and CORS failures separate from credential failures", () => {
    const normalized = normalizeApiError({ request: {}, message: "Network Error" });

    expect(normalized.reason_code).toBe("api_unreachable");
    expect(normalized.message).toMatch(/Unable to reach Cognivio API/i);
    expect(normalized.message).toMatch(/app\.cognivio\.live/i);
  });

  it("maps invalid credentials from backend reason codes", () => {
    const normalized = normalizeApiError({
      response: {
        status: 401,
        data: { detail: { reason_code: "invalid_credentials" } },
      },
    });

    expect(normalized.message).toBe("Invalid email or password.");
    expect(normalized.isAuthStale).toBe(false);
  });

  it("maps lifecycle 403 states without making them generic access errors", () => {
    const pending = normalizeApiError({
      response: {
        status: 403,
        data: { reason_code: "account_pending_approval" },
      },
    });
    const disabled = normalizeApiError({
      response: {
        status: 403,
        data: { reason_code: "account_disabled" },
      },
    });

    expect(pending.message).toMatch(/pending approval/i);
    expect(disabled.message).toMatch(/not active/i);
  });

  it("maps duplicate, validation, rate limit, tenant, and server errors", () => {
    expect(
      normalizeApiError({
        response: { status: 409, data: { reason_code: "access_request_already_pending" } },
      }).message
    ).toMatch(/already pending/i);
    expect(normalizeApiError({ response: { status: 422, data: {} } }).message).toMatch(/check/i);
    expect(normalizeApiError({ response: { status: 429, data: {} } }).message).toMatch(/Too many/i);
    expect(
      normalizeApiError({
        response: { status: 403, data: { reason_code: "forbidden_tenant_access" } },
      }).message
    ).toMatch(/workspace/i);
    expect(normalizeApiError({ response: { status: 500, data: {} } }).message).toMatch(
      /server issue/i
    );
  });
});

