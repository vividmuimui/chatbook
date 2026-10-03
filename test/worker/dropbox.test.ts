import { describe, it, expect, beforeAll, beforeEach } from "vite-plus/test";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { server } from "./setup/msw";
import { apiFetch } from "./setup/session";
import { MINIMAL_PDF_BYTES } from "./fixtures/minimalPdf";
import { dropboxContentHash } from "../../src/server/services/dropboxService";
import { pdfObjectKey } from "../../src/server/services/pdfService";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** Distinct, still-valid PDF bytes, so each test's book is a book of its own. */
function uniquePdfBytes(tag: string): Uint8Array {
  const suffix = new TextEncoder().encode(`\n%${tag}\n`);
  const bytes = new Uint8Array(MINIMAL_PDF_BYTES.length + suffix.length);
  bytes.set(MINIMAL_PDF_BYTES, 0);
  bytes.set(suffix, MINIMAL_PDF_BYTES.length);
  return bytes;
}

interface FakeFile {
  id: string;
  pathDisplay: string;
  bytes: Uint8Array;
}

/**
 * A Dropbox of folders and files, answering the five endpoints the Worker
 * calls. Listings come back in two pages so the `continue` call is exercised.
 */
class FakeDropbox {
  folders = new Set(["/books", "/books/rust", "/other"]);
  files: FakeFile[] = [];
  uploads: { arg: string; bytes: Uint8Array }[] = [];
  failUploads = false;
  private nextId = 1;

  add(pathDisplay: string, bytes: Uint8Array): FakeFile {
    const file = { id: `id:file${this.nextId++}`, pathDisplay, bytes };
    this.files.push(file);
    return file;
  }

  private async entry(file: FakeFile) {
    return {
      ".tag": "file",
      id: file.id,
      name: file.pathDisplay.split("/").pop(),
      path_lower: file.pathDisplay.toLowerCase(),
      path_display: file.pathDisplay,
      size: file.bytes.byteLength,
      content_hash: await dropboxContentHash(file.bytes.slice().buffer),
    };
  }

  private notFound() {
    return HttpResponse.json({ error_summary: "path/not_found/.." }, { status: 409 });
  }

  handlers() {
    return [
      http.post("https://api.dropboxapi.com/oauth2/token", () =>
        HttpResponse.json({ access_token: "test-access-token", expires_in: 14400 }),
      ),
      http.post("https://api.dropboxapi.com/2/files/get_metadata", async ({ request }) => {
        const { path } = (await request.json()) as { path: string };
        if (this.folders.has(path.toLowerCase())) {
          return HttpResponse.json({ ".tag": "folder", path_display: path });
        }
        const file = this.files.find((f) => f.pathDisplay.toLowerCase() === path.toLowerCase());
        return file ? HttpResponse.json(await this.entry(file)) : this.notFound();
      }),
      http.post("https://api.dropboxapi.com/2/files/list_folder", async ({ request }) => {
        const { path } = (await request.json()) as { path: string };
        if (!this.folders.has(path.toLowerCase())) return this.notFound();
        const inside = this.files.filter((f) =>
          f.pathDisplay.toLowerCase().startsWith(`${path.toLowerCase()}/`),
        );
        const entries = await Promise.all(inside.map((f) => this.entry(f)));
        const half = Math.ceil(entries.length / 2);
        this.pendingPage = entries.slice(half);
        return HttpResponse.json({
          entries: [{ ".tag": "folder", name: "rust" }, ...entries.slice(0, half)],
          cursor: "page-2",
          has_more: true,
        });
      }),
      http.post("https://api.dropboxapi.com/2/files/list_folder/continue", () =>
        HttpResponse.json({ entries: this.pendingPage, cursor: "end", has_more: false }),
      ),
      http.post("https://content.dropboxapi.com/2/files/download", async ({ request }) => {
        const { path } = JSON.parse(request.headers.get("Dropbox-API-Arg") ?? "{}");
        const file = this.files.find((f) => f.id === path);
        if (!file) return this.notFound();
        return new HttpResponse(file.bytes.slice(), {
          headers: { "Dropbox-API-Result": JSON.stringify(await this.entry(file)) },
        });
      }),
      http.post("https://content.dropboxapi.com/2/files/upload", async ({ request }) => {
        if (this.failUploads) return new HttpResponse("too_many_write_operations", { status: 429 });
        const arg = request.headers.get("Dropbox-API-Arg") ?? "{}";
        const bytes = new Uint8Array(await request.arrayBuffer());
        this.uploads.push({ arg, bytes });
        const { path } = JSON.parse(arg) as { path: string };
        return HttpResponse.json(await this.entry(this.add(path, bytes)));
      }),
    ];
  }

  private pendingPage: unknown[] = [];
}

let dropbox: FakeDropbox;

beforeEach(async () => {
  dropbox = new FakeDropbox();
  server.use(...dropbox.handlers());
  await env.DB.prepare("DELETE FROM settings").run();
});

async function chooseFolder(folder: string): Promise<Response> {
  return apiFetch("https://example.com/api/dropbox/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder }),
  });
}

async function listFolder() {
  const response = await apiFetch("https://example.com/api/dropbox/files");
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** Stores a book the way the reader does after reading a Dropbox file. */
async function importFromDropbox(dropboxId: string): Promise<Response> {
  const formData = new FormData();
  formData.append("dropboxId", dropboxId);
  formData.append("fullText", "text");
  formData.append("pageCount", "1");
  return apiFetch("https://example.com/api/pdf/open", { method: "POST", body: formData });
}

async function uploadFromDisk(bytes: Uint8Array, fileName: string): Promise<Response> {
  const formData = new FormData();
  formData.append("file", new File([bytes], fileName, { type: "application/pdf" }));
  formData.append("fullText", "text");
  formData.append("pageCount", "1");
  return apiFetch("https://example.com/api/pdf/open", { method: "POST", body: formData });
}

describe("Dropbox folder settings", () => {
  it("reports that Dropbox is there but no folder has been chosen", async () => {
    const response = await apiFetch("https://example.com/api/dropbox/settings");
    expect(await response.json()).toStrictEqual({ available: true, folder: null });
  });

  it("keeps a folder that exists, spelled the one way it is stored", async () => {
    const response = await chooseFolder(" books/ ");
    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ available: true, folder: "/books" });

    const settings = await apiFetch("https://example.com/api/dropbox/settings");
    expect(await settings.json()).toStrictEqual({ available: true, folder: "/books" });
  });

  it("refuses a folder Dropbox does not have, and keeps the one before it", async () => {
    await chooseFolder("/books");
    const response = await chooseFolder("/nowhere");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "DROPBOX_FOLDER_NOT_FOUND" } });

    const settings = await apiFetch("https://example.com/api/dropbox/settings");
    expect(await settings.json()).toMatchObject({ folder: "/books" });
  });
});

describe("GET /api/dropbox/files", () => {
  it("says so when no folder has been chosen", async () => {
    expect(await listFolder()).toStrictEqual({ status: 200, body: { state: "no-folder" } });
  });

  it("lists the PDFs and EPUBs in the folder and the folders under it, and nothing else", async () => {
    dropbox.add("/books/Zig.pdf", uniquePdfBytes("zig"));
    dropbox.add("/books/rust/The Book.PDF", uniquePdfBytes("rust"));
    dropbox.add("/books/novel/Novel.epub", new TextEncoder().encode("PK\x03\x04novel"));
    dropbox.add("/books/notes.txt", new TextEncoder().encode("not a book"));
    dropbox.add("/other/Elsewhere.pdf", uniquePdfBytes("elsewhere"));
    await chooseFolder("/books");

    const { status, body } = await listFolder();
    expect(status).toBe(200);
    expect(body).toMatchObject({ state: "ready", folder: "/books" });
    expect((body.files as { path: string }[]).map((f) => f.path)).toStrictEqual([
      "/novel/Novel.epub",
      "/rust/The Book.PDF",
      "/Zig.pdf",
    ]);
  });

  it("leaves out the files that are already books", async () => {
    const kept = dropbox.add("/books/Read.pdf", uniquePdfBytes("read"));
    dropbox.add("/books/Unread.pdf", uniquePdfBytes("unread"));
    await chooseFolder("/books");
    expect((await importFromDropbox(kept.id)).status).toBe(200);

    const { body } = await listFolder();
    expect((body.files as { name: string }[]).map((f) => f.name)).toStrictEqual(["Unread.pdf"]);
  });

  it("tells the reader the chosen folder has gone", async () => {
    await chooseFolder("/other");
    dropbox.folders.delete("/other");

    const { status, body } = await listFolder();
    expect(status).toBe(404);
    expect(body).toMatchObject({ error: { code: "DROPBOX_FOLDER_NOT_FOUND" } });
  });
});

describe("GET /api/dropbox/file", () => {
  it("hands over the bytes of a file in the folder", async () => {
    const bytes = uniquePdfBytes("download");
    const file = dropbox.add("/books/Download.pdf", bytes);
    await chooseFolder("/books");

    const response = await apiFetch(`https://example.com/api/dropbox/file?id=${file.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(bytes);
  });

  it("names an EPUB as one", async () => {
    const file = dropbox.add("/books/Novel.epub", new TextEncoder().encode("PK\x03\x04epub"));
    await chooseFolder("/books");

    const response = await apiFetch(`https://example.com/api/dropbox/file?id=${file.id}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/epub+zip");
    await response.arrayBuffer();
  });

  it("does not reach outside the folder by id", async () => {
    const outside = dropbox.add("/other/Private.pdf", uniquePdfBytes("private"));
    await chooseFolder("/books");

    const response = await apiFetch(`https://example.com/api/dropbox/file?id=${outside.id}`);
    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "DROPBOX_FILE_NOT_FOUND" } });
  });
});

describe("POST /api/pdf/open with a Dropbox file", () => {
  it("stores the book from Dropbox's bytes, under Dropbox's name for it", async () => {
    const bytes = uniquePdfBytes("import");
    const file = dropbox.add("/books/rust/Imported.pdf", bytes);
    await chooseFolder("/books");

    const response = await importFromDropbox(file.id);
    expect(response.status).toBe(200);
    const book = (await response.json()) as { id: string; fileName: string };
    expect(book.fileName).toBe("Imported.pdf");

    const served = await apiFetch(`https://example.com/api/pdf/${book.id}/file`);
    expect(new Uint8Array(await served.arrayBuffer())).toStrictEqual(bytes);
    expect(dropbox.uploads).toStrictEqual([]);

    const shelf = (await (await apiFetch("https://example.com/api/pdfs")).json()) as {
      books: { id: string; inDropbox: boolean }[];
    };
    expect(shelf.books.find((b) => b.id === book.id)?.inDropbox).toBe(true);
  });

  it("refuses a file outside the folder", async () => {
    const outside = dropbox.add("/other/Outside.pdf", uniquePdfBytes("outside-import"));
    await chooseFolder("/books");

    const response = await importFromDropbox(outside.id);
    expect(response.status).toBe(404);
  });
});

describe("POST /api/pdf/open with a file from disk", () => {
  it("writes the book into the Dropbox folder, Japanese name and all", async () => {
    await chooseFolder("/books");
    const bytes = uniquePdfBytes("upload");

    const response = await uploadFromDisk(bytes, "日本語の本.pdf");
    expect(response.status).toBe(200);

    expect(dropbox.uploads).toHaveLength(1);
    const [upload] = dropbox.uploads;
    // A header has to be ASCII; the name travels as JSON escapes.
    expect(upload.arg).toMatch(/^[\x20-\x7e]*$/);
    expect(JSON.parse(upload.arg)).toMatchObject({
      path: "/books/日本語の本.pdf",
      mode: "add",
      autorename: true,
    });
    expect(upload.bytes).toStrictEqual(bytes);

    // Now a Dropbox file that is a book, so not one waiting to be read.
    const { body } = await listFolder();
    expect(body.files).toStrictEqual([]);
  });

  it("links a file already in the folder instead of writing a second copy", async () => {
    const bytes = uniquePdfBytes("already-there");
    dropbox.add("/books/rust/Already There.pdf", bytes);
    await chooseFolder("/books");

    const response = await uploadFromDisk(bytes, "renamed on disk.pdf");
    expect(response.status).toBe(200);
    expect(dropbox.uploads).toStrictEqual([]);

    const { body } = await listFolder();
    expect(body.files).toStrictEqual([]);
  });

  it("stores nothing when Dropbox refuses the upload", async () => {
    await chooseFolder("/books");
    dropbox.failUploads = true;

    const response = await uploadFromDisk(uniquePdfBytes("refused"), "Refused.pdf");
    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { code: "DROPBOX_ERROR" } });

    const shelf = (await (await apiFetch("https://example.com/api/pdfs")).json()) as {
      books: { fileName: string }[];
    };
    expect(shelf.books.map((b) => b.fileName)).not.toContain("Refused.pdf");
  });

  it("keeps the book in R2 alone while no folder is chosen", async () => {
    const response = await uploadFromDisk(uniquePdfBytes("r2-only"), "R2 Only.pdf");
    expect(response.status).toBe(200);
    expect(dropbox.uploads).toStrictEqual([]);
  });
});

describe("GET /api/pdf/:pdfId/file for a Dropbox book", () => {
  it("makes the R2 copy again from Dropbox when it is gone", async () => {
    const bytes = uniquePdfBytes("refill");
    const file = dropbox.add("/books/Refill.pdf", bytes);
    await chooseFolder("/books");
    const book = (await (await importFromDropbox(file.id)).json()) as { id: string };

    const row = await env.DB.prepare("SELECT file_hash FROM pdfs WHERE id = ?")
      .bind(book.id)
      .first<{ file_hash: string }>();
    await env.PDF_BUCKET.delete(pdfObjectKey(row!.file_hash));

    const response = await apiFetch(`https://example.com/api/pdf/${book.id}/file`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toStrictEqual(bytes);
    expect(await env.PDF_BUCKET.head(pdfObjectKey(row!.file_hash))).not.toBeNull();
  });
});
