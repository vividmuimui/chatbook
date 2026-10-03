import { describe, it, expect, beforeAll } from "vite-plus/test";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { http, HttpResponse } from "msw";
import { apiFetch } from "./setup/session";
import { server } from "./setup/msw";
import { MINIMAL_PDF_BYTES } from "./fixtures/minimalPdf";
import app from "../../src/server/index";
import { SESSION_COOKIE, issueSession } from "../../src/server/auth/session";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** The provider `vitest.workers.config.ts` points the Worker at. */
const COMPLETIONS_URL = "https://llm.test/chat/completions";

const PAGES = [
  "表紙",
  "目次",
  "第1章 はじめに\nこの本では……",
  "続き",
  "第2章 しくみ\n仕組みを見ていく",
  "おわりに",
];

/** A book of its own, since books are de-duplicated by their bytes. */
async function uploadBook(
  tag: string,
  outline?: { title: string; pageNumber: number }[],
): Promise<string> {
  const suffix = new TextEncoder().encode(`\n%${tag}\n`);
  const bytes = new Uint8Array(MINIMAL_PDF_BYTES.length + suffix.length);
  bytes.set(MINIMAL_PDF_BYTES, 0);
  bytes.set(suffix, MINIMAL_PDF_BYTES.length);

  const formData = new FormData();
  formData.append("file", new File([bytes], `${tag}.pdf`, { type: "application/pdf" }));
  formData.append("fullText", PAGES.join("\f"));
  formData.append("pageCount", String(PAGES.length));
  if (outline) formData.append("outline", JSON.stringify(outline));

  const response = await apiFetch("https://example.com/api/pdf/open", {
    method: "POST",
    body: formData,
  });
  return ((await response.json()) as { id: string }).id;
}

/** A chat completions answer whose message says `content`. */
function completion(content: string) {
  return HttpResponse.json({
    id: "cmpl-1",
    object: "chat.completion",
    created: 0,
    model: "test-model",
    choices: [
      { index: 0, message: { role: "assistant", content }, finish_reason: "stop", logprobs: null },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  });
}

async function generate(pdfId: string) {
  return apiFetch(`https://example.com/api/pdf/${pdfId}/outline/generate`, { method: "POST" });
}

async function storedOutline(pdfId: string): Promise<string | null> {
  const row = (await env.DB.prepare("SELECT outline FROM pdfs WHERE id = ?")
    .bind(pdfId)
    .first()) as { outline: string | null };
  return row.outline;
}

describe("POST /api/pdf/:pdfId/outline/generate", () => {
  it("stores the chapters the model found, in page order, and answers with them", async () => {
    const pdfId = await uploadBook("generate-ok");
    let sent: { model?: string; stream?: boolean; messages?: { content: string }[] } = {};
    server.use(
      http.post(COMPLETIONS_URL, async ({ request }) => {
        sent = (await request.json()) as typeof sent;
        return completion(
          '```json\n{"chapters":[{"title":"第2章 しくみ","page":5},{"title":"第1章 はじめに","page":3}]}\n```',
        );
      }),
    );

    const response = await generate(pdfId);

    expect(response.status).toBe(200);
    const outline = [
      { title: "第1章 はじめに", pageNumber: 3 },
      { title: "第2章 しくみ", pageNumber: 5 },
    ];
    expect(await response.json()).toStrictEqual({ outline });
    expect(await storedOutline(pdfId)).toBe(JSON.stringify(outline));
    // One answer, not a stream, from the configured model — and only the head
    // of each page, numbered, rather than the book.
    expect(sent.model).toBe("test-model");
    expect(sent.stream).toBeFalsy();
    expect(sent.messages?.some((m) => m.content.includes("p.5: 第2章 しくみ"))).toBe(true);
  });

  it("puts the chapters in front of the chapter list and the book", async () => {
    const pdfId = await uploadBook("generate-chapters");
    server.use(
      http.post(COMPLETIONS_URL, () =>
        completion('{"chapters":[{"title":"第1章","page":3},{"title":"第2章","page":5}]}'),
      ),
    );

    await generate(pdfId);

    const chapters = await (await apiFetch(`https://example.com/api/pdf/${pdfId}/chapters`)).json();
    expect(chapters).toStrictEqual({
      chapters: [
        { title: null, startPage: 1, endPage: 2 },
        { title: "第1章", startPage: 3, endPage: 4 },
        { title: "第2章", startPage: 5, endPage: 6 },
      ],
    });
    const book = (await (await apiFetch(`https://example.com/api/pdf/${pdfId}`)).json()) as {
      hasOutline: boolean;
    };
    expect(book.hasOutline).toBe(true);
  });

  it("refuses a book that already has a table of contents, without asking the model", async () => {
    const outline = [{ title: "既存の章", pageNumber: 2 }];
    const pdfId = await uploadBook("generate-exists", outline);
    // No handler: a request that reached the model would fail the test.

    const response = await generate(pdfId);

    expect(response.status).toBe(409);
    expect(await response.json()).toStrictEqual({
      error: { code: "OUTLINE_EXISTS", message: "This book already has an outline" },
    });
    expect(await storedOutline(pdfId)).toBe(JSON.stringify(outline));
  });

  it("answers 502 and stores nothing when the model's reply is not a table of contents", async () => {
    const pdfId = await uploadBook("generate-garbage");
    server.use(http.post(COMPLETIONS_URL, () => completion("すみません、わかりません。")));

    const response = await generate(pdfId);

    expect(response.status).toBe(502);
    expect(await response.json()).toStrictEqual({
      error: {
        code: "AI_RESPONSE_INVALID",
        message: "The model did not answer with a table of contents",
      },
    });
    expect(await storedOutline(pdfId)).toBeNull();
  });

  it("answers 502 when the provider refuses, having asked it once", async () => {
    const pdfId = await uploadBook("generate-upstream");
    let asked = 0;
    server.use(
      http.post(COMPLETIONS_URL, () => {
        asked += 1;
        return HttpResponse.json({ error: { message: "overloaded" } }, { status: 503 });
      }),
    );

    const response = await generate(pdfId);

    // The SDK would otherwise try twice more, with the reader waiting on it
    expect(asked).toBe(1);
    expect(response.status).toBe(502);
    expect(await response.json()).toStrictEqual({
      error: { code: "AI_API_ERROR", message: "The model could not be reached" },
    });
    expect(await storedOutline(pdfId)).toBeNull();
  });

  it("returns 404 for a book that is not on the shelf", async () => {
    const response = await generate("no-such-book");

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: { code: "PDF_NOT_FOUND", message: "PDF not found" },
    });
  });

  it("refuses with CONFIG_ERROR when no key is set", async () => {
    const pdfId = await uploadBook("generate-no-key");
    const token = await issueSession(env.AUTH_SESSION_SECRET, Date.now());

    const response = await app.request(
      `/api/pdf/${pdfId}/outline/generate`,
      { method: "POST", headers: { Cookie: `${SESSION_COOKIE}=${token}` } },
      { ...env, LLM_API_KEY: "" },
    );

    expect(response.status).toBe(500);
    expect(await response.json()).toStrictEqual({
      error: { code: "CONFIG_ERROR", message: "LLM_API_KEY not set" },
    });
  });
});
