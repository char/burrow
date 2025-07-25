import { Application } from "@oak/oak";
import { j } from "../_deps.ts";
import { openRepository } from "../repo.ts";
import { CidSchema } from "../util/cid.ts";
import { DidSchema } from "../util/did.ts";
import { XRPCError, XRPCRouter } from "../xrpc-server.ts";
import { apiAuthenticationInfo } from "../auth.ts";

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
    async (_ctx, { params: { repo: did, collection, rkey, cid: requestedCid } }) => {
      const repo = await openRepository(did);
      const record = repo.getRecord(collection, rkey);
      const uri = `at://${did}/${collection}/${rkey}`;
      const cid = repo.getRecordCid(collection, rkey);
      if (!record || (requestedCid && requestedCid !== cid)) {
        throw new XRPCError("RecordNotFound", "Could not locate record: " + uri);
      }
      return { uri, cid, value: record };
    },
  );

  xrpc.procedure(
    {
      method: "com.atproto.repo.putRecord",
      input: {
        repo: DidSchema,
        collection: j.string,
        rkey: j.string,
        validate: j.optional(j.boolean),
        record: j.unknown,
        swapRecord: j.optional(j.union(null, CidSchema)),
        swapCommit: j.optional(CidSchema),
      },
      output: {
        uri: j.string,
        cid: CidSchema,
        commit: j.union(
          j.literal(null),
          j.obj({
            cid: CidSchema,
            rev: j.string,
          }),
        ),
      },
    },
    async (ctx, opts) => {
      const auth = apiAuthenticationInfo.get(ctx.request);
      if (!auth) throw new XRPCError("AuthMissing", "Authentication required");
      const did = opts.input.repo;
      if (auth.did !== did)
        throw new XRPCError("AuthMissing", "Authentication does not match requested repo");

      const repo = await openRepository(did);

      const currentCommit = repo.getCurrCommit()?.data?.toCid();
      if (opts.input.swapCommit && currentCommit !== opts.input.swapCommit)
        throw new XRPCError("InvalidSwap", `Commit was at ${currentCommit ?? "null"}`);

      const currentCid = repo.getRecordCid(opts.input.collection, opts.input.rkey);
      // undefined implies we don't want to check, null implies we want to ensure it didn't exist before
      const swapRecord = opts.input.swapRecord ?? undefined;
      if (opts.input.swapRecord !== undefined && currentCid !== swapRecord)
        throw new XRPCError("InvalidSwap", `Record was at ${currentCid ?? "null"}`);

      await repo.mutate([
        {
          type: currentCid ? "update" : "create",
          rkey: opts.input.rkey,
          collection: opts.input.collection,
          record: opts.input.record,
        },
      ]);

      // prettier-ignore
      const uri = `at://${repo.storage.did}/${
        encodeURIComponent(opts.input.collection)}/${encodeURIComponent(opts.input.rkey)}`;
      const cid = repo.getRecordCid(opts.input.collection, opts.input.rkey)!;
      const commit = repo.getCurrCommit()!;
      return {
        uri,
        cid,
        commit: { cid: commit.data.toCid(), rev: commit.rev },
        validationStatus: "valid",
      };
    },
  );
}
