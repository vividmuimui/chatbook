import type { ResultAsync } from "neverthrow";
import { fetcher, resultFetcher, type ApiError } from "./fetcher";
import {
  collectionsSchema,
  type Collections,
  type CreateCollectionRequest,
  type RenameCollectionRequest,
  type SetCollectionItemsRequest,
} from "../../shared/schemas/shelf";

/** Cache key of the reader's collections, and the endpoint they are read from. */
export const COLLECTIONS_KEY = "/api/shelf/collections";

/**
 * The collections' reads and writes, together so the shelf takes them — and a
 * test stands in for them — as one. Every write answers with every collection
 * as it now stands, which the shelf puts in its cache as it is.
 */
export interface CollectionsApi {
  /** Read by SWR, so a refusal throws into its `error` state. */
  load: () => Promise<Collections>;
  create: (name: string, keys?: string[]) => ResultAsync<Collections, ApiError>;
  rename: (id: string, name: string) => ResultAsync<Collections, ApiError>;
  remove: (id: string) => ResultAsync<Collections, ApiError>;
  /** Puts the keys in (`member`) or takes them out. */
  setItems: (id: string, keys: string[], member: boolean) => ResultAsync<Collections, ApiError>;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

const collectionUrl = (id: string) => `${COLLECTIONS_KEY}/${encodeURIComponent(id)}`;

export const collectionsApi: CollectionsApi = {
  load: () => fetcher(COLLECTIONS_KEY, collectionsSchema),
  create: (name, keys) =>
    resultFetcher(
      COLLECTIONS_KEY,
      collectionsSchema,
      json("POST", { name, keys } satisfies CreateCollectionRequest),
    ),
  rename: (id, name) =>
    resultFetcher(
      collectionUrl(id),
      collectionsSchema,
      json("PATCH", { name } satisfies RenameCollectionRequest),
    ),
  remove: (id) => resultFetcher(collectionUrl(id), collectionsSchema, { method: "DELETE" }),
  setItems: (id, keys, member) =>
    resultFetcher(
      `${collectionUrl(id)}/items`,
      collectionsSchema,
      json("PUT", { keys, member } satisfies SetCollectionItemsRequest),
    ),
};
