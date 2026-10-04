-- The reader's collections (Kindle's), and which shelf entries are in each.
--
-- A key is what `hidden_books` keys by: a book's id, or the Dropbox id
-- ("id:...") of a file in the folder that is not a book yet. No foreign key,
-- for the same reason — such a file has no row in `pdfs`. An entry of several
-- files (the PDF and the EPUB of one title) is put in with every key it holds,
-- and belongs to a collection when any of them is in it. One key may be in any
-- number of collections.
--
-- When a Dropbox file is brought in its key becomes the book's id: the import
-- moves the rows across (`storePdf`), the way a title moves off `book_titles`.
-- Deleting a book moves them back to its Dropbox id when it has one (the file
-- goes back to waiting in the folder), and drops them otherwise.
--
-- Deleting a collection takes its rows; the books themselves stay.
-- Two new tables change nothing for the code already deployed, so this is safe
-- to apply before the new code.
CREATE TABLE collections (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, key)
);

-- The import and the deletion look a key up across every collection.
CREATE INDEX idx_collection_items_key ON collection_items(key);
