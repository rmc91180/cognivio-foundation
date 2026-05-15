import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import NotificationBell from "@/components/NotificationBell";
import api from "@/lib/api";

jest.mock("@/lib/api", () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
  },
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("treats a missing notification endpoint as zero unread", async () => {
    api.get.mockRejectedValueOnce({ response: { status: 404 } });

    render(
      <MemoryRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <NotificationBell />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByLabelText("No unread notifications")).toBeTruthy();
    });
    expect(api.get).toHaveBeenCalledWith("/api/notifications/unread-count");
  });
});
