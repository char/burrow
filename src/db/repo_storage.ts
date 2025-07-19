import { Database } from "@db/sqlite";
import { CID, fs, path } from "../_deps.ts";
import { appConfig } from "../config.ts";
import { Did } from "../did.ts";

export interface RepoStorage {
  did: Did;
  db: Database;

  getBlock: (cid: CID.Cid) => Uint8Array | undefined;
  putBlock: (cid: CID.Cid, data: Uint8Array, ephemeral?: number) => boolean;
  deleteBlock: (cid: CID.Cid) => void;
  clearEphemeralBlocks: () => void;

  getCommit: () => CID.Cid | undefined;
  setCommit: (cid: CID.Cid) => void;
}

export async function openRepoDatabase(did: Did): Promise<RepoStorage> {
  // TODO: repo pool so we don't have to keep opening repo dbs in-flight

  await fs.ensureDir(path.join(appConfig.dataDir, "repos"));
  const db = new Database(path.join(appConfig.dataDir, "repos", did + ".db"));
  db.exec(`pragma journal_mode = WAL;`);
  db.exec(`pragma synchronous = NORMAL;`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS blobs (
      cid TEXT NOT NULL UNIQUE,
      mime TEXT NOT NULL,
      refs INTEGER NOT NULL DEFAULT 0,
      data BLOB
    ) STRICT;
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

  return {
    did,
    db,

    getBlock: cid => getBlockStatement.get<{ block: Uint8Array }>(CID.toString(cid))?.block,
    putBlock: (cid, data, ephemeral = 0) =>
      putBlockStatement.run(CID.toString(cid), data, ephemeral) !== 0,
    deleteBlock: cid => void deleteBlockStatement.run(CID.toString(cid)),
    clearEphemeralBlocks: () => void db.run(`DELETE FROM blocks WHERE ephemeral = 1`),

    getCommit: () => getCommitStatement.get<{ cid: string }>()?.cid?.$pipe(CID.fromString),
    setCommit: cid => void setCommitStatement.run(CID.toString(cid)),
  };
}
