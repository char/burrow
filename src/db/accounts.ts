import { Database } from "@db/sqlite";
import { j, path } from "../_deps.ts";
import { appConfig } from "../config.ts";
import { Did } from "../did.ts";

const db = new Database(path.join(appConfig.dataDir, "accounts.db"));
db.exec(`pragma journal_mode = WAL;`);
db.exec(`pragma synchronous = NORMAL;`);
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER NOT NULL PRIMARY KEY,
    did TEXT NOT NULL UNIQUE,
    handle TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash BLOB NOT NULL,
    -- no email_confirmed_at because all emails are confirmed
    deactivated_at INTEGER,
    signing_key BLOB NOT NULL,
    signing_key_type TEXT NOT NULL
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
  return (did: Did) => {
    const row = stmt.get(did);
    if (row === null) return undefined;
    const { value } = parseAccount(row);
    return value;
  };
});

import { P256PrivateKey, Secp256k1PrivateKey } from "@atcute/crypto";
import { scryptAsync } from "@noble/hashes/scrypt";
import { RepoSigningKey } from "../repo.ts";

const createAccount = db
  .prepare(
    `INSERT INTO accounts
    (did, handle, email, password_hash, signing_key, signing_key_type)
    VALUES (?, ?, ?, ?, ?, ?)`,
  )
  .$pipe(stmt => {
    return async (
      did: Did,
      handle: string,
      email: string,
      password: string,
      signingKey: RepoSigningKey,
    ) => {
      stmt.run(
        did,
        handle,
        email,
        await scryptAsync(password, did, { N: 2 ** 16, r: 8, p: 1 }),
        // @ts-expect-error internal access
        signingKey._privateKey,
        signingKey.type,
      );
    };
  });

const getSigningKey = db
  .prepare(`SELECT signing_key, signing_key_type FROM accounts WHERE did = ?`)
  .$pipe(
    stmt =>
      async (did: Did): Promise<RepoSigningKey | undefined> =>
        await stmt
          .get<{ signing_key: Uint8Array; signing_key_type: string }>(did)
          ?.$pipe(it => {
            if (it.signing_key_type === "secp256k1") {
              return Secp256k1PrivateKey.importRaw(it.signing_key);
            }
            if (it.signing_key_type === "p256") {
              return P256PrivateKey.importRaw(it.signing_key);
            }
            throw new Error("unknown key type");
          }),
  );

export const accountsDb = { db, getAccount, createAccount, getSigningKey };
