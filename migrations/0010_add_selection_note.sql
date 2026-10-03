-- What the reader wrote against a highlight. Nullable, with no default: a
-- highlight without a note is NULL, which every row stored before notes is.
-- Adding a nullable column changes nothing for the code already deployed —
-- it never names the column — so this is safe to apply before the new code.
ALTER TABLE selections ADD COLUMN note TEXT;
