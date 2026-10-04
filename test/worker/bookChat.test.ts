import { describe, it, expect, beforeAll } from "vite-plus/test";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { apiFetch } from "./setup/session";
import { MINIMAL_PDF_BYTES } from "./fixtures/minimalPdf";
import { http, HttpResponse } from "msw";
import { server } from "./setup/msw";

beforeAll(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});

/** What a test can vary about the book it asks about. */
interface BookOptions {
  fullText?: string;
  pageCount?: number;
  outline?: { title: string; pageNumber: number }[];
}

/**
 * A book of its own, with no highlights on it: the book's own conversation
 * hangs off the book rather than off a passage.
 *
 * Books are de-duplicated by content hash and D1 is only isolated per test
 * file, so each test appends its own PDF comment to get a book of its own.
 */
async function createBook(tag: string, options: BookOptions = {}): Promise<string> {
  const suffix = new TextEncoder().encode(`\n%${tag}\n`);
  const bytes = new Uint8Array(MINIMAL_PDF_BYTES.length + suffix.length);
  bytes.set(MINIMAL_PDF_BYTES, 0);
  bytes.set(suffix, MINIMAL_PDF_BYTES.length);

  const formData = new FormData();
  formData.append("file", new File([bytes], `${tag}.pdf`, { type: "application/pdf" }));
  formData.append("fullText", options.fullText ?? "Page 1 says fact-1.");
  formData.append("pageCount", String(options.pageCount ?? 1));
  if (options.outline) formData.append("outline", JSON.stringify(options.outline));

  const uploadResponse = await apiFetch("https://example.com/api/pdf/open", {
    method: "POST",
    body: formData,
  });
  const { id } = (await uploadResponse.json()) as { id: string };
  return id;
}

const PAGED_BOOK = {
  pages: (count: number) =>
    Array.from({ length: count }, (_, i) => `Page ${i + 1} says fact-${i + 1}.`),
  text: (count: number) => PAGED_BOOK.pages(count).join("\f"),
};

const CHAPTER_OUTLINE = [
  { title: "Chapter 1", pageNumber: 2 },
  { title: "Chapter 2", pageNumber: 5 },
  { title: "Chapter 3", pageNumber: 9 },
];

/**
 * The provider these tests point the Worker at, from the bindings in
 * `vitest.workers.config.ts`. Not DeepSeek's own host, so a request that
 * ignored `LLM_BASE_URL` would miss every handler below rather than pass on
 * the built-in default.
 */
const LLM_BASE = "https://llm.test";

/** One token chunk of the chat completions stream. */
function chatCompletionsToken(token: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: token } }] })}\n\n`;
}

/** What closes a chat completions stream: the usage chunk, then [DONE]. */
function chatCompletionsTail(): string {
  const usage = JSON.stringify({
    choices: [{ delta: {} }],
    usage: { prompt_tokens: 11, completion_tokens: 2, prompt_cache_hit_tokens: 9 },
  });
  return `data: ${usage}\n\ndata: [DONE]\n\n`;
}

/** An SSE body shaped like the chat completions stream, ending in [DONE]. */
function chatCompletionsSse(tokens: string[]): string {
  return tokens.map(chatCompletionsToken).join("") + chatCompletionsTail();
}

/** The events the route answered with, in the order they arrived. */
function parseSse(body: string): { event: string; data: unknown }[] {
  return body
    .split("\n\n")
    .filter((block) => block.trim().length > 0)
    .map((block) => ({
      event: block.match(/^event: (.+)$/m)?.[1] ?? "",
      data: JSON.parse(block.match(/^data: (.+)$/m)?.[1] ?? "null") as unknown,
    }));
}

/** The document block the system prompt hands the model. */
function documentIn(instructions: string): string | undefined {
  return instructions.match(/--- DOCUMENT START ---\n([\s\S]*?)\n--- DOCUMENT END ---/)?.[1];
}

/** The line naming what the model is given as context. */
function contextLineIn(instructions: string): string | undefined {
  return instructions.match(/^Use the following .+$/m)?.[0];
}

/** Start a chat about the book, as the screen does before its first question. */
async function newSession(pdfId: string): Promise<string> {
  const response = await apiFetch(`https://example.com/api/pdf/${pdfId}/sessions`, {
    method: "POST",
  });
  const { id } = (await response.json()) as { id: string };
  return id;
}

/** Ask the book itself a question in a session, over the stream the route answers with. */
function postBookChat(
  pdfId: string,
  sessionId: string,
  payload: { content: string; useWebSearch?: boolean; scope: { ranges: unknown[] } },
): Promise<Response> {
  return apiFetch(`https://example.com/api/pdf/${pdfId}/sessions/${sessionId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** A session of the book, as the route hands it back. */
async function readBookChat(
  pdfId: string,
  sessionId: string,
): Promise<{ role: string; content: string; citations: unknown }[]> {
  const body = (await (
    await apiFetch(`https://example.com/api/pdf/${pdfId}/sessions/${sessionId}/messages`)
  ).json()) as {
    messages: { role: string; content: string; citations: unknown }[];
  };
  return body.messages;
}

/** A handler that records the system prompt and answers with fixed tokens. */
function answeringWith(tokens: string[], onPrompt: (prompt: string) => void) {
  server.use(
    http.post(`${LLM_BASE}/chat/completions`, async ({ request }) => {
      const body = (await request.json()) as { messages: { role: string; content: string }[] };
      onPrompt(body.messages[0].content);
      return new HttpResponse(chatCompletionsSse(tokens), {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    }),
  );
}

describe("GET /api/pdf/:pdfId/chapters", () => {
  it("hands back each chapter with the pages it covers, front matter included", async () => {
    const pdfId = await createBook("chapters", {
      fullText: PAGED_BOOK.text(12),
      pageCount: 12,
      outline: CHAPTER_OUTLINE,
    });

    const response = await apiFetch(`https://example.com/api/pdf/${pdfId}/chapters`);

    expect(response.status).toBe(200);
    // The pages before the first chapter come back unnamed rather than left
    // out: the spans tile the book, so a question about the preface has
    // something to point at.
    expect(await response.json()).toStrictEqual({
      chapters: [
        { title: null, startPage: 1, endPage: 1 },
        { title: "Chapter 1", startPage: 2, endPage: 4 },
        { title: "Chapter 2", startPage: 5, endPage: 8 },
        { title: "Chapter 3", startPage: 9, endPage: 12 },
      ],
    });
  });

  it("holds no chapters for a book whose PDF ships no outline", async () => {
    const pdfId = await createBook("chapters-none", {
      fullText: PAGED_BOOK.text(12),
      pageCount: 12,
    });

    const response = await apiFetch(`https://example.com/api/pdf/${pdfId}/chapters`);

    expect(await response.json()).toStrictEqual({ chapters: [] });
  });

  it("says a book is not there rather than that it has no chapters", async () => {
    const response = await apiFetch("https://example.com/api/pdf/no-such-book/chapters");

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: { code: "PDF_NOT_FOUND", message: "PDF not found" },
    });
  });
});

/**
 * A turn of a conversation written straight into D1: the SSE route reaches a
 * model, which is more machinery than a reading test needs.
 *
 * The owner is a highlight, or one of the book's own sessions — which is what
 * most of these tests are about.
 */
async function seedTurn(
  pdfId: string,
  id: string,
  role: "user" | "assistant",
  content: string,
  createdAt: string,
  owner: { selectionId: string } | { sessionId: string },
): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO chat_messages (id, selection_id, session_id, pdf_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      id,
      "selectionId" in owner ? owner.selectionId : null,
      "sessionId" in owner ? owner.sessionId : null,
      pdfId,
      role,
      content,
      createdAt,
    )
    .run();
}

/** A highlight on the book, so its conversation can be told apart from the book's. */
async function addSelection(pdfId: string): Promise<string> {
  const response = await apiFetch(`https://example.com/api/pdf/${pdfId}/selections`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selectedText: "fact-1", pageNumber: 1, positionData: { rects: [] } }),
  });
  const { id } = (await response.json()) as { id: string };
  return id;
}

describe("POST /api/pdf/:pdfId/sessions", () => {
  it("starts a session with nothing said in it, untitled and aimed at nothing yet", async () => {
    const pdfId = await createBook("session-create");

    const response = await apiFetch(`https://example.com/api/pdf/${pdfId}/sessions`, {
      method: "POST",
    });

    expect(response.status).toBe(201);
    const session = (await response.json()) as Record<string, unknown>;
    expect(session).toStrictEqual({
      id: expect.any(String),
      title: null,
      scope: null,
      createdAt: expect.any(String),
      updatedAt: session.createdAt,
    });
  });

  it("says a book is not there rather than starting a chat about nothing", async () => {
    const response = await apiFetch("https://example.com/api/pdf/no-such-book/sessions", {
      method: "POST",
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: { code: "PDF_NOT_FOUND", message: "PDF not found" },
    });
  });
});

describe("GET /api/pdf/:pdfId/sessions/:sessionId/messages", () => {
  it("holds nothing until the reader has asked something in it", async () => {
    const pdfId = await createBook("session-empty");
    const sessionId = await newSession(pdfId);

    const response = await apiFetch(
      `https://example.com/api/pdf/${pdfId}/sessions/${sessionId}/messages`,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({
      session: {
        id: sessionId,
        title: null,
        scope: null,
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
      messages: [],
    });
  });

  it("hands back the session in the order it was written", async () => {
    const pdfId = await createBook("session-order");
    const sessionId = await newSession(pdfId);
    await seedTurn(pdfId, "b-answer", "assistant", "答えです", "2026-01-01T00:00:01.000Z", {
      sessionId,
    });
    await seedTurn(pdfId, "b-question", "user", "この本を要約して", "2026-01-01T00:00:00.000Z", {
      sessionId,
    });

    expect(await readBookChat(pdfId, sessionId)).toStrictEqual([
      {
        id: "b-question",
        role: "user",
        content: "この本を要約して",
        citations: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "b-answer",
        role: "assistant",
        content: "答えです",
        citations: null,
        createdAt: "2026-01-01T00:00:01.000Z",
      },
    ]);
  });

  it("keeps a session apart from the book's other sessions and from a highlight's", async () => {
    const pdfId = await createBook("session-apart");
    const mine = await newSession(pdfId);
    const another = await newSession(pdfId);
    const selectionId = await addSelection(pdfId);
    await seedTurn(pdfId, "mine", "user", "この本について", "2026-01-01T00:00:00.000Z", {
      sessionId: mine,
    });
    await seedTurn(pdfId, "another", "user", "別の話", "2026-01-01T00:00:00.000Z", {
      sessionId: another,
    });
    await seedTurn(pdfId, "a-highlight", "user", "選択した箇所", "2026-01-01T00:00:00.000Z", {
      selectionId,
    });

    const messages = await readBookChat(pdfId, mine);

    expect(messages.map((message) => message.content)).toStrictEqual(["この本について"]);
  });

  it("says a session of another book is not there", async () => {
    const pdfId = await createBook("session-elsewhere");
    const other = await createBook("session-elsewhere-other");
    const sessionId = await newSession(other);

    const response = await apiFetch(
      `https://example.com/api/pdf/${pdfId}/sessions/${sessionId}/messages`,
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: { code: "SESSION_NOT_FOUND", message: "Chat session not found" },
    });
  });
});

/** How many turns of any conversation the book is left holding. */
async function countTurns(pdfId: string): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE pdf_id = ?")
    .bind(pdfId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

describe("POST /api/pdf/:pdfId/sessions/:sessionId/messages", () => {
  const PICKED_CHAPTER = { ranges: [{ startPage: 5, endPage: 8 }] };
  const WHOLE_BOOK = { ranges: [{ startPage: 1, endPage: 12 }] };

  it("answers about the chapter the reader picked, and stores it against the book", async () => {
    const pdfId = await createBook("book-chat-send", {
      fullText: PAGED_BOOK.text(12),
      pageCount: 12,
      outline: CHAPTER_OUTLINE,
    });
    const sessionId = await newSession(pdfId);
    let systemPrompt = "";
    answeringWith(["Workers ", "run everywhere."], (prompt) => (systemPrompt = prompt));

    const response = await postBookChat(pdfId, sessionId, {
      content: "この章を要約して",
      useWebSearch: false,
      scope: PICKED_CHAPTER,
    });
    const events = parseSse(await response.text());

    expect(events.map((event) => event.event)).toStrictEqual(["token", "token", "done"]);
    expect(events.map((event) => event.data)).toStrictEqual([
      { content: "Workers " },
      { content: "run everywhere." },
      {
        messageId: expect.any(String),
        usage: { inputTokens: 11, outputTokens: 2, cachedInputTokens: 9 },
      },
    ]);
    // The pages picked, and only them: the chapter runs 5-8 of a 12-page book.
    expect(documentIn(systemPrompt)).toBe(PAGED_BOOK.pages(12).slice(4, 8).join("\f"));
    expect(contextLineIn(systemPrompt)).toBe(
      "Use the following excerpt (pages 5-8 of the 12-page document) as your primary context:",
    );

    // Hung off the session, with no highlight to name: the row the reopened
    // conversation is read back from.
    const row = await env.DB.prepare(
      "SELECT selection_id, session_id, pdf_id FROM chat_messages WHERE pdf_id = ? AND role = 'assistant'",
    )
      .bind(pdfId)
      .first();
    expect(row).toStrictEqual({ selection_id: null, session_id: sessionId, pdf_id: pdfId });
    expect(await readBookChat(pdfId, sessionId)).toStrictEqual([
      {
        id: expect.any(String),
        role: "user",
        content: "この章を要約して",
        citations: null,
        createdAt: expect.any(String),
      },
      {
        id: expect.any(String),
        role: "assistant",
        content: "Workers run everywhere.",
        citations: [],
        createdAt: expect.any(String),
      },
    ]);
  });

  it("presents the whole book as the document when that is what was asked for", async () => {
    const pdfId = await createBook("book-chat-whole", {
      fullText: PAGED_BOOK.text(12),
      pageCount: 12,
      outline: CHAPTER_OUTLINE,
    });
    const sessionId = await newSession(pdfId);
    let systemPrompt = "";
    answeringWith(["ok"], (prompt) => (systemPrompt = prompt));

    await (
      await postBookChat(pdfId, sessionId, { content: "この本を要約して", scope: WHOLE_BOOK })
    ).text();

    // The same wording a book with one chapter has always had: nothing is said
    // about an excerpt when the reader is looking at all of it.
    expect(contextLineIn(systemPrompt)).toBe("Use the following document as your primary context:");
    expect(documentIn(systemPrompt)).toBe(PAGED_BOOK.text(12));
  });

  it("runs chapters that touch together into one part, and names them as one", async () => {
    const pdfId = await createBook("book-chat-adjacent", {
      fullText: PAGED_BOOK.text(12),
      pageCount: 12,
      outline: CHAPTER_OUTLINE,
    });
    const sessionId = await newSession(pdfId);
    let systemPrompt = "";
    answeringWith(["ok"], (prompt) => (systemPrompt = prompt));

    await (
      await postBookChat(pdfId, sessionId, {
        content: "1章と2章を比べて",
        scope: {
          ranges: [
            { startPage: 2, endPage: 4 },
            { startPage: 5, endPage: 8 },
          ],
        },
      })
    ).text();

    expect(documentIn(systemPrompt)).toBe(PAGED_BOOK.pages(12).slice(1, 8).join("\f"));
    expect(contextLineIn(systemPrompt)).toBe(
      "Use the following excerpt (pages 2-8 of the 12-page document) as your primary context:",
    );
  });

  it("tells the model when the pages picked arrive in parts", async () => {
    const pdfId = await createBook("book-chat-parts", {
      fullText: PAGED_BOOK.text(12),
      pageCount: 12,
      outline: CHAPTER_OUTLINE,
    });
    const sessionId = await newSession(pdfId);
    let systemPrompt = "";
    answeringWith(["ok"], (prompt) => (systemPrompt = prompt));

    await (
      await postBookChat(pdfId, sessionId, {
        content: "1章と3章を比べて",
        scope: {
          ranges: [
            { startPage: 2, endPage: 4 },
            { startPage: 9, endPage: 12 },
          ],
        },
      })
    ).text();

    // The two runs as they arrive: each page verbatim, one after the other with
    // the same page break between them, and nothing said about the gap.
    expect(documentIn(systemPrompt)).toBe(
      [...PAGED_BOOK.pages(12).slice(1, 4), ...PAGED_BOOK.pages(12).slice(8, 12)].join("\f"),
    );
    expect(systemPrompt).toContain(
      "- The pages you are shown arrive in 2 parts (pages 2-4, 9-12); the pages between them are not visible to you. Quote from within one part rather than joining the end of one to the start of the next.",
    );
  });

  it("hands the model this session's earlier turns and none of another's", async () => {
    const pdfId = await createBook("book-chat-history");
    const sessionId = await newSession(pdfId);
    const otherSession = await newSession(pdfId);
    const selectionId = await addSelection(pdfId);
    await seedTurn(pdfId, "earlier", "assistant", "前の答えです", "2026-01-01T00:00:00.000Z", {
      sessionId,
    });
    // Another chat about the same book: starting a new one is how a reader
    // asks something unrelated without the old thread riding along.
    await seedTurn(pdfId, "elsewhere", "user", "別の話です", "2026-01-01T00:00:00.500Z", {
      sessionId: otherSession,
    });
    // A conversation of the other kind on the same book: what a question about
    // a passage said has no business riding in front of a question about the
    // work, and the two are told apart by the column the highlight names.
    await seedTurn(
      pdfId,
      "highlight-earlier",
      "user",
      "選んだ箇所について",
      "2026-01-01T00:00:01.000Z",
      { selectionId },
    );
    let conversation: { role: string; content: string }[] = [];
    server.use(
      http.post(`${LLM_BASE}/chat/completions`, async ({ request }) => {
        const body = (await request.json()) as { messages: { role: string; content: string }[] };
        conversation = body.messages;
        return new HttpResponse(chatCompletionsSse(["ok"]), {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      }),
    );

    await (
      await postBookChat(pdfId, sessionId, { content: "続きを教えて", scope: WHOLE_BOOK })
    ).text();

    expect(conversation.map((turn) => [turn.role, turn.content])).toStrictEqual([
      ["system", expect.stringContaining("--- DOCUMENT START ---")],
      ["assistant", "前の答えです"],
      ["user", "続きを教えて"],
    ]);
  });

  it("resolves a passage quoted outside the picked pages to its page in the whole book", async () => {
    const pdfId = await createBook("book-chat-citation", {
      fullText: PAGED_BOOK.text(12),
      pageCount: 12,
    });
    const sessionId = await newSession(pdfId);
    // The page lookup runs against the stored book rather than the pages the
    // question was aimed at: a lookup inside the excerpt would call page 6 of
    // the book "page 3", the excerpt being pages 5-8.
    answeringWith(['It is on page 6[1].\n\n## Sources\n[1] "Page 6 says fact-6."'], () => {});

    await (
      await postBookChat(pdfId, sessionId, { content: "Where is fact-6?", scope: PICKED_CHAPTER })
    ).text();

    expect(await readBookChat(pdfId, sessionId)).toStrictEqual([
      {
        id: expect.any(String),
        role: "user",
        content: "Where is fact-6?",
        citations: null,
        createdAt: expect.any(String),
      },
      {
        id: expect.any(String),
        role: "assistant",
        content: 'It is on page 6[1].\n\n## Sources\n[1] "Page 6 says fact-6."',
        citations: [{ id: "1", type: "pdf", text: "Page 6 says fact-6.", pageNumber: 6 }],
        createdAt: expect.any(String),
      },
    ]);
  });

  it("refuses a question aimed at nothing, rather than asking about the whole book", async () => {
    const pdfId = await createBook("book-chat-empty-scope");
    const sessionId = await newSession(pdfId);

    const response = await postBookChat(pdfId, sessionId, {
      content: "聞いて",
      scope: { ranges: [] },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid request body: scope.ranges" },
    });
  });

  it("refuses a range that ends before it starts", async () => {
    const pdfId = await createBook("book-chat-backwards");
    const sessionId = await newSession(pdfId);

    const response = await postBookChat(pdfId, sessionId, {
      content: "聞いて",
      scope: { ranges: [{ startPage: 8, endPage: 5 }] },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid request body: scope.ranges.0.endPage" },
    });
  });

  it("keeps the book's own conversation when a highlight goes, and loses it with the book", async () => {
    // What the two owners on a message are for: deleting a passage takes the
    // conversation about it and nothing else, while the book's own is the
    // reader's until they delete the book.
    const pdfId = await createBook("book-chat-deletion");
    const sessionId = await newSession(pdfId);
    const selectionId = await addSelection(pdfId);
    await seedTurn(pdfId, "about-the-book", "user", "本について", "2026-01-01T00:00:00.000Z", {
      sessionId,
    });
    await seedTurn(pdfId, "about-the-passage", "user", "箇所について", "2026-01-01T00:00:01.000Z", {
      selectionId,
    });

    const removed = await apiFetch(
      `https://example.com/api/pdf/${pdfId}/selections/${selectionId}`,
      { method: "DELETE" },
    );

    expect(removed.status).toBe(200);
    expect((await readBookChat(pdfId, sessionId)).map((message) => message.content)).toStrictEqual([
      "本について",
    ]);

    const deleted = await apiFetch(`https://example.com/api/pdf/${pdfId}`, { method: "DELETE" });

    expect(deleted.status).toBe(200);
    expect(await countTurns(pdfId)).toBe(0);
  });

  it("asks about the whole book when every page picked is outside it", async () => {
    // A stored page count that disagrees with the text's own page breaks is the
    // one way this happens; leaving the reader a question with nothing to ask
    // it about would be worse than answering about the book.
    const pdfId = await createBook("book-chat-outside");
    const sessionId = await newSession(pdfId);
    let systemPrompt = "";
    answeringWith(["ok"], (prompt) => (systemPrompt = prompt));

    await (
      await postBookChat(pdfId, sessionId, {
        content: "聞いて",
        scope: { ranges: [{ startPage: 40, endPage: 45 }] },
      })
    ).text();

    expect(contextLineIn(systemPrompt)).toBe("Use the following document as your primary context:");
  });

  it("keeps the pages asked about on the session, for the menu to reopen on", async () => {
    const pdfId = await createBook("book-chat-scope-kept", {
      fullText: PAGED_BOOK.text(12),
      pageCount: 12,
      outline: CHAPTER_OUTLINE,
    });
    const sessionId = await newSession(pdfId);
    answeringWith(["ok"], () => {});

    await (
      await postBookChat(pdfId, sessionId, { content: "この章は?", scope: PICKED_CHAPTER })
    ).text();

    const body = (await (
      await apiFetch(`https://example.com/api/pdf/${pdfId}/sessions/${sessionId}/messages`)
    ).json()) as { session: { scope: unknown } };
    expect(body.session.scope).toStrictEqual(PICKED_CHAPTER.ranges);
  });

  it("says a session that is not the book's is not there, and stores nothing", async () => {
    const pdfId = await createBook("book-chat-no-session");

    const response = await postBookChat(pdfId, "no-such-session", {
      content: "聞いて",
      scope: WHOLE_BOOK,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: { code: "SESSION_NOT_FOUND", message: "Chat session not found" },
    });
    expect(await countTurns(pdfId)).toBe(0);
  });
});

describe("PATCH /api/pdf/:pdfId/sessions/:sessionId", () => {
  function rename(pdfId: string, sessionId: string, title: unknown): Promise<Response> {
    return apiFetch(`https://example.com/api/pdf/${pdfId}/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
  }

  it("names the session, trimmed", async () => {
    const pdfId = await createBook("session-rename");
    const sessionId = await newSession(pdfId);

    const response = await rename(pdfId, sessionId, "  第2章の論点 ");

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ id: sessionId, title: "第2章の論点" });
    const body = (await (
      await apiFetch(`https://example.com/api/pdf/${pdfId}/sessions/${sessionId}/messages`)
    ).json()) as { session: { title: string } };
    expect(body.session.title).toBe("第2章の論点");
  });

  it("refuses a blank name", async () => {
    const pdfId = await createBook("session-rename-blank");
    const sessionId = await newSession(pdfId);

    const response = await rename(pdfId, sessionId, "   ");

    expect(response.status).toBe(400);
    expect(await response.json()).toStrictEqual({
      error: { code: "VALIDATION_ERROR", message: "Invalid request body: title" },
    });
  });

  it("says a session of another book is not there", async () => {
    const pdfId = await createBook("session-rename-elsewhere");
    const other = await createBook("session-rename-elsewhere-other");
    const sessionId = await newSession(other);

    const response = await rename(pdfId, sessionId, "名前");

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: { code: "SESSION_NOT_FOUND", message: "Chat session not found" },
    });
  });
});

describe("DELETE /api/pdf/:pdfId/sessions/:sessionId", () => {
  it("takes the session and what was said in it, and leaves the others", async () => {
    const pdfId = await createBook("session-delete");
    const doomed = await newSession(pdfId);
    const kept = await newSession(pdfId);
    await seedTurn(pdfId, "doomed-q", "user", "消える", "2026-01-01T00:00:00.000Z", {
      sessionId: doomed,
    });
    await seedTurn(pdfId, "kept-q", "user", "残る", "2026-01-01T00:00:00.000Z", {
      sessionId: kept,
    });

    const response = await apiFetch(`https://example.com/api/pdf/${pdfId}/sessions/${doomed}`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toStrictEqual({ deleted: true });
    expect(await countTurns(pdfId)).toBe(1);
    expect((await readBookChat(pdfId, kept)).map((message) => message.content)).toStrictEqual([
      "残る",
    ]);
    const gone = await apiFetch(`https://example.com/api/pdf/${pdfId}/sessions/${doomed}/messages`);
    expect(gone.status).toBe(404);
  });

  it("lets go of the session as the place the book was left at", async () => {
    const pdfId = await createBook("session-delete-place");
    const sessionId = await newSession(pdfId);
    await apiFetch(`https://example.com/api/pdf/${pdfId}/reading-state`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ page: 1, selectionId: null, sessionId }),
    });

    await apiFetch(`https://example.com/api/pdf/${pdfId}/sessions/${sessionId}`, {
      method: "DELETE",
    });

    const book = (await (await apiFetch(`https://example.com/api/pdf/${pdfId}`)).json()) as {
      readingState: { sessionId: string | null };
    };
    expect(book.readingState.sessionId).toBeNull();
  });

  it("answers the same for a session that is not there", async () => {
    const pdfId = await createBook("session-delete-missing");

    const response = await apiFetch(`https://example.com/api/pdf/${pdfId}/sessions/nothing`, {
      method: "DELETE",
    });

    expect(response.status).toBe(200);
  });
});

describe("GET /api/pdf/:pdfId/chats", () => {
  interface Listed {
    kind: string;
    id: string;
    messageCount: number;
    lastMessage: { role: string; content: string } | null;
    updatedAt: string;
  }

  async function listChats(pdfId: string): Promise<Listed[]> {
    const response = await apiFetch(`https://example.com/api/pdf/${pdfId}/chats`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { chats: Listed[] }).chats;
  }

  it("lists the book's sessions and the highlights something was asked about, last talked in first", async () => {
    const pdfId = await createBook("chat-list");
    const older = await newSession(pdfId);
    const newer = await newSession(pdfId);
    const asked = await addSelection(pdfId);
    // Marked but never asked about: it has no conversation to list.
    await addSelection(pdfId);
    await seedTurn(pdfId, "o-q", "user", "古いセッションの質問", "2026-01-01T00:00:00.000Z", {
      sessionId: older,
    });
    await seedTurn(pdfId, "o-a", "assistant", "古い答え", "2026-01-01T00:00:01.000Z", {
      sessionId: older,
    });
    await seedTurn(pdfId, "h-q", "user", "箇所の質問", "2026-01-02T00:00:00.000Z", {
      selectionId: asked,
    });
    await seedTurn(pdfId, "n-q", "user", "新しいセッションの質問", "2027-01-03T00:00:00.000Z", {
      sessionId: newer,
    });

    const chats = await listChats(pdfId);

    // The sessions were started just now, which is later than every seeded
    // turn but the newest: the list is ordered by whichever is later.
    expect(chats.map((chat) => [chat.kind, chat.id])).toStrictEqual([
      ["book", newer],
      ["book", older],
      ["highlight", asked],
    ]);
    expect(chats[0]).toStrictEqual({
      kind: "book",
      id: newer,
      title: null,
      firstQuestion: "新しいセッションの質問",
      scope: null,
      messageCount: 1,
      lastMessage: { role: "user", content: "新しいセッションの質問" },
      updatedAt: "2027-01-03T00:00:00.000Z",
    });
    expect(chats[1]).toMatchObject({
      firstQuestion: "古いセッションの質問",
      messageCount: 2,
      lastMessage: { role: "assistant", content: "古い答え" },
    });
    expect(chats[2]).toStrictEqual({
      kind: "highlight",
      id: asked,
      selectedText: "fact-1",
      pageNumber: 1,
      color: "#FFEB3B",
      messageCount: 1,
      lastMessage: { role: "user", content: "箇所の質問" },
      updatedAt: "2026-01-02T00:00:00.000Z",
    });
  });

  it("lists a session nothing was said in yet, so it can still be found and deleted", async () => {
    const pdfId = await createBook("chat-list-empty-session");
    const sessionId = await newSession(pdfId);

    const chats = await listChats(pdfId);

    expect(chats).toStrictEqual([
      {
        kind: "book",
        id: sessionId,
        title: null,
        firstQuestion: null,
        scope: null,
        messageCount: 0,
        lastMessage: null,
        updatedAt: expect.any(String),
      },
    ]);
  });

  it("cuts a long answer down to what a row can show", async () => {
    const pdfId = await createBook("chat-list-snippet");
    const sessionId = await newSession(pdfId);
    await seedTurn(pdfId, "long", "assistant", "あ".repeat(500), "2026-01-01T00:00:00.000Z", {
      sessionId,
    });

    const [chat] = await listChats(pdfId);

    expect(chat.lastMessage?.content).toBe("あ".repeat(200));
  });

  it("keeps another book's conversations out", async () => {
    const pdfId = await createBook("chat-list-mine");
    const other = await createBook("chat-list-theirs");
    await newSession(other);

    expect(await listChats(pdfId)).toStrictEqual([]);
  });

  it("says a book is not there rather than showing an empty list", async () => {
    const response = await apiFetch("https://example.com/api/pdf/no-such-book/chats");

    expect(response.status).toBe(404);
    expect(await response.json()).toStrictEqual({
      error: { code: "PDF_NOT_FOUND", message: "PDF not found" },
    });
  });
});
