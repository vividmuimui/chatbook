import { drizzle } from "drizzle-orm/d1";
import { and, asc, eq } from "drizzle-orm";
import { ResultAsync, err, ok } from "neverthrow";
import { z } from "zod";
import { chatMessages, chatSessions, pdfs } from "../db/schema";
import {
  pageRangeSchema,
  type ChatMessage,
  type ChatSession,
  type ChatSummary,
  type PageRange,
} from "../../shared/schemas/chat";
import { readCitations } from "./chatService";
import { notFound, storageFailure, type ServiceError, type StorageError } from "./serviceError";
import type { IdClock } from "./pdfService";

/**
 * How much of a message the chat list carries: enough for two lines of a row,
 * and not the whole of an answer that can run to pages.
 */
export const CHAT_LIST_SNIPPET_LENGTH = 200;

const storedScopeSchema = z.array(pageRangeSchema).min(1);

/**
 * The pages a session was last aimed at, as stored.
 *
 * Read leniently: a scope that does not parse leaves the session asking about
 * the whole book rather than refusing to open it — what was asked is still
 * there to read, and the next question stores a good scope over it.
 */
export function readStoredScope(raw: string | null): PageRange[] | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Swallowed on purpose: see above — a broken column is the whole book.
    return null;
  }
  const checked = storedScopeSchema.safeParse(parsed);
  return checked.success ? checked.data : null;
}

type SessionRow = typeof chatSessions.$inferSelect;

function sessionOf(row: SessionRow): ChatSession {
  return {
    id: row.id,
    title: row.title,
    scope: readStoredScope(row.scope),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** A stored message as the screen reads it. */
export function messageOf(row: typeof chatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    role: row.role as ChatMessage["role"],
    content: row.content,
    citations: readCitations(row.citations),
    createdAt: row.createdAt,
  };
}

async function bookExists(db: D1Database, pdfId: string): Promise<boolean> {
  const book = await drizzle(db).select({ id: pdfs.id }).from(pdfs).where(eq(pdfs.id, pdfId)).get();
  return book !== undefined;
}

/**
 * Start a session on the book, with nothing said in it yet.
 *
 * Kept apart from sending its first question: the screen makes one only when
 * the reader asks something in a new chat, and a session that exists before
 * its first answer is one the list can show while the answer is still coming.
 */
export function createSession(
  db: D1Database,
  pdfId: string,
  idClock: IdClock,
): ResultAsync<ChatSession, ServiceError> {
  return ResultAsync.fromPromise(
    (async () => {
      if (!(await bookExists(db, pdfId))) return null;
      const now = idClock.now();
      const row: SessionRow = {
        id: idClock.newId(),
        pdfId,
        title: null,
        scope: null,
        createdAt: now,
        updatedAt: now,
      };
      await drizzle(db).insert(chatSessions).values(row);
      return sessionOf(row);
    })(),
    storageFailure,
  ).andThen((session) => (session ? ok(session) : err(notFound())));
}

/** A session of this book, or nothing — one of another book's is nothing too. */
export function findSession(
  db: D1Database,
  pdfId: string,
  sessionId: string,
): ResultAsync<ChatSession, ServiceError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .select()
      .from(chatSessions)
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.pdfId, pdfId)))
      .get(),
    storageFailure,
  ).andThen((row) => (row ? ok(sessionOf(row)) : err(notFound())));
}

/** The messages of a session, oldest first: the history a question is asked on. */
export function sessionMessages(
  db: D1Database,
  sessionId: string,
): ResultAsync<(typeof chatMessages.$inferSelect)[], StorageError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.sessionId, sessionId))
      .orderBy(asc(chatMessages.createdAt), asc(chatMessages.id))
      .all(),
    storageFailure,
  );
}

/** A session as it is opened: the record and everything said in it. */
export function readSession(
  db: D1Database,
  pdfId: string,
  sessionId: string,
): ResultAsync<{ session: ChatSession; messages: ChatMessage[] }, ServiceError> {
  return findSession(db, pdfId, sessionId).andThen((session) =>
    sessionMessages(db, sessionId).map((rows) => ({ session, messages: rows.map(messageOf) })),
  );
}

/**
 * Note a question asked in a session: the pages it was aimed at, and that the
 * session moved. Written with the question rather than whenever the scope
 * menu changes, so what reopens is what was last asked about.
 */
export function noteQuestion(
  db: D1Database,
  sessionId: string,
  scope: PageRange[],
  now: string,
): ResultAsync<void, StorageError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .update(chatSessions)
      .set({ scope: JSON.stringify(scope), updatedAt: now })
      .where(eq(chatSessions.id, sessionId))
      .run(),
    storageFailure,
  ).map(() => undefined);
}

/** Name a session. Its place in the list stays: naming it is not talking in it. */
export function renameSession(
  db: D1Database,
  pdfId: string,
  sessionId: string,
  title: string,
): ResultAsync<{ id: string; title: string }, ServiceError> {
  return ResultAsync.fromPromise(
    drizzle(db)
      .update(chatSessions)
      .set({ title })
      .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.pdfId, pdfId)))
      .returning({ id: chatSessions.id, title: chatSessions.title })
      .get(),
    storageFailure,
  ).andThen((renamed) =>
    renamed && renamed.title !== null
      ? ok({ id: renamed.id, title: renamed.title })
      : err(notFound()),
  );
}

/**
 * Delete a session and everything said in it.
 *
 * Answers the same whether or not there was one, like deleting a highlight:
 * what the reader wanted gone is gone either way. The book's place is let go
 * of it in the same batch, so a book is never left reopening a session that
 * is not there.
 */
export function deleteSession(
  db: D1Database,
  pdfId: string,
  sessionId: string,
): ResultAsync<void, ServiceError> {
  return ResultAsync.fromPromise(
    db.batch([
      db.prepare("DELETE FROM chat_sessions WHERE id = ?1 AND pdf_id = ?2").bind(sessionId, pdfId),
      db
        .prepare(
          "UPDATE pdfs SET last_read_session_id = NULL WHERE id = ?1 AND last_read_session_id = ?2",
        )
        .bind(pdfId, sessionId),
    ]),
    storageFailure,
  ).map(() => undefined);
}

interface ChatListRow {
  kind: "book" | "highlight";
  id: string;
  title: string | null;
  first_question: string | null;
  scope: string | null;
  selected_text: string | null;
  page_number: number | null;
  color: string | null;
  message_count: number;
  last_role: string | null;
  last_content: string | null;
  updated_at: string;
}

/**
 * Every conversation the book holds, the one talked in last first.
 *
 * One statement: the sessions with whatever was said last in each, and the
 * highlights that have a conversation, with the same. Each message is ranked
 * within its conversation once (the window over `chat_messages`), so neither
 * half reads the table twice. A session nothing was said in yet is still
 * listed — it was started, and the reader may want it gone.
 */
const CHAT_LIST_SQL = `
WITH ranked AS (
  SELECT m.session_id, m.selection_id, m.role, m.content, m.created_at,
         ROW_NUMBER() OVER (PARTITION BY m.session_id, m.selection_id
                            ORDER BY m.created_at DESC, m.id DESC) AS rn,
         COUNT(*) OVER (PARTITION BY m.session_id, m.selection_id) AS n
    FROM chat_messages m
   WHERE m.pdf_id = ?1
)
SELECT 'book' AS kind, s.id AS id, s.title AS title,
       (SELECT substr(f.content, 1, ?2) FROM chat_messages f
         WHERE f.session_id = s.id AND f.role = 'user'
         ORDER BY f.created_at, f.id LIMIT 1) AS first_question,
       s.scope AS scope, NULL AS selected_text, NULL AS page_number, NULL AS color,
       COALESCE(r.n, 0) AS message_count, r.role AS last_role,
       substr(r.content, 1, ?2) AS last_content,
       max(s.updated_at, COALESCE(r.created_at, '')) AS updated_at
  FROM chat_sessions s
  LEFT JOIN ranked r ON r.session_id = s.id AND r.rn = 1
 WHERE s.pdf_id = ?1
UNION ALL
SELECT 'highlight', sel.id, NULL, NULL, NULL, sel.selected_text, sel.page_number, sel.color,
       r.n, r.role, substr(r.content, 1, ?2), r.created_at
  FROM ranked r
  JOIN selections sel ON sel.id = r.selection_id
 WHERE r.rn = 1 AND r.session_id IS NULL
 ORDER BY updated_at DESC, id DESC`;

function summaryOf(row: ChatListRow): ChatSummary {
  const lastMessage =
    row.last_role === null || row.last_content === null
      ? null
      : { role: row.last_role as "user" | "assistant", content: row.last_content };

  if (row.kind === "book") {
    return {
      kind: "book",
      id: row.id,
      title: row.title,
      firstQuestion: row.first_question,
      scope: readStoredScope(row.scope),
      messageCount: row.message_count,
      lastMessage,
      updatedAt: row.updated_at,
    };
  }
  return {
    kind: "highlight",
    id: row.id,
    selectedText: row.selected_text ?? "",
    pageNumber: row.page_number ?? 1,
    color: row.color ?? "",
    messageCount: row.message_count,
    // A highlight is only listed for a message it has, so this is never null.
    lastMessage: lastMessage ?? { role: "user", content: "" },
    updatedAt: row.updated_at,
  };
}

/** The book's chat list. NOT_FOUND for a book that is not on the shelf. */
export function listChats(db: D1Database, pdfId: string): ResultAsync<ChatSummary[], ServiceError> {
  return ResultAsync.fromPromise(
    db.batch([
      db.prepare("SELECT id FROM pdfs WHERE id = ?1").bind(pdfId),
      db.prepare(CHAT_LIST_SQL).bind(pdfId, CHAT_LIST_SNIPPET_LENGTH),
    ]),
    storageFailure,
  ).andThen(([book, list]) =>
    book.results.length === 0
      ? err(notFound())
      : ok((list.results as unknown as ChatListRow[]).map(summaryOf)),
  );
}
