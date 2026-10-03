-- The Dropbox file a book was read from or written to. Dropbox's own file id
-- ("id:..."), which survives the file being renamed or moved inside the folder,
-- so the shelf can tell which files in the folder are already books. NULL for
-- books that live only in R2: stored before Dropbox was connected, or uploaded
-- while no folder was set.
ALTER TABLE pdfs ADD COLUMN dropbox_id TEXT;
CREATE UNIQUE INDEX idx_pdfs_dropbox_id ON pdfs (dropbox_id);

-- Settings the reader changes from the screen rather than by redeploying.
-- One row per key; currently only `dropbox_folder`.
CREATE TABLE settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
