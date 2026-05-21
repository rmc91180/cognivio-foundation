import { getAccessRequestSuccessMessage, getAuthErrorMessage } from "@/lib/authMessages";

describe("auth lifecycle messages", () => {
  it("uses backend reason codes for request-access duplicates", () => {
    const message = getAuthErrorMessage(
      {
        response: {
          data: {
            detail: {
              reason_code: "access_request_already_pending",
            },
          },
        },
      },
      "fallback"
    );

    expect(message).toMatch(/already pending/i);
  });

  it("treats notification warnings as successful request receipt", () => {
    const message = getAccessRequestSuccessMessage(
      {
        status: "pending",
        notification: {
          sent: false,
          warning: "notification_delivery_failed",
        },
      },
      "fallback"
    );

    expect(message).toMatch(/request received/i);
    expect(message).toMatch(/waiting for review/i);
  });
});
