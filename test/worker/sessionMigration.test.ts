import { describe, it, expect, beforeAll } from "vite-plus/test";
import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { apiFetch } from "./setup/session";

/**
 * The migrations before the book's own conversation was split into sessions,
 * and the one that splits it.
 *
 * Split for the same reason `migration.test.ts` splits 0005: the part of 0013
 * that carries each book's conversation into its first session only does
 * anything on a database that already holds one, and every other test file
 * builds its database empty.
 */
const BEFORE_SESSIONS = env.TEST_MIGRATIONS.filter(
  (migration) => migration.name < "0013_chat_sessions.sql",
);
const FROM_SESSIONS = env.TEST_MIGRATIONS.filter(
  (migration) => migration.name >= "0013_chat_sessions.sql",
);

beforeAll(async () => {
  await applyD1Migrations(env.DB, BEFORE_SESSIONS);
});

async function storeBook(id: string, bookChatOpen: number | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO pdfs (id, file_path, file_name, file_hash, full_text, page_count, created_at, updated_at,
                       last_read_page, last_read_book_chat)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      `pdfs/${id}.pdf`,
      `${id}.pdf`,
      `${id}-hash`,
      "Page 1 says fact-1.",
      1,
      "2026-01-01T00:00:00.000Z",
      "2026-01-01T00:00:00.000Z",
      1,
      bookChatOpen,
    )
    .run();
}

async function storeTurn(
  id: string,
  pdfId: string,
  selectionId: string | null,
  role: "user" | "assistant",
  content: string,
  createdAt: string,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO chat_messages (id, selection_id, pdf_id, role, content, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, selectionId, pdfId, role, content, createdAt)
    .run();
}

describe("the migration that splits the book's own conversation into sessions", () => {
  it("makes each book's conversation its first session, and opens the book on it", async () => {
    // A book whose own conversation was open when it was put down, with a
    // highlight's conversation beside it.
    await storeBook("talked", 1);
    await env.DB.prepare(
      `INSERT INTO selections (id, pdf_id, selected_text, page_number, position_data, created_at)
       VALUES ('marked', 'talked', 'fact-1', 1, '{"rects":[]}', '2026-01-01T00:00:00.000Z')`,
    ).run();
    await storeTurn("q", "talked", null, "user", "この本を要約して", "2026-01-01T00:00:00.000Z");
    await storeTurn("a", "talked", null, "assistant", "要約です", "2026-01-01T00:00:05.000Z");
    await storeTurn("h", "talked", "marked", "user", "この箇所は?", "2026-01-01T00:00:03.000Z");
    // Left with its own conversation open but nothing asked in it: there is no
    // session to make, and nothing to reopen.
    await storeBook("silent", 1);

    await applyD1Migrations(env.DB, FROM_SESSIONS);

    const list = (await (await apiFetch("https://example.com/api/pdf/talked/chats")).json()) as {
      chats: { kind: string; id: string; firstQuestion?: string; messageCount: number }[];
    };
    const session = list.chats.find((chat) => chat.kind === "book");
    expect(session).toMatchObject({
      firstQuestion: "この本を要約して",
      messageCount: 2,
      lastMessage: { role: "assistant", content: "要約です" },
      // The session spans what was said in it.
      updatedAt: "2026-01-01T00:00:05.000Z",
    });
    // The highlight's conversation stays the highlight's.
    expect(list.chats.find((chat) => chat.kind === "highlight")).toMatchObject({
      id: "marked",
      messageCount: 1,
    });

    const history = (await (
      await apiFetch(`https://example.com/api/pdf/talked/sessions/${session?.id}/messages`)
    ).json()) as { session: { createdAt: string }; messages: { id: string }[] };
    expect(history.messages.map((message) => message.id)).toStrictEqual(["q", "a"]);
    expect(history.session.createdAt).toBe("2026-01-01T00:00:00.000Z");

    const talked = (await (await apiFetch("https://example.com/api/pdf/talked")).json()) as {
      readingState: { sessionId: string | null };
    };
    expect(talked.readingState.sessionId).toBe(session?.id);

    const silent = (await (await apiFetch("https://example.com/api/pdf/silent")).json()) as {
      readingState: { sessionId: string | null };
    };
    expect(silent.readingState.sessionId).toBeNull();
    expect(
      await env.DB.prepare(
        "SELECT COUNT(*) AS n FROM chat_sessions WHERE pdf_id = 'silent'",
      ).first(),
    ).toStrictEqual({ n: 0 });
  });
});
