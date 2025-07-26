import { P256PrivateKey, Secp256k1PrivateKey } from "@atcute/crypto";
import { assert, Bytes, CBOR, CidLink, j, TID } from "./_deps.ts";
import { mainDb } from "./db/main_db.ts";
import { openRepoDatabase, RepoStorage } from "./db/repo_storage.ts";
import { collectMSTKeys, generateMST } from "./mst.ts";
import { Cid, createCid } from "./util/cid.ts";
import { Did } from "./util/did.ts";
import { atUri, AtUri } from "./util/at-uri.ts";
import { XRPCError } from "./xrpc-server.ts";

interface CommitNode {
  did: Did;
  version: number; // 3
  data: CidLink;
  rev: string;
  prev: CidLink | null; // usually null
}

interface SignedCommitNode extends CommitNode {
  sig: Bytes;
}

export const RepoWriteSchema = j.discriminatedUnion("$type", [
  j.obj({
    $type: j.literal("com.atproto.repo.applyWrites#create"),
    collection: j.string,
    rkey: j.optional(j.string),
    value: j.unknown,
  }),
  j.obj({
    $type: j.literal("com.atproto.repo.applyWrites#update"),
    collection: j.string,
    rkey: j.string,
    value: j.unknown,
  }),
  j.obj({
    $type: j.literal("com.atproto.repo.applyWrites#delete"),
    collection: j.string,
    rkey: j.string,
  }),
]);
export type RepoWrite = j.Infer<typeof RepoWriteSchema>;
export type RepoWriteResults = {
  repoEffects: { spawned: Cid[]; purged: Cid[] };
  commit: { cid: Cid; rev: string };
  results: (
    | {
        $type: `com.atproto.repo.applyWrites#${"createResult" | "updateResult"}`;
        uri: AtUri;
        cid: Cid;
      }
    | { $type: `com.atproto.repo.applyWrites#deleteResult` }
  )[];
};

export type RepoSigningKey = P256PrivateKey | Secp256k1PrivateKey;

export class Repository {
  constructor(
    public storage: RepoStorage,
    public keypair: RepoSigningKey,
  ) {}

  #lastCommitCid: Cid | undefined;
  #lastCidMap: Map<string, Cid> = new Map();

  #readCidMap(): Map<string, Cid> {
    const commitCid = this.storage.getCommit();
    if (commitCid === undefined) return new Map();
    if (this.#lastCommitCid === commitCid) {
      return new Map(this.#lastCidMap);
    }

    const commitNode: CommitNode | undefined = this.storage
      .getBlock(commitCid)
      ?.$pipe(CBOR.decode);
    if (!commitNode) throw new Error("commit node not found");

    const map = new Map();
    collectMSTKeys(this.storage, commitNode.data.toCid(), map);

    this.#lastCommitCid = commitCid;
    this.#lastCidMap = map;

    return new Map(map);
  }

  #storeRecord(record: unknown) {
    const data = CBOR.encode(record);
    const cid = createCid(0x71, data);
    this.storage.putBlock(cid, data);
    return cid;
  }

  async #writeCommit(
    newRoot: CidLink,
    lastCommit?: CommitNode,
  ): Promise<[Cid, SignedCommitNode]> {
    const commit: CommitNode = {
      version: 3,
      did: this.storage.did,
      prev: null,
      rev:
        lastCommit?.rev.$pipe(TID.parse).$pipe(t => TID.create(t.timestamp + 1, t.clockid)) ??
        TID.now(),
      data: newRoot,
    };
    const signedCommit: SignedCommitNode = {
      ...commit,
      sig: new Bytes(await this.keypair.sign(CBOR.encode(commit))),
    };
    const data = CBOR.encode(signedCommit);
    const cid = createCid(0x71, data);
    this.storage.putBlock(cid, data, 2);
    this.storage.setCommit(cid);
    return [cid, signedCommit];
  }

  async initialCommit() {
    assert(this.storage.getCommit() === undefined);
    const root = generateMST(this.storage, new Map());
    const _commit = await this.#writeCommit(root);
  }

  async write(writes: RepoWrite[], swapCommit?: Cid): Promise<RepoWriteResults> {
    const lastCommitCid = this.storage.getCommit();
    if (!lastCommitCid) throw new Error("tried to mutate repo that had no initial commit");

    if (swapCommit && lastCommitCid !== swapCommit)
      throw new XRPCError("InvalidSwap", `Commit was at ${lastCommitCid ?? "null"}`);

    const lastCommit = this.storage
      .getBlock(lastCommitCid)
      ?.$pipe(CBOR.decode) as SignedCommitNode;

    const results: RepoWriteResults["results"] = [];
    const spawned: Cid[] = [];
    const purged: Cid[] = [];

    const map = this.#readCidMap();
    for (const w of writes) {
      switch (w.$type) {
        case "com.atproto.repo.applyWrites#create": {
          const rkey = w.rkey ?? TID.now();
          const uri = atUri`${this.storage.did}/${w.collection}/${rkey}`;

          const existingCid = map.get(`${w.collection}/${rkey}`);
          if (existingCid)
            throw new XRPCError("InvalidSwap", `Record was at ${existingCid}`, { uri });

          const cid = this.#storeRecord(w.value);
          map.set(`${w.collection}/${rkey}`, cid);
          spawned.push(cid);
          results.push({
            $type: "com.atproto.repo.applyWrites#createResult",
            uri,
            cid,
          });
          break;
        }
        case "com.atproto.repo.applyWrites#update": {
          const uri = atUri`${this.storage.did}/${w.collection}/${w.rkey}`;

          const existingCid = map.get(`${w.collection}/${w.rkey}`);
          if (!existingCid) throw new XRPCError("InvalidSwap", `Record was at null`, { uri });
          purged.push(existingCid);

          const cid = this.#storeRecord(w.value);
          map.set(`${w.collection}/${w.rkey}`, cid);
          spawned.push(cid);
          results.push({
            $type: "com.atproto.repo.applyWrites#updateResult",
            uri,
            cid,
          });
          break;
        }
        case "com.atproto.repo.applyWrites#delete": {
          const uri = atUri`${this.storage.did}/${w.collection}/${w.rkey}`;

          const cid = map.get(`${w.collection}/${w.rkey}`);
          if (!cid) throw new XRPCError("InvalidSwap", `Record was at null`, { uri });

          map.delete(`${w.collection}/${w.rkey}`);
          purged.push(cid);
          results.push({
            $type: "com.atproto.repo.applyWrites#deleteResult",
          });
          break;
        }
      }
    }

    this.storage.clearEphemeralBlocks();
    const root = generateMST(this.storage, map, spawned);
    const [commitCid, commit] = await this.#writeCommit(root, lastCommit);
    spawned.push(commitCid);

    this.#lastCommitCid = commitCid;
    this.#lastCidMap = map;

    // gc pruned blocks
    this.storage.deleteBlock(lastCommitCid);
    for (const cid of purged) this.storage.deleteBlock(cid);

    // TODO: emit commit on event stream using spawnlist as blocks ?

    return {
      commit: { cid: commitCid, rev: commit.rev },
      repoEffects: { spawned, purged },
      results,
    };
  }

  getRecordCid(collection: string, rkey: string): Cid | undefined {
    const map = this.#readCidMap();
    return map.get(`${collection}/${rkey}`);
  }

  getRecord(collection: string, rkey: string): object | undefined {
    const map = this.#readCidMap();
    const recordCid = map.get(`${collection}/${rkey}`);
    return recordCid?.$pipe(this.storage.getBlock)?.$pipe(CBOR.decode);
  }

  getCurrCommit(): CommitNode | undefined {
    const cid = this.storage.getCommit();
    if (!cid) return undefined;
    const node = this.storage.getBlock(cid)!.$pipe(CBOR.decode) as SignedCommitNode;
    return node;
  }

  listCollections(): string[] {
    const map = this.#readCidMap();
    const collections = new Set(
      map
        .keys()
        .map(it => it.split("/").at(0))
        .filter(it => it !== undefined),
    );
    return Array.from(collections);
  }

  listRecords(collection: string): { uri: AtUri; cid: Cid; value: unknown }[] {
    const map = this.#readCidMap();

    const records = [];
    for (const [key, cid] of map.entries()) {
      if (!key.startsWith(collection + "/")) continue;
      const [rcoll, ...rkey] = key.split("/");
      const block = this.storage.getBlock(cid);
      if (!block) continue;
      records.push({
        uri: atUri`${this.storage.did}/${rcoll}/${rkey.join("/")}`,
        cid,
        value: CBOR.decode(block),
      });
    }

    records.reverse();
    return records;
  }
}

const repoPool = new Map<Did, Repository>();
export async function openRepository(did: Did): Promise<Repository> {
  const open = repoPool.get(did);
  if (open) return open;

  const signingKey = await mainDb.getSigningKey(did);
  if (!signingKey) throw new Error("no signing key for did: " + did);
  const db = await openRepoDatabase(did);

  const repo = new Repository(db, signingKey);
  repoPool.set(did, repo);
  return repo;
}
