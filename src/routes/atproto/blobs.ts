import { Application } from "@oak/oak";
import { XRPCError, XRPCRouter } from "../../xrpc-server.ts";
import { DidSchema } from "../../util/did.ts";
import { j } from "../../_deps.ts";
import { openRepository } from "../../repo.ts";
import { mainDb } from "../../db/main_db.ts";

export function setupBlobRoutes(_app: Application, xrpc: XRPCRouter) {
  // TODO
  xrpc.query(
    {
      method: "com.atproto.sync.listBlobs",
      params: {
        did: DidSchema,
        since: j.optional(j.string),
        limit: j.optional(j.number),
        cursor: j.optional(j.string),
      },
    },
    async (_ctx, opts) => {
      const account = mainDb.getAccount(opts.params.did);
      if (!account)
        throw new XRPCError("RepoNotFound", `Could not find repo for did: ${opts.params.did}`);
      const repo = await openRepository(account.did);

      let cids = repo.storage.listBlobs(opts.params.limit ?? 500, opts.params.cursor);

      return { cursor: cids.at(-1), cids };
    },
  );
}
