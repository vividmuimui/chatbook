-- The title the reader gave a book, shown in place of the one made from its
-- file name. Nullable, with no default: NULL is "never renamed", which every
-- book stored before this column is, and what clearing the title goes back to.
-- Adding a nullable column changes nothing for the code already deployed — it
-- never names the column — so this is safe to apply before the new code.
ALTER TABLE pdfs ADD COLUMN title TEXT;
