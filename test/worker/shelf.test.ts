import { describe, it, expect, beforeAll, beforeEach } from "vite-plus/test";
import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { apiFetch } from "./setup/session";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

beforeEach(async () => {
  await env.DB.prepare("DELETE FROM hidden_books").run();
});

const put = (body: unknown) =>
  apiFetch("https://example.com/api/shelf/hidden", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("/api/shelf/hidden", () => {
  it("starts with nothing put away", async () => {
    const res = await apiFetch("https://example.com/api/shelf/hidden");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ keys: [] });
  });

  it("keeps what was hidden, and gives it back when shown again", async () => {
    const hidden = await put({ keys: ["book-1", "id:abc"], hidden: true });
    expect(((await hidden.json()) as { keys: string[] }).keys.sort()).toStrictEqual([
      "book-1",
      "id:abc",
    ]);

    const shown = await put({ keys: ["book-1"], hidden: false });
    expect(await shown.json()).toStrictEqual({ keys: ["id:abc"] });
  });

  it("takes hiding the same key twice as success", async () => {
    await put({ keys: ["book-1"], hidden: true });
    const again = await put({ keys: ["book-1"], hidden: true });
    expect(again.status).toBe(200);
    expect(await again.json()).toStrictEqual({ keys: ["book-1"] });
  });

  it("refuses an empty list of keys", async () => {
    const res = await put({ keys: [], hidden: true });
    expect(res.status).toBe(400);
  });

  it("is behind the login", async () => {
    const res = await exports.default.fetch("https://example.com/api/shelf/hidden");
    expect(res.status).toBe(401);
  });
});
