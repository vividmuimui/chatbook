-- Books the reader has put away from the shelf. The key is a book's id, or the
-- Dropbox id ("id:...") of a file in the folder that is not a book yet — the
-- two things the shelf shows. No foreign key: a Dropbox file has no row in
-- `pdfs` to point at, and a key left behind by a deleted book names nothing.
CREATE TABLE hidden_books (
  key TEXT PRIMARY KEY NOT NULL,
  hidden_at TEXT NOT NULL
);
