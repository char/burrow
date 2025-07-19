import { Database } from "@db/sqlite";
import { j, path } from "../_deps.ts";
import { appConfig } from "../config.ts";

const db = new Database(path.join(appConfig.dataDir, "accounts.db"));
db.exec(`pragma journal_mode = WAL;`);
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER NOT NULL PRIMARY KEY,
    did TEXT NOT NULL UNIQUE,
    handle TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    -- no email_confirmed_at because all emails are confirmed
    deactivated_at INTEGER
  ) STRICT;
`);

const AccountModel = j.obj({
  id: j.number,
  did: j.string,
  handle: j.string,
  email: j.string,
  password_hash: j.string,
  deactivated_at: j.number,
});
const parseAccount = j.compile(AccountModel);

const getAccount = db.prepare("SELECT * FROM accounts WHERE did = ?").$pipe(stmt => {
  return (did: string) => {
    const row = stmt.get(did);
    if (row === null) return undefined;
    const { value } = parseAccount(row);
    return value;
  };
});

export const accountsDb = { db, getAccount };
