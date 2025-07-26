import { Database } from "@db/sqlite";
import { fs, path } from "../_deps.ts";
import { appConfig } from "../config.ts";
import { Cid, cidToString, encodeCidFromDigest } from "../util/cid.ts";
import { Did } from "../util/did.ts";
import { toArrayBuffer } from "jsr:@std/streams@1/to-array-buffer";

export interface RepoStorage {
  did: Did;
  db: Database;

  getBlock: (cid: Cid) => Uint8Array | undefined;
  putBlock: (cid: Cid, data: Uint8Array, ephemeral?: number) => boolean;
  deleteBlock: (cid: Cid) => void;
  clearEphemeralBlocks: () => void;

  getCommit: () => Cid | undefined;
  setCommit: (cid: Cid) => void;

  listBlobs: (limit: number, cursor?: string) => Cid[];
  createBlob: (cid: Cid | null, mime: string) => number | undefined;
  writeBlob: (id: number, data: ReadableStream) => Promise<[cid: Cid, size: number]>;
}

export async function openRepoDatabase(did: Did): Promise<RepoStorage> {
  await fs.ensureDir(path.join(appConfig.dataDir, "repos"));
  const db = new Database(path.join(appConfig.dataDir, "repos", did + ".db"));
  db.exec(`pragma journal_mode = WAL;`);
  db.exec(`pragma synchronous = NORMAL;`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS blobs (
      rowid INTEGER NOT NULL PRIMARY KEY,
      cid TEXT,
      mime TEXT NOT NULL,
      refs INTEGER NOT NULL DEFAULT 0,
      data BLOB
    ) STRICT;
    CREATE INDEX IF NOT EXISTS blob_cid ON blobs (cid);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS blob_refs (
      collection TEXT NOT NULL,
      rkey TEXT NOT NULL,
      blob_id INTEGER NOT NULL
    ) STRICT;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS blocks (
      cid TEXT NOT NULL UNIQUE,
      block BLOB NOT NULL,
      ephemeral INTEGER DEFAULT 0
    ) STRICT;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS block_aliases (
      name TEXT NOT NULL UNIQUE,
      cid TEXT NOT NULL UNIQUE
    ) STRICT;
  `);

  const getBlockStatement = db.prepare("SELECT block FROM blocks WHERE cid = ?");
  const putBlockStatement = db.prepare(
    "INSERT OR IGNORE INTO blocks (cid, block, ephemeral) VALUES (?, ?, ?)",
  );
  const deleteBlockStatement = db.prepare("DELETE FROM blocks WHERE cid = ?");

  const getCommitStatement = db.prepare("SELECT cid FROM block_aliases WHERE name = 'commit'");
  const setCommitStatement = db.prepare(
    "INSERT OR REPLACE INTO block_aliases (name, cid) VALUES ('commit', ?)",
  );

  const listBlobsStatement = db.prepare(
    "SELECT cid FROM blobs WHERE cid IS NOT NULL AND refs > 0 AND cid > ? ORDER BY cid ASC LIMIT ?",
  );
  const putBlobStatement = db.prepare(
    "INSERT OR IGNORE INTO blobs (cid, mime) VALUES (?, ?) RETURNING rowid",
  );
  const updateBlobCidStatement = db.prepare("UPDATE blobs SET cid = ? WHERE rowid = ?");

  return {
    did,
    db,

    getBlock: cid => getBlockStatement.get<{ block: Uint8Array }>(cid)?.block,
    putBlock: (cid, data, ephemeral = 0) => putBlockStatement.run(cid, data, ephemeral) !== 0,
    deleteBlock: cid => void deleteBlockStatement.run(cid),
    clearEphemeralBlocks: () => void db.run(`DELETE FROM blocks WHERE ephemeral = 1`),

    getCommit: () => getCommitStatement.get<{ cid: string }>()?.cid as Cid | undefined,
    setCommit: cid => void setCommitStatement.run(cid),

    listBlobs: (limit, cursor) =>
      listBlobsStatement.all<{ cid: Cid }>(cursor ?? "", limit).map(it => it.cid),
    createBlob: (cid, mime) => putBlobStatement.get<{ rowid: number }>(cid, mime)?.rowid,
    writeBlob: async (blobId, data: ReadableStream) => {
      const blob = db.openBlob({
        table: "blobs",
        row: blobId,
        column: "data",
        readonly: false,
      });
      await data.pipeTo(blob.writable);

      const size = blob.byteLength;
      const hash = await crypto.subtle.digest("SHA-256", await toArrayBuffer(blob.readable));
      const cid = cidToString(encodeCidFromDigest(0x55, new Uint8Array(hash)));
      void updateBlobCidStatement.run(blobId, cid);
      blob.close();

      return [cid, size];
    },
  };
}
