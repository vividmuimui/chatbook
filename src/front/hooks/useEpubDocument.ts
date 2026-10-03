// oxlint-disable-next-line no-restricted-imports -- EPUB のバイナリを取得して展開する初期化処理と、画像に作った blob URL の後始末に必要
import { useEffect, useState } from "react";
import { openEpub, type EpubBook } from "../lib/epub";
import { forgetUploadedFile, uploadedFileFor } from "../lib/uploadedFileHandoff";
import { readRefusal } from "../lib/fetcher";

/** An opened EPUB, with a way to draw its images. */
export interface OpenedEpub {
  book: EpubBook;
  /** A URL the browser can draw an image of the book from, by archive path. */
  imageUrl: (path: string) => string | null;
}

/**
 * Load an EPUB for the reader: the bytes the reader just uploaded if they are
 * still in hand, or the stored file otherwise — the same two ways in, and for
 * the same reasons, as `usePdfDocument`.
 *
 * `error` is why it could not be opened, in the words of whoever refused; the
 * viewer turns it into a sentence.
 */
export function useEpubDocument(pdfId: string | undefined, fetchFn: typeof fetch = fetch) {
  const [opened, setOpened] = useState<OpenedEpub | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setOpened(null);
    setError(null);
    if (!pdfId) return;

    const bookId = pdfId;
    const url = `/api/pdf/${bookId}/file`;
    let cancelled = false;
    // Each image is made into a blob URL the first time a chapter asks for it,
    // and every one of them is let go with the book.
    const imageUrls = new Map<string, string>();

    async function load() {
      try {
        const justUploaded = uploadedFileFor(bookId);
        const bytes = await (async () => {
          if (justUploaded) return justUploaded.arrayBuffer();
          const response = await fetchFn(url);
          if (!response.ok) throw new Error((await readRefusal(url, response)).message);
          return response.arrayBuffer();
        })();
        if (cancelled) return;

        const book = openEpub(new Uint8Array(bytes));
        const imageUrl = (path: string) => {
          const made = imageUrls.get(path);
          if (made) return made;
          const data = book.file(path);
          const type = book.mediaType(path);
          // Only images: a URL made for anything else would hand the browser a
          // document of the book's to open.
          if (!data || !type?.startsWith("image/")) return null;
          const created = URL.createObjectURL(new Blob([data as BlobPart], { type }));
          imageUrls.set(path, created);
          return created;
        };

        setOpened({ book, imageUrl });
        if (justUploaded) forgetUploadedFile(bookId);
      } catch (cause) {
        console.error("Failed to load EPUB for reading:", cause);
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      }
    }

    void load();

    return () => {
      cancelled = true;
      for (const created of imageUrls.values()) URL.revokeObjectURL(created);
    };
  }, [pdfId, fetchFn]);

  return { epub: opened, error };
}
