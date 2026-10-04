/**
 * Cache key of the shelf, and the endpoint it is read from. Its own module so
 * what writes into the shelf's cache from outside the shelf — the background
 * OCR, which finishes wherever the reader happens to be — files it the same.
 */
export const SHELF_KEY = "/api/pdfs";
