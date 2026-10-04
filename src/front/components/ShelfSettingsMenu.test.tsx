import { describe, it, expect, vi, afterEach } from "vite-plus/test";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider, createStore } from "jotai";
import { errAsync, okAsync, type ResultAsync } from "neverthrow";
import { ShelfSettingsMenu } from "./ShelfSettingsMenu";
import { ApiError } from "../lib/fetcher";
import type { SessionEnded } from "../../shared/schemas/auth";

function renderMenu(endSession: () => ResultAsync<SessionEnded, ApiError>) {
  render(
    <Provider store={createStore()}>
      <ShelfSettingsMenu dropbox={null} onChooseFolder={() => {}} endSession={endSession} />
    </Provider>,
  );
}

describe("ShelfSettingsMenu's way out", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ends the session and reloads to the shelf, where the password box waits", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { assign });
    const endSession = vi.fn(() => okAsync<SessionEnded, ApiError>({ signedIn: false }));
    renderMenu(endSession);
    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(assign).toHaveBeenCalledWith("/");
  });

  it("says why the session could not be ended, rather than looking logged out", async () => {
    // The reader would otherwise be shown the shelf again with the cookie still
    // on it, having been told nothing — on a borrowed laptop that is the worst
    // possible time to assume it worked.
    renderMenu(() => errAsync(new ApiError("Failed to fetch", "NETWORK_ERROR", 0, "network")));
    await userEvent.click(screen.getByRole("button", { name: "設定" }));

    await userEvent.click(screen.getByRole("button", { name: "ログアウト" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /^ログアウトできませんでした: Failed to fetch$/,
    );
    // Still open, so the reader can try again without hunting for the menu
    expect(screen.getByRole("button", { name: "ログアウト" })).toBeInTheDocument();
  });
});
