import { fromBase32, toBase32 } from "@atcute/multibase";
import { toSha256 } from "@atcute/uint8array";
import { createHash } from "node:crypto";
import { assert, j } from "./_deps.ts";

export type Cid = `bafyrei${string}` | `bafkrei${string}`;
export const CidSchema = j.custom(
  (v): v is Cid =>
    typeof v === "string" && (v.startsWith("bafyrei") || v.startsWith("bafkrei")),
  "must be a cid",
);

export function encodeCidFromDigest(codec: 0x55 | 0x71, digest: Uint8Array): Uint8Array {
  const version = 1;
  const bytes = new Uint8Array(36);
  bytes[0] = version;
  bytes[1] = codec;
  bytes[2] = 0x12; // sha256
  bytes[3] = 32; // 8 × 32 = 256
  bytes.set(digest, 4);
  return bytes;
}

export function cidToString(data: Uint8Array): Cid {
  assert(data.length === 36);
  const cid = ("b" + toBase32(data)) as Cid;
  assert(cid.startsWith("bafyrei") || cid.startsWith("bafkrei"));
  return cid;
}

export function cidToBytes(cid: Cid): Uint8Array {
  return fromBase32(cid.substring(1));
}

export function createCid(codec: 0x55 | 0x71, data: Uint8Array): Cid {
  const hash = createHash("sha256");
  hash.update(data);
  const sha256 = new Uint8Array(hash.digest());
  return cidToString(encodeCidFromDigest(codec, sha256));
}

export async function createLargeCid(codec: 0x55 | 0x71, data: Uint8Array): Promise<Cid> {
  const sha256 = await toSha256(data);
  return cidToString(encodeCidFromDigest(codec, sha256));
}
