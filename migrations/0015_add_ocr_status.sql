-- Where a book of pictures (a scanned book) stands with OCR. 'pending' is a
-- book stored before its text was read — OCR runs afterwards in the reader's
-- browser and `PUT /api/pdf/:pdfId/ocr` writes what it read — and 'done' is
-- one whose text has been read. NULL is a book with text of its own, and every
-- book stored before this column (a scanned book was read before it was
-- stored then, so none of them is waiting). Adding a nullable column changes
-- nothing for the code already deployed, so this is safe to apply before the
-- new code.
ALTER TABLE pdfs ADD COLUMN ocr_status TEXT;
