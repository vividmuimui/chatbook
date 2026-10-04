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

describe("/api/shelf/titles", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM book_titles").run();
  });

  const putTitles = (body: unknown) =>
    apiFetch("https://example.com/api/shelf/titles", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  it("starts with no Dropbox file titled", async () => {
    const res = await apiFetch("https://example.com/api/shelf/titles");
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ titles: [] });
  });

  it("keeps a title given to Dropbox files, trimmed, and answers with every title", async () => {
    const res = await putTitles({ keys: ["id:pdf", "id:epub"], title: "  詳解 Rust  " });
    expect(res.status).toBe(200);
    const { titles } = (await res.json()) as { titles: { key: string; title: string }[] };
    expect(titles.sort((a, b) => a.key.localeCompare(b.key))).toStrictEqual([
      { key: "id:epub", title: "詳解 Rust" },
      { key: "id:pdf", title: "詳解 Rust" },
    ]);
  });

  it("gives a titled file a new title, and takes it away on a blank one", async () => {
    await putTitles({ keys: ["id:pdf"], title: "前の題名" });
    const renamed = await putTitles({ keys: ["id:pdf"], title: "新しい題名" });
    expect(await renamed.json()).toStrictEqual({
      titles: [{ key: "id:pdf", title: "新しい題名" }],
    });

    const cleared = await putTitles({ keys: ["id:pdf"], title: "   " });
    expect(await cleared.json()).toStrictEqual({ titles: [] });
  });

  it("refuses a key that is not a Dropbox id — a book's title is its own row's", async () => {
    const res = await putTitles({ keys: ["01JBOOK"], title: "題名" });
    expect(res.status).toBe(400);
  });

  it("is behind the login", async () => {
    const res = await exports.default.fetch("https://example.com/api/shelf/titles");
    expect(res.status).toBe(401);
  });
});
