import { Bytes, CBOR, CID, CidLink, TID } from "./_deps.ts";
import { RepoStorage } from "./db/repo_storage.ts";
import { Did } from "./did.ts";
import { collectMSTKeys, generateMST } from "./mst.ts";

import { P256PrivateKeyExportable, Secp256k1PrivateKeyExportable } from "@atcute/crypto";

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

export class Repository {
  constructor(
    public storage: RepoStorage,
    public keypair: P256PrivateKeyExportable | Secp256k1PrivateKeyExportable,
  ) {}

  read(root: CID.Cid): Map<string, CID.Cid> {
    const map = new Map();
    collectMSTKeys(this.storage, root, map);
    return map;
  }

  async #storeRecord(record: unknown) {
    const data = CBOR.encode(record);
    const cid = await CID.create(0x71, data);
    this.storage.putBlock(cid, data);
    return cid;
  }

  async #updateMST(
    oldRoot: CID.Cid,
    mutations: RepoMutation[],
  ): Promise<{ root: CidLink; leaves: CID.Cid[]; pruned: CID.Cid[] }> {
    const leaves = [];
    const pruned = [];

    const map = this.read(oldRoot);
    for (const m of mutations) {
      switch (m.type) {
        case "create": {
          const cid = await this.#storeRecord(m.record);
          map.set(`${m.collection}/${m.rkey}`, cid);
          leaves.push(cid);
          break;
        }
        case "update": {
          const existingCid = map.get(`${m.collection}/${m.rkey}`);
          if (existingCid) pruned.push(existingCid);

          const cid = await this.#storeRecord(m.record);
          map.set(`${m.collection}/${m.rkey}`, cid);
          leaves.push(cid);
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
    const root = await generateMST(this.storage, map);
    return { leaves, pruned, root };
  }

  async #writeCommit(newRoot: CidLink, lastCommit?: CommitNode): Promise<CID.Cid> {
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
    const cid = await CID.create(113, data);
    this.storage.putBlock(cid, data, 2);
    this.storage.setCommit(cid);
    return cid;
  }

  async mutate(mutations: RepoMutation[]) {
    const lastCommitCid = this.storage.getCommit();
    if (!lastCommitCid) throw new Error("tried to mutate repo that had no initial commit");

    const lastCommit = this.storage
      .getBlock(lastCommitCid)
      ?.$pipe(CBOR.decode) as SignedCommitNode;
    const { root, leaves, pruned } = await this.#updateMST(lastCommit.data.toCid(), mutations);
    await this.#writeCommit(root, lastCommit);

    // gc
    this.storage.deleteBlock(lastCommitCid);
    for (const cid of pruned) this.storage.deleteBlock(cid);

    // TODO: emit commit on event stream
  }
}
