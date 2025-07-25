import { Application } from "@oak/oak";
import { XRPCRouter } from "../xrpc-server.ts";
import { j } from "../_deps.ts";
import { DidSchema } from "../util/did.ts";
import { CidSchema } from "../util/cid.ts";
import { openRepository } from "../repo.ts";
import { mainDb } from "../db/main_db.ts";

export function setupSyncRoutes(_app: Application, xrpc: XRPCRouter) {
  xrpc.query(
    {
      method: "com.atproto.sync.listRepos",
      params: {
        limit: j.optional(j.number),
        cursor: j.optional(j.string),
      },
      output: {
        cursor: j.string,
        repos: j.array(
          j.obj({
            did: DidSchema,
            head: CidSchema,
            rev: j.string,
            active: j.optional(j.boolean),
            status: j.optional(
              j.union(
                j.literal("takendown"),
                j.literal("suspended"),
                j.literal("deleted"),
                j.literal("deactivated"),
                j.literal("desynchronized"),
                j.literal("throttled"),
              ),
            ),
          }),
        ),
      },
    },
    async () => {
      // TODO: paginate

      const repos = [];
      for (const account of mainDb.getAllAccounts()) {
        const repo = await openRepository(account.did);
        const commit = repo.getCurrCommit();
        if (!commit) continue;
        repos.push({
          did: account.did,
          head: commit.data.toCid(),
          rev: commit.rev,
          active: account.deactivated_at === null,
        });
      }
      return { cursor: "", repos };
    },
  );
}
