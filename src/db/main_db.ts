import { Database } from "@db/sqlite";
import { j, path } from "../_deps.ts";
import { appConfig } from "../config.ts";
import { Did, DidSchema } from "../util/did.ts";

const db = new Database(path.join(appConfig.dataDir, "main.db"));
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
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_pars (
    uri TEXT NOT NULL,
    request TEXT NOT NULL, -- json
    expires_at INTEGER NOT NULL
  ) STRICT;
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_codes (
    code TEXT NOT NULL UNIQUE,
    authorized_at INTEGER DEFAULT NULL,
    authorized_by TEXT DEFAULT NULL,
    request TEXT NOT NULL, -- json
    request_uri TEXT NOT NULL UNIQUE
  ) STRICT;
`);

const AccountModel = j.obj({
  id: j.number,
  did: DidSchema,
  handle: j.string,
  email: j.string,
  password_hash: j.custom(v => v instanceof Uint8Array, "must be Uint8Array"),
  deactivated_at: j.union(j.literal(null), j.number),
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

const compareConstant = (a: Uint8Array, b: Uint8Array) => {
  // i dont think we can really guarantee that this is constant time in just js but
  // as a best-effort thing we will loop over the whole array regardless

  let allEqual = true;
  for (let i = 0; i < a.length && i < b.length; i++) {
    const aByte = a[i];
    const bByte = b[i];
    if (aByte !== bByte) allEqual = false;
  }
  return allEqual;
};

const verifyHash = async (did: Did, password: string, passwordHash: Uint8Array) => {
  return compareConstant(
    await scryptAsync(password, did, { N: 2 ** 16, r: 8, p: 1 }),
    passwordHash,
  );
};

const getSigningKey = db
  .prepare(`SELECT signing_key, signing_key_type FROM accounts WHERE did = ?`)
  .$pipe(stmt => {
    return async (did: Did): Promise<RepoSigningKey | undefined> =>
      await stmt.get<{ signing_key: Uint8Array; signing_key_type: string }>(did)?.$pipe(it => {
        if (it.signing_key_type === "secp256k1") {
          return Secp256k1PrivateKey.importRaw(it.signing_key);
        }
        if (it.signing_key_type === "p256") {
          return P256PrivateKey.importRaw(it.signing_key);
        }
        throw new Error("unknown key type");
      });
  });

const insertOAuthRequest = db
  .prepare("INSERT INTO oauth_pars (uri, request, expires_at) VALUES (?, ?, ?)")
  .$pipe(stmt => {
    return (uri: string, request: object, expiresAt: number) => {
      stmt.run(uri, JSON.stringify(request), expiresAt);
    };
  });

const getOAuthRequest = db
  .prepare("SELECT request FROM oauth_pars WHERE uri = ? AND expires_at >= ?")
  .$pipe(stmt => {
    return (uri: string) => {
      const result = stmt.get<{ request: string }>(uri, Date.now());
      if (!result) return undefined;
      return JSON.parse(result.request) as object;
    };
  });

const lookupLocalDid = db.prepare("SELECT did FROM accounts WHERE handle = ?").$pipe(stmt => {
  return (handle: string) => {
    const result = stmt.get<{ did: Did }>(handle);
    return result?.did;
  };
});

const insertOAuthCode = db
  .prepare(
    `INSERT OR IGNORE INTO oauth_codes
    (code, request, request_uri)
    VALUES (?, ?, ?)`,
  )
  .$pipe(stmt => {
    return (code: string, request: object, requestUri: string) =>
      void stmt.run(code, JSON.stringify(request), requestUri);
  });

const activateOAuthCode = db
  .prepare("UPDATE oauth_codes SET authorized_at = ?, authorized_by = ? WHERE code = ?")
  .$pipe(stmt => {
    return (code: string, who: Did) => void stmt.run(Date.now(), who, code);
  });

const retrieveOAuthCode = db.prepare("SELECT * FROM oauth_codes WHERE code = ?").$pipe(stmt => {
  return (code: string) => {
    const result = stmt.get<{
      code: string;
      authorized_at: number;
      authorized_by: Did | undefined;
      request: string;
    }>(code);
    if (!result) return undefined;
    const request = JSON.parse(result.request) as object;
    return { ...result, request };
  };
});

export const mainDb = {
  db,
  getAccount,
  createAccount,
  getSigningKey,
  insertOAuthRequest,
  getOAuthRequest,
  lookupLocalDid,
  verifyHash,
  insertOAuthCode,
  activateOAuthCode,
  retrieveOAuthCode,
};
