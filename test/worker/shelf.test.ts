import { describe, it, expect, beforeAll, beforeEach } from "vite-plus/test";
import { applyD1Migrations } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { apiFetch } from "./setup/session";
import { MINIMAL_PDF_BYTES } from "./fixtures/minimalPdf";

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

interface CollectionsBody {
  collections: { id: string; name: string; keys: string[] }[];
}

const collectionsApi = (path = "", init: { method: string; body?: unknown } = { method: "GET" }) =>
  apiFetch(`https://example.com/api/shelf/collections${path}`, {
    method: init.method,
    headers: { "Content-Type": "application/json" },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });

async function createCollection(name: string, keys?: string[]): Promise<CollectionsBody> {
  const res = await collectionsApi("", { method: "POST", body: { name, keys } });
  expect(res.status).toBe(200);
  return (await res.json()) as CollectionsBody;
}

async function collectionItemCount(): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM collection_items").first<{
    n: number;
  }>();
  return row?.n ?? -1;
}

/** A book stored from disk alone — no Dropbox folder is chosen in this file. */
async function storeBookFromDisk(tag: string): Promise<string> {
  const suffix = new TextEncoder().encode(`\n%${tag}\n`);
  const bytes = new Uint8Array(MINIMAL_PDF_BYTES.length + suffix.length);
  bytes.set(MINIMAL_PDF_BYTES, 0);
  bytes.set(suffix, MINIMAL_PDF_BYTES.length);
  const formData = new FormData();
  formData.append("file", new File([bytes], `${tag}.pdf`, { type: "application/pdf" }));
  formData.append("fullText", "text");
  formData.append("pageCount", "1");
  const res = await apiFetch("https://example.com/api/pdf/open", {
    method: "POST",
    body: formData,
  });
  return ((await res.json()) as { id: string }).id;
}

describe("/api/shelf/collections", () => {
  beforeEach(async () => {
    await env.DB.prepare("DELETE FROM collection_items").run();
    await env.DB.prepare("DELETE FROM collections").run();
  });

  it("starts with no collection", async () => {
    const res = await collectionsApi();
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ collections: [] });
  });

  it("makes a collection under a trimmed name, with what it is handed already in it", async () => {
    const { collections } = await createCollection("  Rust  ", ["book-1", "id:abc"]);
    expect(collections).toHaveLength(1);
    expect(collections[0]).toMatchObject({ name: "Rust", keys: ["book-1", "id:abc"] });

    const listed = (await (await collectionsApi()).json()) as CollectionsBody;
    expect(listed.collections.map((c) => c.name)).toStrictEqual(["Rust"]);
  });

  it("lists the collections oldest first", async () => {
    await createCollection("最初");
    const { collections } = await createCollection("次");
    expect(collections.map((c) => c.name)).toStrictEqual(["最初", "次"]);
  });

  it("refuses a name that is blank or too long", async () => {
    expect((await collectionsApi("", { method: "POST", body: { name: "   " } })).status).toBe(400);
    expect(
      (await collectionsApi("", { method: "POST", body: { name: "x".repeat(101) } })).status,
    ).toBe(400);
  });

  it("puts one key in any number of collections, and takes it out of one", async () => {
    const first = (await createCollection("技術書")).collections[0];
    const second = (await createCollection("積読")).collections[1];

    for (const id of [first.id, second.id]) {
      const res = await collectionsApi(`/${id}/items`, {
        method: "PUT",
        body: { keys: ["book-1", "id:epub"], member: true },
      });
      expect(res.status).toBe(200);
    }
    // Putting in what is already there is not an error
    const again = await collectionsApi(`/${first.id}/items`, {
      method: "PUT",
      body: { keys: ["book-1"], member: true },
    });
    expect(again.status).toBe(200);

    const out = await collectionsApi(`/${first.id}/items`, {
      method: "PUT",
      body: { keys: ["book-1", "id:epub"], member: false },
    });
    const { collections } = (await out.json()) as CollectionsBody;
    expect(collections.find((c) => c.id === first.id)?.keys).toStrictEqual([]);
    expect(collections.find((c) => c.id === second.id)?.keys.sort()).toStrictEqual([
      "book-1",
      "id:epub",
    ]);
  });

  it("renames a collection", async () => {
    const { id } = (await createCollection("前の名前")).collections[0];
    const res = await collectionsApi(`/${id}`, { method: "PATCH", body: { name: "新しい名前" } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as CollectionsBody).collections[0].name).toBe("新しい名前");
  });

  it("deletes a collection and what it lists, and leaves the books on the shelf", async () => {
    const bookId = await storeBookFromDisk("in-a-deleted-collection");
    const { id } = (await createCollection("消すコレクション", [bookId])).collections[0];

    const res = await collectionsApi(`/${id}`, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toStrictEqual({ collections: [] });
    expect(await collectionItemCount()).toBe(0);

    const book = await apiFetch(`https://example.com/api/pdf/${bookId}`);
    expect(book.status).toBe(200);
  });

  it("answers 404 for a collection that is not there, and writes nothing under it", async () => {
    const renamed = await collectionsApi("/nothing", { method: "PATCH", body: { name: "x" } });
    expect(renamed.status).toBe(404);
    expect(await renamed.json()).toMatchObject({ error: { code: "COLLECTION_NOT_FOUND" } });
    expect((await collectionsApi("/nothing", { method: "DELETE" })).status).toBe(404);
    const items = await collectionsApi("/nothing/items", {
      method: "PUT",
      body: { keys: ["book-1"], member: true },
    });
    expect(items.status).toBe(404);
    expect(await collectionItemCount()).toBe(0);
  });

  it("refuses an empty list of keys", async () => {
    const { id } = (await createCollection("空")).collections[0];
    const res = await collectionsApi(`/${id}/items`, {
      method: "PUT",
      body: { keys: [], member: true },
    });
    expect(res.status).toBe(400);
  });

  it("takes a deleted book out of every collection when it has no Dropbox file to go back to", async () => {
    const bookId = await storeBookFromDisk("deleted-from-collections");
    await createCollection("一つ目", [bookId, "book-other"]);
    await createCollection("二つ目", [bookId]);

    await apiFetch(`https://example.com/api/pdf/${bookId}`, { method: "DELETE" });

    const { collections } = (await (await collectionsApi()).json()) as CollectionsBody;
    expect(collections.map((c) => c.keys)).toStrictEqual([["book-other"], []]);
  });

  it("is behind the login", async () => {
    const res = await exports.default.fetch("https://example.com/api/shelf/collections");
    expect(res.status).toBe(401);
  });
});
