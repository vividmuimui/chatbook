-- What kind of file a book is: 'pdf' or 'epub'. Every book stored before EPUB
-- could be read is a PDF, which is what the default says. The viewer, the R2
-- object's Content-Type and the shelf's wording all follow it.
ALTER TABLE pdfs ADD COLUMN format TEXT NOT NULL DEFAULT 'pdf';
