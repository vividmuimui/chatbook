import type { OcrJob } from "./ocrQueue";

/** What the reader is told when even OCR found nothing to read. */
export const NOTHING_TO_READ = "このPDFからは文字を読み取れませんでした";

/**
 * What the shelf and the reader say of a book whose text OCR is reading, or
 * has still to read. No job is a book the server has waiting with nothing
 * reading it in this tab: a reading stopped by closing or reloading the tab,
 * or by the reader's 中止.
 */
export function ocrWording(job: OcrJob | undefined): string {
  switch (job?.phase) {
    case undefined:
      return "文字の読み取りが途中です";
    case "waiting":
      return "文字の読み取り待ち";
    case "reading":
      return job.total === 0
        ? "文字を読み取り中..."
        : `文字を読み取り中 ${job.done}/${job.total} ページ`;
    case "saving":
      return "文字を保存中...";
    case "failed":
      return `文字を読み取れませんでした: ${job.reason}`;
    case "unreadable":
      return NOTHING_TO_READ;
  }
}

/** Whether the job is one 中止 can stop — the others are stopped already. */
export function ocrRunning(job: OcrJob | undefined): boolean {
  return job?.phase === "waiting" || job?.phase === "reading" || job?.phase === "saving";
}

/** Whether the book is waiting with nothing reading it, so 再開 has something to start. */
export function ocrStopped(job: OcrJob | undefined): boolean {
  return job === undefined || job.phase === "failed";
}
