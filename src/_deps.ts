// i have these `* as …` imports in here for autocomplete

import "./util/idiolect.ts";

export { assert } from "@std/assert";
export * as fs from "@std/fs";
export * as path from "@std/path";

export * as j from "@char/justin";

import * as CBOR from "@atcute/cbor";
import * as CID from "@atcute/cid";

import { BytesWrapper as Bytes, CidLinkWrapper as CidLink } from "@atcute/cbor";

declare module "@atcute/cbor" {
  interface CidLinkWrapper {
    toCid(): CID.Cid;
  }

  namespace CidLinkWrapper {
    function fromCid(cid: CID.Cid): void;
  }
}
Object.defineProperty(CidLink.prototype, "toCid", {
  enumerable: false,
  value: function () {
    return CBOR.fromCidLink(this);
  },
});
Object.defineProperty(CidLink, "fromCid", {
  enumerable: false,
  value: function (cid: CID.Cid) {
    return new CidLink(cid.bytes);
  },
});

export { Bytes, CBOR, CID, CidLink };
