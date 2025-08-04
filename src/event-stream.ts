import { concat } from "@atcute/uint8array";
import { Database } from "@db/sqlite";
import { assert, Bytes, CBOR, CidLink, path } from "./_deps.ts";
import { appConfig } from "./config.ts";
import { Did } from "./util/did.ts";

interface RepoOp {
  action: "create" | "update" | "delete";
  path: string;
  cid: CidLink;
  prev?: CidLink;
}

interface CommitEvent {
  header: { op: 1; t: "#commit" };
  payload: {
    rebase: false;
    tooBig: false;
    repo: Did;
    commit: CidLink;
    rev: string;
    since: string | null;
    blocks: Bytes;
    ops: RepoOp[]; // max 200
    blobs: [];
    prevData: CidLink;
    time: string; // iso time string
  };
}

interface SyncEvent {
  header: { op: 1; t: "#sync" };
  payload: {
    did: Did;
    blocks: Bytes;
    rev: string;
    time: string;
  };
}

interface AccountEvent {
  header: { op: 1; t: "#account" };
  payload: {
    did: Did;
    time: string;
    active: boolean;
    status?:
      | "takendown"
      | "suspended"
      | "deleted"
      | "deactivated"
      | "desynchronized"
      | "throttled";
  };
}

export type RepoSyncEvent = CommitEvent | SyncEvent | AccountEvent;

const db = new Database(path.join(appConfig.dataDir, "event_sequence.db"));
db.exec(`pragma journal_mode = WAL;`);
db.exec(`pragma synchronous = NORMAL;`);
db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    seq INTEGER NOT NULL PRIMARY KEY,
    did TEXT,
    event BLOB NOT NULL
  ) STRICT;
`);
const insertEvent = db.prepare("INSERT INTO events (did, event) VALUES (?, ?)").$pipe(stmt => {
  return (did: Did | null, event: RepoSyncEvent) => {
    stmt.run(did, CBOR.encode(event));
    const seq = db.lastInsertRowId;
    return seq;
  };
});
const getLatestSeq = db
  .prepare("SELECT seq FROM events ORDER BY seq DESC LIMIT 1")
  .$pipe(stmt => () => stmt.get<{ seq: number }>()?.seq ?? 0);

const subscribers = new Set<{ status: "backfill" | "live"; ws: WebSocket }>();

export function broadcastSyncEvent(did: Did | undefined, event: RepoSyncEvent) {
  const seq = insertEvent(did ?? null, event);
  const headerBytes = CBOR.encode(event.header);
  const payloadBytes = CBOR.encode({ ...event.payload, seq });
  const eventBytes = concat([headerBytes, payloadBytes]);

  for (const subscriber of subscribers) {
    if (subscriber.status !== "live") continue;

    try {
      subscriber.ws.send(eventBytes);
    } catch {
      subscribers.delete(subscriber);
    }
  }
}

export function subscribe(ws: WebSocket, cursor: number | undefined) {
  assert(ws.binaryType === "arraybuffer");
  type SetT<S> = S extends Set<infer T> ? T : never;
  const subscriber: SetT<typeof subscribers> = {
    status: cursor !== undefined ? "backfill" : "live",
    ws,
  };
  subscribers.add(subscriber);

  /* TODO: backfill if we need to
  if (cursor !== undefined) {
    let fromSeq = cursor;
    let toSeq: number;
    do {
      toSeq = getLatestSeq();

      // TODO: get events from db and send them over the wire

      fromSeq = toSeq;
    } while (toSeq < getLatestSeq());
    subscriber.status = "live";
  } */
}
