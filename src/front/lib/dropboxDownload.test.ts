import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { downloadDropboxFile } from "./dropboxDownload";
import type { DropboxFile } from "../../shared/schemas/dropbox";

const FILE: DropboxFile = { dropboxId: "id:abc", name: "本.pdf", path: "/本.pdf", size: 8 };

/** A body that arrives in the pieces given, as a slow connection delivers it. */
function streamOf(...pieces: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
      controller.close();
    },
  });
}

describe("downloadDropboxFile", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports its share against the listed size and hands back the whole file", async () => {
    const fetchMock = vi.fn(async () => new Response(streamOf("%PDF", "-1.7")));
    vi.stubGlobal("fetch", fetchMock);
    const shares: number[] = [];

    const result = await downloadDropboxFile(FILE, (ratio) => shares.push(ratio));

    expect(fetchMock).toHaveBeenCalledWith("/api/dropbox/file?id=id%3Aabc");
    expect(shares).toStrictEqual([0.5, 1]);
    const file = result._unsafeUnwrap();
    expect(file.name).toBe("本.pdf");
    expect(await file.text()).toBe("%PDF-1.7");
  });

  it("hands back the server's refusal in its own words", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: { code: "DROPBOX_ERROR", message: "Dropbox is down" } }),
            { status: 502 },
          ),
      ),
    );

    const result = await downloadDropboxFile(FILE, () => {});

    expect(result._unsafeUnwrapErr()).toMatchObject({
      code: "DROPBOX_ERROR",
      message: "Dropbox is down",
      status: 502,
    });
  });

  it("reports a request that never reached the server as a network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );

    const result = await downloadDropboxFile(FILE, () => {});

    expect(result._unsafeUnwrapErr()).toMatchObject({ kind: "network" });
  });
});
