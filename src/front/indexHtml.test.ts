import { describe, expect, it } from "vitest";
import html from "../../index.html?raw";

/**
 * What `index.html` asks of the browser that no other test would notice gone.
 *
 * The deploy sits behind Cloudflare Access, which answers a request without its
 * cookie with a redirect to its login. A manifest is fetched without cookies
 * unless the link says otherwise, so dropping the attribute leaves the app
 * uninstallable there — while locally and in E2E, with no Access in front,
 * everything still works.
 */
describe("index.html", () => {
  const head = new DOMParser().parseFromString(html, "text/html").head;

  it("fetches the manifest with the cookie Cloudflare Access lets it through on", () => {
    const manifest = head.querySelector('link[rel="manifest"]');

    expect(manifest?.getAttribute("href")).toBe("/manifest.webmanifest");
    expect(manifest?.getAttribute("crossorigin")).toBe("use-credentials");
  });

  it("says the app runs on its own window under the name browsers no longer warn about", () => {
    expect(head.querySelector('meta[name="mobile-web-app-capable"]')?.getAttribute("content")).toBe(
      "yes",
    );
  });
});
