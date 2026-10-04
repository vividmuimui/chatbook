import { useCallback, useSyncExternalStore } from "react";
import { useSWRConfig } from "swr";
import { COLLECTIONS_KEY } from "../lib/collectionsApi";
import type { DownloadDropboxFile } from "../lib/dropboxDownload";
import {
  importQueue as tabQueue,
  type ImportQueue,
  type ImportRun,
  type ImportSnapshot,
} from "../lib/importQueue";
import { DROPBOX_KEY, SHELF_KEY, TITLES_KEY } from "../lib/shelfKey";
import type { OpenPdfBook } from "./useOpenPdfBook";
import type { DropboxFile, DropboxFolderListing } from "../../shared/schemas/dropbox";

export interface DropboxImport extends ImportSnapshot {
  /** Puts the files in the queue, to be brought in one at a time. */
  importAll: (files: DropboxFile[]) => void;
  /** Stops: what waits stays in the folder, the file being brought in is stopped. */
  cancel: () => void;
  take: ImportQueue["take"];
  forget: ImportQueue["forget"];
  settled: ImportQueue["settled"];
}

/**
 * The tab's queue of Dropbox files being brought in all at once, as the shelf
 * sees it and adds to it.
 *
 * Each file goes the way one opened from its card does — downloaded, read for
 * its text, then stored with its Dropbox id so the server takes the bytes from
 * Dropbox itself — except that nobody is about to open it: its bytes are not
 * left for the viewer (`handOff: false`), and a book of pictures is handed to
 * the OCR queue without them, to be fetched again when its turn comes. So a
 * run holds one book's bytes and lets them go when it settles.
 *
 * What a stored file changes is written into the caches it is read from — the
 * shelf, the folder's list (the file is a book now), and the titles and
 * collections that moved with it onto the book — through the cache's `mutate`,
 * which still works once the reader has left the shelf.
 */
export function useDropboxImport({
  download,
  openFile,
  startOcr,
  queue = tabQueue,
}: {
  download: DownloadDropboxFile;
  openFile: OpenPdfBook;
  startOcr: (pdfId: string, file: File | null) => void;
  queue?: ImportQueue;
}): DropboxImport {
  const { mutate } = useSWRConfig();
  const snapshot = useSyncExternalStore(queue.subscribe, queue.getSnapshot);

  const importAll = useCallback(
    (files: DropboxFile[]) => {
      for (const file of files) {
        const run: ImportRun = async ({ signal, report }) => {
          const downloaded = await download(
            file,
            (ratio) => report({ phase: "downloading", ratio }),
            signal,
          );
          if (downloaded.isErr()) throw downloaded.error;
          // The bytes are here, but the reader asked to stop before they were read
          signal.throwIfAborted();
          report({ phase: "reading" });
          const stored = await openFile(downloaded.value, {
            dropboxId: file.dropboxId,
            handOff: false,
            // Only the id goes up, so this is the server at work rather than
            // the reader's connection.
            onProgress: () => report({ phase: "storing" }),
          });
          if (stored.isErr()) throw stored.error;
          if (stored.value.ocrPending) startOcr(stored.value.id, null);

          await Promise.all([
            mutate(SHELF_KEY),
            mutate<DropboxFolderListing>(
              DROPBOX_KEY,
              (current) =>
                current?.state === "ready"
                  ? {
                      ...current,
                      files: current.files.filter((f) => f.dropboxId !== file.dropboxId),
                    }
                  : current,
              { revalidate: false },
            ),
            mutate(TITLES_KEY),
            mutate(COLLECTIONS_KEY),
          ]);
          return stored.value.id;
        };
        queue.enqueue(file.dropboxId, run);
      }
    },
    [queue, download, openFile, startOcr, mutate],
  );

  return {
    ...snapshot,
    importAll,
    cancel: queue.cancel,
    take: queue.take,
    forget: queue.forget,
    settled: queue.settled,
  };
}
