import { ResultAsync } from "neverthrow";
import { ApiError, networkFailure, readRefusal } from "./fetcher";
import type { DropboxFile } from "../../shared/schemas/dropbox";

/** Fetches a Dropbox file's bytes as a `File`, reporting how far it has got. */
export type DownloadDropboxFile = (
  file: DropboxFile,
  onProgress: (ratio: number) => void,
) => ResultAsync<File, ApiError>;

/**
 * Brings a book in the Dropbox folder down to the browser, which has to read it
 * before it can be stored (the Worker cannot run pdf.js).
 *
 * The share is worked out against the size the listing gave rather than a
 * `Content-Length`: the Worker passes Dropbox's stream through as it arrives,
 * and a stream need not say how long it is. A book is large enough for the
 * reader to have to see it moving — the upload's 22MB took over a minute.
 *
 * Handed back as a `File` so it can go where a file the reader picked goes:
 * pdf.js reads it for the text, and the viewer takes it over instead of asking
 * for the same bytes again.
 */
export const downloadDropboxFile: DownloadDropboxFile = (file, onProgress) => {
  const url = `/api/dropbox/file?id=${encodeURIComponent(file.dropboxId)}`;

  const downloaded = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw await readRefusal(url, response);
    if (!response.body) return new File([await response.blob()], file.name);

    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (file.size > 0) onProgress(Math.min(1, received / file.size));
    }
    return new File(chunks, file.name, { type: "application/pdf" });
  })();

  return ResultAsync.fromPromise(downloaded, (cause) =>
    cause instanceof ApiError ? cause : networkFailure(url, cause),
  );
};
