// i have these `* as …` imports in here for autocomplete

import "./util/idiolect.ts";

export { assert } from "@std/assert";
export * as fs from "@std/fs";
export * as path from "@std/path";

export * as j from "@char/justin";

import * as CBOR from "@atcute/cbor";

import { BytesWrapper as Bytes, CidLinkWrapper as CidLink } from "@atcute/cbor";
import { Cid, cidToBytes } from "./util/cid.ts";

declare module "@atcute/cbor" {
  interface CidLinkWrapper {
    toCid(): Cid;
  }

  namespace CidLinkWrapper {
    function fromCid(cid: Cid): CidLinkWrapper;
  }
}
Object.defineProperty(CidLink.prototype, "toCid", {
  enumerable: false,
  value: function (this: CidLink) {
    return this.$link as Cid;
  },
});
Object.defineProperty(CidLink, "fromCid", {
  enumerable: false,
  value: function (cid: Cid) {
    return new CidLink(cidToBytes(cid));
  },
});

export * as TID from "@atcute/tid";
export { Bytes, CBOR, CidLink };

import vento from "https://deno.land/x/vento@v1.15.0/mod.ts";
const ventoEnv = vento();
export { ventoEnv };
