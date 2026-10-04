/**
 * Cache key of the shelf, and the endpoint it is read from. Its own module so
 * what writes into the shelf's cache from outside the shelf — the background
 * OCR, which finishes wherever the reader happens to be — files it the same.
 */
export const SHELF_KEY = "/api/pdfs";

/**
 * Cache key of the Dropbox folder's books that are not on the shelf yet. Read
 * apart from the shelf so the books already on it never wait for Dropbox. Here
 * too because the import of the whole folder, which runs on past the shelf,
 * takes each file off it as the file becomes a book.
 */
export const DROPBOX_KEY = "/api/dropbox/files";

/** Cache key of the titles the reader gave Dropbox files not brought in yet. */
export const TITLES_KEY = "/api/shelf/titles";
