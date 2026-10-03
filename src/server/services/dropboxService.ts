import { ResultAsync, errAsync, okAsync } from "neverthrow";

/**
 * Talking to Dropbox: the folder the shelf is read from, and the place uploads
 * are written to.
 *
 * Dropbox holds the books and R2 keeps a copy for serving (`routes/pdf.ts`), so
 * nothing here is on the path of opening a book that was opened before.
 */

/** The three secrets a deploy holds to reach one person's Dropbox. */
export interface DropboxCredentials {
  appKey: string;
  appSecret: string;
  refreshToken: string;
}

/** The bindings this reads. All optional: a deploy without them has no Dropbox. */
export interface DropboxEnv {
  DROPBOX_APP_KEY?: string;
  DROPBOX_APP_SECRET?: string;
  DROPBOX_REFRESH_TOKEN?: string;
}

/** The credentials, or null when any of the three is missing. */
export function dropboxCredentials(env: DropboxEnv): DropboxCredentials | null {
  const appKey = env.DROPBOX_APP_KEY?.trim();
  const appSecret = env.DROPBOX_APP_SECRET?.trim();
  const refreshToken = env.DROPBOX_REFRESH_TOKEN?.trim();
  if (!appKey || !appSecret || !refreshToken) return null;
  return { appKey, appSecret, refreshToken };
}

/**
 * Why a Dropbox call did not deliver. `NOT_FOUND` is the path or id not being
 * there — something a caller words for the reader. Everything else is Dropbox
 * refusing or not answering, and only the server log needs the detail.
 */
export type DropboxError = { type: "NOT_FOUND" } | { type: "DROPBOX"; cause: unknown };

const dropboxFailure = (cause: unknown): DropboxError => ({ type: "DROPBOX", cause });

/** One file as `list_folder` and `get_metadata` describe it. */
export interface DropboxFileEntry {
  id: string;
  name: string;
  pathLower: string;
  pathDisplay: string;
  size: number;
  contentHash: string;
}

const API = "https://api.dropboxapi.com";
const CONTENT = "https://content.dropboxapi.com";

/**
 * Access tokens by refresh token, for as long as Dropbox says they last.
 *
 * An isolate serves many requests, and each would otherwise spend a round trip
 * minting a token before doing the thing it was asked. Kept a minute short of
 * the real expiry so a token is never sent in its last moments.
 */
const accessTokens = new Map<string, { token: string; expiresAt: number }>();

/** Forgets every cached token. For tests, which mock a fresh token endpoint each time. */
export function forgetDropboxTokens(): void {
  accessTokens.clear();
}

/**
 * `Dropbox-API-Arg` is a header, and a header has to be ASCII. A Japanese file
 * name sent as-is is refused, so everything past ASCII goes as a JSON escape,
 * which Dropbox reads back as the same string.
 */
export function headerSafeJson(value: unknown): string {
  return JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Dropbox's own content hash: SHA-256 over the SHA-256 of each 4MB block.
 * Compared against `content_hash` in a listing to find a file that is already
 * in the folder, whatever it is called there.
 */
export async function dropboxContentHash(bytes: ArrayBuffer): Promise<string> {
  const BLOCK_SIZE = 4 * 1024 * 1024;
  const blockHashes: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BLOCK_SIZE) {
    const block = bytes.slice(offset, offset + BLOCK_SIZE);
    blockHashes.push(new Uint8Array(await crypto.subtle.digest("SHA-256", block)));
  }
  const joined = new Uint8Array(blockHashes.length * 32);
  blockHashes.forEach((hash, i) => joined.set(hash, i * 32));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", joined));
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** The folder path the API takes: the root is the empty string, not `/`. */
function apiPath(folder: string): string {
  return folder === "/" ? "" : folder;
}

/** Whether a file's lower-cased path lies inside the folder (or is the root's). */
export function isInsideFolder(pathLower: string, folder: string): boolean {
  if (folder === "/") return true;
  return pathLower.startsWith(`${folder.toLowerCase()}/`);
}

/** A failed reply, read as far as it can be — Dropbox explains itself in the body. */
async function describeFailure(response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  return `Dropbox answered ${response.status}: ${body.slice(0, 500)}`;
}

/**
 * Dropbox reports a missing path as a 409 whose summary starts with the
 * argument's name and then `not_found` (`path/not_found/..`, `path_lookup/...`).
 */
function isNotFound(status: number, body: string): boolean {
  return status === 409 && /not_found/.test(body);
}

interface RawEntry {
  ".tag": string;
  id: string;
  name: string;
  path_lower: string;
  path_display: string;
  size?: number;
  content_hash?: string;
}

function toFileEntry(raw: RawEntry): DropboxFileEntry {
  return {
    id: raw.id,
    name: raw.name,
    pathLower: raw.path_lower,
    pathDisplay: raw.path_display,
    size: raw.size ?? 0,
    contentHash: raw.content_hash ?? "",
  };
}

export class DropboxClient {
  private readonly credentials: DropboxCredentials;

  constructor(credentials: DropboxCredentials) {
    this.credentials = credentials;
  }

  private async accessToken(): Promise<string> {
    const cached = accessTokens.get(this.credentials.refreshToken);
    if (cached && cached.expiresAt > Date.now()) return cached.token;

    const response = await fetch(`${API}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: this.credentials.refreshToken,
        client_id: this.credentials.appKey,
        client_secret: this.credentials.appSecret,
      }),
    });
    if (!response.ok) throw new Error(await describeFailure(response));

    const { access_token, expires_in } = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };
    accessTokens.set(this.credentials.refreshToken, {
      token: access_token,
      expiresAt: Date.now() + Math.max(0, expires_in - 60) * 1000,
    });
    return access_token;
  }

  /**
   * One call with a token, and one more with a fresh token if Dropbox says the
   * first had expired (it can, before the time it was given for).
   */
  private async call(build: (token: string) => [string, RequestInit]): Promise<Response> {
    const first = await fetch(...build(await this.accessToken()));
    if (first.status !== 401) return first;
    accessTokens.delete(this.credentials.refreshToken);
    return fetch(...build(await this.accessToken()));
  }

  private rpc(endpoint: string, args: unknown): Promise<Response> {
    return this.call((token) => [
      `${API}/2/${endpoint}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(args),
      },
    ]);
  }

  /**
   * Whether the folder exists. `false` for a path that is missing or names a
   * file — both mean the reader typed something that cannot be a book folder.
   */
  folderExists(folder: string): ResultAsync<boolean, DropboxError> {
    // The root always exists, and get_metadata refuses to describe it.
    if (folder === "/") return okAsync(true);

    return ResultAsync.fromPromise(
      (async () => {
        const response = await this.rpc("files/get_metadata", { path: apiPath(folder) });
        if (response.ok) {
          const entry = (await response.json()) as RawEntry;
          return entry[".tag"] === "folder";
        }
        const body = await response.text();
        if (isNotFound(response.status, body)) return false;
        throw new Error(`Dropbox answered ${response.status}: ${body.slice(0, 500)}`);
      })(),
      dropboxFailure,
    );
  }

  /** Every PDF in the folder and the folders under it. */
  listPdfs(folder: string): ResultAsync<DropboxFileEntry[], DropboxError> {
    return ResultAsync.fromPromise(
      (async () => {
        const entries: RawEntry[] = [];
        let response = await this.rpc("files/list_folder", {
          path: apiPath(folder),
          recursive: true,
          limit: 2000,
        });
        for (;;) {
          if (!response.ok) {
            const body = await response.text();
            if (isNotFound(response.status, body)) return null;
            throw new Error(`Dropbox answered ${response.status}: ${body.slice(0, 500)}`);
          }
          const page = (await response.json()) as {
            entries: RawEntry[];
            cursor: string;
            has_more: boolean;
          };
          entries.push(...page.entries);
          if (!page.has_more) break;
          response = await this.rpc("files/list_folder/continue", { cursor: page.cursor });
        }
        return entries
          .filter((entry) => entry[".tag"] === "file" && /\.pdf$/i.test(entry.name))
          .map(toFileEntry);
      })(),
      dropboxFailure,
    ).andThen((files) => (files ? okAsync(files) : errAsync({ type: "NOT_FOUND" } as const)));
  }

  /**
   * A file's bytes and what Dropbox says about it, by id or by path. The body
   * is left unread so a caller can stream it on.
   */
  download(
    idOrPath: string,
  ): ResultAsync<{ entry: DropboxFileEntry; body: ReadableStream }, DropboxError> {
    return ResultAsync.fromPromise(
      (async () => {
        const response = await this.call((token) => [
          `${CONTENT}/2/files/download`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Dropbox-API-Arg": headerSafeJson({ path: idOrPath }),
            },
          },
        ]);
        if (!response.ok || !response.body) {
          const body = await response.text();
          if (isNotFound(response.status, body)) return null;
          throw new Error(`Dropbox answered ${response.status}: ${body.slice(0, 500)}`);
        }
        const raw = JSON.parse(response.headers.get("Dropbox-API-Result") ?? "{}") as RawEntry;
        return { entry: toFileEntry({ ...raw, ".tag": "file" }), body: response.body };
      })(),
      dropboxFailure,
    ).andThen((found) => (found ? okAsync(found) : errAsync({ type: "NOT_FOUND" } as const)));
  }

  /**
   * Writes a new file into the folder. Never over an existing one: a name that
   * is taken gets Dropbox's own " (1)" suffix, so nothing the reader keeps
   * there is replaced by an upload.
   */
  upload(
    folder: string,
    fileName: string,
    bytes: ArrayBuffer,
  ): ResultAsync<DropboxFileEntry, DropboxError> {
    return ResultAsync.fromPromise(
      (async () => {
        const response = await this.call((token) => [
          `${CONTENT}/2/files/upload`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/octet-stream",
              "Dropbox-API-Arg": headerSafeJson({
                path: `${apiPath(folder)}/${fileName}`,
                mode: "add",
                autorename: true,
                mute: true,
              }),
            },
            body: bytes,
          },
        ]);
        if (!response.ok) throw new Error(await describeFailure(response));
        return toFileEntry({ ...((await response.json()) as RawEntry), ".tag": "file" });
      })(),
      dropboxFailure,
    );
  }
}

/**
 * A file of the chosen folder, read whole. `NOT_FOUND` also for a file that
 * exists but lies outside the folder: what is stored as a book has to be one
 * the shelf could have listed.
 */
export function readFolderFile(
  client: DropboxClient,
  folder: string,
  dropboxId: string,
): ResultAsync<{ entry: DropboxFileEntry; bytes: ArrayBuffer }, DropboxError> {
  return client.download(dropboxId).andThen(({ entry, body }) => {
    if (!isInsideFolder(entry.pathLower, folder)) {
      return ResultAsync.fromSafePromise(body.cancel()).andThen(() =>
        errAsync({ type: "NOT_FOUND" } as const),
      );
    }
    return ResultAsync.fromPromise(new Response(body).arrayBuffer(), dropboxFailure).map(
      (bytes) => ({ entry, bytes }),
    );
  });
}

/**
 * Puts an uploaded book into the folder, unless the same bytes are already in
 * it under whatever name — then that file is the book, and no copy is made.
 */
export function placeInFolder(
  client: DropboxClient,
  folder: string,
  fileName: string,
  bytes: ArrayBuffer,
): ResultAsync<DropboxFileEntry, DropboxError> {
  return ResultAsync.fromPromise(dropboxContentHash(bytes), dropboxFailure).andThen((hash) =>
    client.listPdfs(folder).andThen((files) => {
      const same = files.find((file) => file.contentHash === hash);
      if (same) return okAsync(same);
      // A slash would put the file in a folder of its own making.
      return client.upload(folder, fileName.replace(/[/\\]/g, "_"), bytes);
    }),
  );
}
