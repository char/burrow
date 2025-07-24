import { P256PrivateKey, Secp256k1PrivateKey } from "@atcute/crypto";
import { assert, Bytes, CBOR, CidLink, TID } from "./_deps.ts";
import { mainDb } from "./db/main_db.ts";
import { openRepoDatabase, RepoStorage } from "./db/repo_storage.ts";
import { collectMSTKeys, generateMST } from "./mst.ts";
import { Cid, createCid } from "./util/cid.ts";
import { Did } from "./util/did.ts";

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

export type RepoMutation =
  | { type: "create"; collection: string; rkey: string; record: unknown }
  | { type: "update"; collection: string; rkey: string; record: unknown }
  | { type: "delete"; collection: string; rkey: string };

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

  async #writeCommit(newRoot: CidLink, lastCommit?: CommitNode): Promise<Cid> {
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
    return cid;
  }

  async initialCommit() {
    assert(this.storage.getCommit() === undefined);
    const root = generateMST(this.storage, new Map());
    const _commit = await this.#writeCommit(root);
  }

  async mutate(mutations: RepoMutation[]) {
    const lastCommitCid = this.storage.getCommit();
    if (!lastCommitCid) throw new Error("tried to mutate repo that had no initial commit");

    const lastCommit = this.storage
      .getBlock(lastCommitCid)
      ?.$pipe(CBOR.decode) as SignedCommitNode;

    const spawned: Cid[] = [];
    const pruned: Cid[] = [];

    const map = this.#readCidMap();
    for (const m of mutations) {
      switch (m.type) {
        case "create": {
          const cid = this.#storeRecord(m.record);
          map.set(`${m.collection}/${m.rkey}`, cid);
          spawned.push(cid);
          break;
        }
        case "update": {
          const existingCid = map.get(`${m.collection}/${m.rkey}`);
          if (existingCid) pruned.push(existingCid);

          const cid = this.#storeRecord(m.record);
          map.set(`${m.collection}/${m.rkey}`, cid);
          spawned.push(cid);
          break;
        }
        case "delete": {
          const cid = map.get(`${m.collection}/${m.rkey}`);
          if (cid) {
            map.delete(`${m.collection}/${m.rkey}`);
            pruned.push(cid);
          }
          break;
        }
      }
    }

    this.storage.clearEphemeralBlocks();
    const root = generateMST(this.storage, map, spawned);
    const commitCid = await this.#writeCommit(root, lastCommit);
    spawned.push(commitCid);

    this.#lastCommitCid = commitCid;
    this.#lastCidMap = map;

    // gc pruned blocks
    this.storage.deleteBlock(lastCommitCid);
    for (const cid of pruned) this.storage.deleteBlock(cid);

    // TODO: emit commit on event stream using spawnlist as blocks
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
}

const repoPool = new Map<Did, Repository>();
export async function openRepository(did: Did): Promise<Repository> {
  const open = repoPool.get(did);
  if (open) return open;

  const db = await openRepoDatabase(did);
  const signingKey = await mainDb.getSigningKey(did);
  if (!signingKey) throw new Error("no signing key for did: " + did);

  const repo = new Repository(db, signingKey);
  repoPool.set(did, repo);
  return repo;
}
