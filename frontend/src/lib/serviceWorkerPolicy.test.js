import fs from "fs";
import path from "path";

describe("service worker production cache policy", () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, "../../public/service-worker.js"),
    "utf8"
  );

  it("bypasses API and auth routes", () => {
    expect(source).toContain('url.pathname.startsWith("/api/")');
    expect(source).toContain('url.pathname.startsWith("/login")');
    expect(source).toContain('url.pathname.startsWith("/request-access")');
  });

  it("does not pre-cache the app shell", () => {
    expect(source).not.toContain('"/index.html"');
    expect(source).toContain('fetch(request, { cache: "no-store" })');
  });
});

