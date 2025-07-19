import { Database } from "@db/sqlite";
import { CID, fs, path } from "../_deps.ts";
import { appConfig } from "../config.ts";
import { Did } from "../did.ts";

export interface RepoStorage {
  did: Did;
  db: Database;

  putBlock: (cid: CID.Cid, data: Uint8Array, ephemeral?: boolean) => void;
}

export async function openRepoDatabase(did: Did): Promise<RepoStorage> {
  // TODO: repo pool so we don't have to keep opening repo dbs in-flight

  await fs.ensureDir(path.join(appConfig.dataDir, "repos"));
  const db = new Database(path.join(appConfig.dataDir, "repos", did + ".db"));
  db.exec(`pragma journal_mode = WAL;`);
  db.exec(`pragma synchronous = NORMAL;`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS blobs (
      id INTEGER PRIMARY KEY NOT NULL,
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
      id INTEGER PRIMARY KEY NOT NULL,
      cid TEXT NOT NULL UNIQUE,
      block BLOB NOT NULL,
      ephemeral INTEGER DEFAULT 0
    ) STRICT;
  `);

  const putBlockStatement = db.prepare(
    "INSERT OR REPLACE INTO blocks (cid, block, ephemeral) VALUES (?, ?, ?)",
  );

  // TODO: repo mutations (e.g. create record, update record, delete record)

  return {
    did,
    db,
    putBlock: (cid, data, ephemeral = false) => {
      putBlockStatement.run(CID.toString(cid), data, ephemeral);
    },
  };
}
