import { useCallback, useState } from "react";
import { useSetAtom } from "jotai";
import type { ResultAsync } from "neverthrow";
import {
  activeSelectionAtom,
  activeSessionAtom,
  chatMessagesAtom,
  chatPanelOpenAtom,
  chatSheetAtom,
} from "../atoms/chatAtom";
import { useIsNarrow } from "./useIsNarrow";
import { resultFetcher, type ApiError } from "../lib/fetcher";
import {
  createdSelectionSchema,
  type CreatedSelection,
  type HighlightColor,
  type PositionData,
} from "../../shared/schemas/selection";
import { useChatStream } from "./useChatStream";

/** A highlight the reader has just drawn, before the server has an id for it. */
export interface SelectionDraft {
  selectedText: string;
  pageNumber: number;
  /** Sent whole; the endpoint keeps only `rects` and `pageWidth`. */
  positionData: PositionData;
  /** Left out when asking, which stores the default yellow. */
  color?: HighlightColor;
  /** What the reader wrote against the passage, if they wrote anything. */
  note?: string;
}

export type SaveSelection = (
  pdfId: string,
  draft: SelectionDraft,
) => ResultAsync<CreatedSelection, ApiError>;

const storeSelection: SaveSelection = (pdfId, draft) =>
  resultFetcher(`/api/pdf/${pdfId}/selections`, createdSelectionSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(draft),
  });

/**
 * Turn a passage the reader has just marked into a highlight and a question
 * about it.
 *
 * The two steps are in that order for a reason: the answer is stored against
 * the highlight, so asking before the highlight exists would stream a reply
 * with nothing to hang it on. A failure to store therefore stops the ask, and
 * the caller is told so — the viewer keeps its popover open, with the question
 * still in it, rather than losing what the reader typed.
 */
export function useAskAboutSelection(
  addHighlight: (selection: CreatedSelection) => void,
  saveSelection: SaveSelection = storeSelection,
) {
  const setActiveSelection = useSetAtom(activeSelectionAtom);
  const setActiveSession = useSetAtom(activeSessionAtom);
  const setChatMessages = useSetAtom(chatMessagesAtom);
  const setChatSheet = useSetAtom(chatSheetAtom);
  const setChatPanelOpen = useSetAtom(chatPanelOpenAtom);
  const isNarrow = useIsNarrow();
  const { sendMessage } = useChatStream();
  const [saveError, setSaveError] = useState<string | null>(null);

  const askAboutSelection = useCallback(
    (pdfId: string, draft: SelectionDraft, question: string, useWebSearch: boolean) => {
      setSaveError(null);

      return saveSelection(pdfId, draft)
        .andTee((selection) => {
          addHighlight(selection);
          // One panel, one conversation at a time: the book's own thread is
          // left behind, as it is when a highlight is opened from the list.
          setActiveSession(null);
          setActiveSelection({
            id: selection.id,
            selectedText: selection.selectedText,
            pageNumber: selection.pageNumber,
          });
          setChatMessages([]);
          // Asking is the strongest way a reader can ask for the conversation,
          // so the answer is never streamed into something folded away: the
          // sheet comes up on one column and a hidden panel comes back on two.
          // A sheet already drawn up is left where it is, as `openChat` does.
          if (isNarrow) {
            setChatSheet((sheet) => (sheet === "closed" ? "half" : sheet));
          } else {
            setChatPanelOpen(true);
          }
          // The answer is not waited for. It takes seconds to arrive, and what
          // the caller is waiting on is whether the highlight was kept. The
          // stream reports its own failures through chatErrorAtom.
          void sendMessage(pdfId, { selectionId: selection.id }, question, useWebSearch);
        })
        .orTee((failure) => {
          // Why it failed, in the server's words. The viewer writes the
          // sentence around it, as every other display of a failure does.
          setSaveError(failure.message);
        });
    },
    [
      addHighlight,
      isNarrow,
      saveSelection,
      sendMessage,
      setActiveSelection,
      setActiveSession,
      setChatMessages,
      setChatPanelOpen,
      setChatSheet,
    ],
  );

  /**
   * Keep a passage as a highlight and nothing more — the Kindle way of marking
   * a book, in the colour the reader picked and with their note if they wrote
   * one. No chat opens: there is no question, so no answer to show, and
   * drawing the sheet up would cover the page the reader is marking.
   *
   * Fails into the same `saveError` an ask does, so the viewer has one place
   * that says a highlight was not kept, whichever way it was made.
   */
  const markSelection = useCallback(
    (pdfId: string, draft: SelectionDraft) => {
      setSaveError(null);

      return saveSelection(pdfId, draft)
        .andTee(addHighlight)
        .orTee((failure) => setSaveError(failure.message));
    },
    [addHighlight, saveSelection],
  );

  return { askAboutSelection, markSelection, saveError };
}
