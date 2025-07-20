import { Application } from "@oak/oak";
import { j } from "../_deps.ts";
import { openRepository } from "../repo.ts";
import { CidSchema } from "../util/cid.ts";
import { DidSchema } from "../util/did.ts";
import { XRPCError, XRPCRouter } from "../xrpc-server.ts";

export function setupRepoRoutes(_app: Application, xrpc: XRPCRouter) {
  xrpc.query(
    {
      method: "com.atproto.repo.getRecord",
      params: {
        repo: DidSchema,
        collection: j.string,
        rkey: j.string,
        cid: j.optional(CidSchema),
      },
    },
    async (_ctx, { params: { repo: did, collection, rkey, cid } }) => {
      const repo = await openRepository(did);
      const record = repo.getRecord(collection, rkey);
      if (!record || (cid && cid !== repo.getRecordCid(collection, rkey))) {
        const atUri = `at://${did}/${collection}/${rkey}`;
        throw new XRPCError("RecordNotFound", "Could not locate record: " + atUri);
      }
      return record;
    },
  );
}
