import {
  APP_ORIGIN,
  getAppRedirectUrl,
  isCanonicalAppHost,
  isMarketingHost,
} from "@/lib/domainHardening";

describe("domain hardening helpers", () => {
  it("preserves path, query, and hash for wrong-origin app routes", () => {
    const target = getAppRedirectUrl({
      hostname: "www.cognivio.live",
      pathname: "/login",
      search: "?next=%2Fdashboard",
      hash: "#top",
    });

    expect(target).toBe(`${APP_ORIGIN}/login?next=%2Fdashboard#top`);
  });

  it("redirects app routes from root marketing host but not the app host", () => {
    expect(
      getAppRedirectUrl({
        hostname: "cognivio.live",
        pathname: "/my-workspace",
      })
    ).toBe(`${APP_ORIGIN}/my-workspace`);
    expect(
      getAppRedirectUrl({
        hostname: "app.cognivio.live",
        pathname: "/login",
      })
    ).toBeNull();
  });

  it("leaves marketing pages on marketing hosts", () => {
    expect(
      getAppRedirectUrl({
        hostname: "cognivio.live",
        pathname: "/about/",
      })
    ).toBeNull();
    expect(isMarketingHost("www.cognivio.live")).toBe(true);
    expect(isCanonicalAppHost("app.cognivio.live")).toBe(true);
  });
});

