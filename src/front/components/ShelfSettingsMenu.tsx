// oxlint-disable-next-line no-restricted-imports -- document への keydown / mousedown 購読 (Escape と外側クリックで閉じる) に必要
import { useState, useRef, useEffect } from "react";
import { useAtom } from "jotai";
import type { ResultAsync } from "neverthrow";
import { preferredFormatAtom } from "../atoms/settingsAtom";
import { resultFetcher, type ApiError } from "../lib/fetcher";
import { sessionEndedSchema, type SessionEnded } from "../../shared/schemas/auth";

interface ShelfSettingsMenuProps {
  /**
   * What the shelf knows of Dropbox: nothing to offer on a deploy without its
   * credentials (`null`), else the folder chosen — `null` folder for none yet,
   * or for one that could not be read, which is still something to change.
   */
  dropbox: { folder: string | null } | null;
  /** Opens the dialog the folder is typed into. */
  onChooseFolder: () => void;
  /** Injectable so a session that could not be ended can be driven in a test. */
  endSession?: () => ResultAsync<SessionEnded, ApiError>;
}

/**
 * The shelf's settings: what is chosen once and then left alone, kept out of
 * the header, which holds what the reader reaches for while looking over the
 * shelf (the layout, the hidden books). The reader's own menu (`SettingsMenu`)
 * is the same shape, under the same name.
 */
export function ShelfSettingsMenu({
  dropbox,
  onChooseFolder,
  endSession = requestSessionEnd,
}: ShelfSettingsMenuProps) {
  const [open, setOpen] = useState(false);
  const [preferredFormat, setPreferredFormat] = useAtom(preferredFormatAtom);
  const [logOutError, setLogOutError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const logOut = async () => {
    setLogOutError(null);

    const ended = await endSession();
    if (ended.isErr()) {
      // Left signed in and told so: the cookie is still on the browser, and a
      // reader who thinks they are out would walk away from an open shelf.
      setLogOutError(`ログアウトできませんでした: ${ended.error.message}`);
      return;
    }

    // The reload is what puts the password box back: the cookie is gone, so the
    // next thing the gate asks gets a 401, and every book on screen — which all
    // came from behind that cookie — goes with it.
    window.location.assign("/");
  };

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-label="設定"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center rounded text-lg leading-none text-gray-600 hover:bg-gray-200 cursor-pointer"
      >
        ⚙
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-3 shadow-xl">
          {/* A select rather than a pair of PDF / EPUB buttons, whose names the
              format chips' (「… を PDF で開く」) would partly match. */}
          <label className="flex items-center justify-between gap-2 px-1 text-sm text-gray-700">
            優先する形式
            <select
              value={preferredFormat}
              onChange={(e) => setPreferredFormat(e.target.value === "epub" ? "epub" : "pdf")}
              className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-800 cursor-pointer focus:border-blue-400 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="pdf">PDF</option>
              <option value="epub">EPUB</option>
            </select>
          </label>
          <p className="px-1 pt-1 text-xs text-gray-500">
            PDF と EPUB の両方がある本で、先に開く形式
          </p>

          {/* Only where the deploy holds Dropbox credentials. */}
          {dropbox !== null && (
            <section aria-label="Dropbox" className="mt-3 border-t border-gray-100 pt-3">
              <p className="px-1 text-xs font-semibold text-gray-500">Dropbox の参照フォルダ</p>
              <p className="truncate px-1 py-1 text-sm text-gray-800">
                {dropbox.folder ?? <span className="text-gray-400">未設定</span>}
              </p>
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onChooseFolder();
                }}
                className="w-full rounded-md border border-gray-300 px-2.5 py-1 text-sm text-gray-700 cursor-pointer hover:bg-gray-50"
              >
                Dropboxフォルダを設定
              </button>
            </section>
          )}

          {/* On the shelf rather than in the reader's menu: every book is one
              tap (「← 本棚」) away from here, and one way out is easier to find
              than two. */}
          <div className="mt-3 border-t border-gray-100 pt-2">
            <button
              type="button"
              onClick={() => void logOut()}
              className="w-full rounded px-1 py-1 text-left text-sm text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              ログアウト
            </button>
            {logOutError !== null && (
              <p role="alert" className="px-1 pt-1 text-xs text-red-600">
                {logOutError}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Asks the server to take the session back. */
function requestSessionEnd(): ResultAsync<SessionEnded, ApiError> {
  return resultFetcher("/api/auth/logout", sessionEndedSchema, { method: "POST" });
}
