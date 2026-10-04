-- Titles the reader gave files in the Dropbox folder that are not books yet.
-- Keyed like `hidden_books` by the Dropbox id ("id:..."), with no foreign key —
-- such a file has no row in `pdfs` to point at. A book that is on the shelf
-- keeps its title in `pdfs.title`; when a file named here is brought in, its
-- title moves onto the book's row and leaves this table, and when that book is
-- deleted (its file goes back to waiting in the folder) the title comes back.
-- A new table changes nothing for the code already deployed, so this is safe
-- to apply before the new code.
CREATE TABLE book_titles (
  key TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL
);
