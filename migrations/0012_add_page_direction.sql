-- Which way the book's pages turn: 'ltr' (opens on the left, read left to
-- right — a book set horizontally, and every book stored before this) or 'rtl'
-- (opens on the right — a book set vertically in Japanese, or a manga). The
-- viewer lays a spread out and maps the left and right of the screen onto the
-- previous and next page by it. Adding a column with a default changes nothing
-- for the code already deployed, so this is safe to apply before the new code.
ALTER TABLE pdfs ADD COLUMN page_direction TEXT NOT NULL DEFAULT 'ltr';
