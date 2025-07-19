import { encodeUtf8 } from "@atcute/uint8array";
import { createHash } from "node:crypto";
import { assert, Bytes, CBOR, CID, CidLink } from "./_deps.ts";
import { RepoStorage } from "./db/repo.ts";

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

export async function generateMST(repo: RepoStorage, map: Map<string, CID.Cid>) {
  let root: Node | undefined;
  for (const [key, val] of map.entries()) {
    const keyBytes = encodeUtf8(key);
    const height = sha256LeadingZeros(key);
    const entry: Entry = {
      height,
      key: keyBytes,
      val: new CidLink(val.bytes),
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
  return await finalizeTree(repo, root ?? emptyNode);
}

function commonPrefixLen(a: Uint8Array, b: Uint8Array) {
  let i = 0;
  for (; i < a.length && i < b.length; i++) {
    if (a[i] !== b[i]) return i;
  }
  return i;
}

async function finalizeTree(repo: RepoStorage, node: Node): Promise<CidLink> {
  const left = await node.left?.$pipe(n => finalizeTree(repo, n));

  const mstEntries: MSTEntry[] = [];
  let lastKey: Uint8Array = new Uint8Array();
  for (const entry of node.entries) {
    const right = await entry.right?.$pipe(n => finalizeTree(repo, n));
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
  const cid = await CID.create(0x71, data);
  repo.putBlock(cid, data, true);

  return new CidLink(cid.bytes);
}
