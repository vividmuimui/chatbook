-- The book's own conversation splits into sessions: a reader asks the book one
-- thing, starts a new chat for something unrelated, and keeps both. A highlight's
-- conversation is untouched — it still hangs off its selection, and has no
-- session.
--
-- title is NULL until the reader names the session; the screen calls an untitled
-- one by the start of its first question. scope is the pages the last question
-- in it was aimed at, as the JSON the send request carried ({ startPage,
-- endPage }[]); NULL is "nothing asked yet", read as the whole book.
CREATE TABLE chat_sessions (
  id          TEXT PRIMARY KEY,
  pdf_id      TEXT NOT NULL REFERENCES pdfs(id) ON DELETE CASCADE,
  title       TEXT,
  scope       TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX idx_chat_sessions_pdf_updated ON chat_sessions(pdf_id, updated_at);

-- Nullable: a highlight's messages have no session, and a column added to a
-- table that already has rows cannot be NOT NULL. Deleting a session takes its
-- messages, the same way deleting a highlight takes its own.
ALTER TABLE chat_messages ADD COLUMN session_id TEXT REFERENCES chat_sessions(id) ON DELETE CASCADE;

CREATE INDEX idx_chat_messages_session_time ON chat_messages(session_id, created_at)
  WHERE session_id IS NOT NULL;

-- Which session the reader had open, in place of last_read_book_chat — which
-- only said "the book's own" when there was one of those. No foreign key, like
-- last_read_selection_id: deleting a session clears it in the same batch.
-- last_read_book_chat itself stays, unread, so the Worker still deployed while
-- this runs keeps reading and writing a column that is there.
ALTER TABLE pdfs ADD COLUMN last_read_session_id TEXT;

-- Each book's existing conversation becomes its first session. There is at
-- most one per book here, which is what lets the two UPDATEs below find it by
-- pdf_id alone. The id is not a ULID (SQL cannot make one); nothing orders
-- sessions by id, so 32 hex characters serve as well.
INSERT INTO chat_sessions (id, pdf_id, title, scope, created_at, updated_at)
SELECT lower(hex(randomblob(16))), pdf_id, NULL, NULL, MIN(created_at), MAX(created_at)
  FROM chat_messages
 WHERE selection_id IS NULL
 GROUP BY pdf_id;

UPDATE chat_messages
   SET session_id = (SELECT s.id FROM chat_sessions s WHERE s.pdf_id = chat_messages.pdf_id)
 WHERE selection_id IS NULL;

-- A book left with its own conversation open opens on that session. One whose
-- conversation was open but empty has no session to name, and opens on the list.
UPDATE pdfs
   SET last_read_session_id = (SELECT s.id FROM chat_sessions s WHERE s.pdf_id = pdfs.id)
 WHERE last_read_book_chat = 1;
