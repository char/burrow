import { encodeUtf8, toSha256 } from "@atcute/uint8array";
import { createHash } from "node:crypto";

// blocks the js runtime. only use for small data
export function sha256Sync(data: Uint8Array | string): Uint8Array {
  const hash = createHash("sha256");
  hash.update(data);
  return new Uint8Array(hash.digest());
}

export function sha256(data: Uint8Array | string): Promise<Uint8Array> {
  if (typeof data === "string") return toSha256(encodeUtf8(data));
  return toSha256(data);
}
