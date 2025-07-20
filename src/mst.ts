import { encodeUtf8 } from "@atcute/uint8array";
import { createHash } from "node:crypto";
import { assert, Bytes, CBOR, CidLink } from "./_deps.ts";
import { Cid, createCid } from "./cid.ts";
import { RepoStorage } from "./db/repo_storage.ts";

interface Node {
  height: number;
  left?: Node;
  entries: Entry[];
}

interface Entry {
  height: number;
  key: Uint8Array;
  val: CidLink;
  right?: Node;
}

interface MSTEntry {
  p: number;
  k: CBOR.Bytes;
  v: CidLink;
  t: CidLink | null;
}

interface MSTNode {
  l: CidLink | null;
  e: MSTEntry[];
}

function sha256LeadingZeros(s: string) {
  const hash = createHash("sha256");
  hash.update(s);
  const sha256 = new Uint8Array(hash.digest());
  let c = 0;
  for (let i = 0; i < sha256.length; i++) {
    const b = sha256[i];
    if (b < 64) c++;
    if (b < 16) c++;
    if (b < 4) c++;
    if (b === 0) {
      c++;
    } else {
      break;
    }
  }
  return c;
}

function insertEntry(node: Node, entry: Entry): Node {
  // ascend if needed
  while (entry.height > node.height) {
    node = {
      height: node.height + 1,
      left: node,
      entries: [],
    };
  }

  // descend if needed
  if (entry.height < node.height) {
    if (node.entries.length === 0) {
      if (node.left) {
        node.left = insertEntry(node.left, entry);
        return node;
      } else {
        throw new Error("hit existing, totally-empty MST node");
      }
    }

    // node.entries is nonempty so last is never nullable
    const last = node.entries.pop()!;

    if (last.right) {
      last.right = insertEntry(last.right, entry);
    } else {
      let newNode: Node = {
        height: entry.height,
        left: undefined,
        entries: [entry],
      };
      while (newNode.height + 1 < node.height) {
        newNode = {
          height: newNode.height + 1,
          left: newNode,
          entries: [],
        };
      }
      last.right = newNode;
    }

    node.entries.push(last);
    return node;
  }

  // same height, so append
  assert(node.height === entry.height);
  if (node.entries.length !== 0) {
    const last = node.entries.at(-1)!;
    assert(entry.key > last.key);
  }
  node.entries.push(entry);
  return node;
}

export function generateMST(
  repo: RepoStorage,
  map: Map<string, Cid>,
  newBlocks?: Cid[],
): CidLink {
  let root: Node | undefined;
  for (const [key, val] of map.entries()) {
    const keyBytes = encodeUtf8(key);
    const height = sha256LeadingZeros(key);
    const entry: Entry = {
      height,
      key: keyBytes,
      val: CidLink.fromCid(val),
      right: undefined,
    };

    if (root) {
      root = insertEntry(root, entry);
    } else {
      root = {
        height: entry.height,
        left: undefined,
        entries: [entry],
      };
    }
  }
  const emptyNode: Node = {
    height: 0,
    left: undefined,
    entries: [],
  };
  return finalizeTree(repo, root ?? emptyNode, newBlocks);
}

function commonPrefixLen(a: Uint8Array, b: Uint8Array) {
  let i = 0;
  for (; i < a.length && i < b.length; i++) {
    if (a[i] !== b[i]) return i;
  }
  return i;
}

function finalizeTree(repo: RepoStorage, node: Node, newBlocks?: Cid[]): CidLink {
  const left = node.left?.$pipe(n => finalizeTree(repo, n, newBlocks));

  const mstEntries: MSTEntry[] = [];
  let lastKey: Uint8Array = new Uint8Array();
  for (const entry of node.entries) {
    const right = entry.right?.$pipe(n => finalizeTree(repo, n, newBlocks));
    const prefixLen = commonPrefixLen(lastKey, entry.key);
    mstEntries.push({
      k: new Bytes(entry.key.subarray(prefixLen)),
      p: prefixLen,
      v: entry.val,
      t: right ?? null,
    });
    lastKey = entry.key;
  }

  const mstNode: MSTNode = {
    l: left ?? null,
    e: mstEntries,
  };

  const data = CBOR.encode(mstNode);
  const cid = createCid(0x71, data);
  if (repo.putBlock(cid, data, 1)) newBlocks?.push(cid);

  return CidLink.fromCid(cid);
}

export function collectMSTKeys(repo: RepoStorage, cid: Cid, map: Map<string, Cid>): void {
  const node: MSTNode | undefined = repo.getBlock(cid)?.$pipe(CBOR.decode);
  if (!node) return;
  if (node.l) {
    collectMSTKeys(repo, node.l.toCid(), map);
  }
  let key = "";
  for (const entry of node.e) {
    const prefix = key.substring(0, entry.p);
    key = prefix + entry.k;
    map.set(key, entry.v.toCid());
    if (entry.t) collectMSTKeys(repo, entry.t.toCid(), map);
  }
}
