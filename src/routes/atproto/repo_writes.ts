import { Application } from "@oak/oak";
import { assert, j } from "../../_deps.ts";
import { apiAuthenticationInfo } from "../../auth.ts";
import { openRepository } from "../../repo.ts";
import { CidSchema } from "../../util/cid.ts";
import { resolveHandle } from "../../util/handle-resolution.ts";
import { XRPCError, XRPCRouter } from "../../xrpc-server.ts";

export function setupRepoWriteRoutes(_app: Application, xrpc: XRPCRouter) {
  xrpc.procedure(
    {
      method: "com.atproto.repo.applyWrites",
      input: {
        repo: j.string,
        validate: j.optional(j.boolean),
        swapCommit: j.optional(CidSchema),
        writes: j.array(
          j.discriminatedUnion("$type", [
            j.obj({
              $type: j.literal("com.atproto.repo.applyWrites#create"),
              collection: j.string,
              rkey: j.optional(j.string),
              value: j.unknown,
            }),
            j.obj({
              $type: j.literal("com.atproto.repo.applyWrites#update"),
              collection: j.string,
              rkey: j.string,
              value: j.unknown,
            }),
            j.obj({
              $type: j.literal("com.atproto.repo.applyWrites#delete"),
              collection: j.string,
              rkey: j.string,
            }),
          ]),
        ),
      },
    },
    async (ctx, opts) => {
      const auth = apiAuthenticationInfo.get(ctx.request);
      if (!auth) throw new XRPCError("AuthMissing", "Authentication required");
      const did = await resolveHandle(opts.input.repo);
      if (auth.did !== did)
        throw new XRPCError("AuthMissing", "Authentication does not match requested repo");

      const repo = await openRepository(did);

      const currentCommit = repo.getCurrCommit()?.data?.toCid();
      if (opts.input.swapCommit && currentCommit !== opts.input.swapCommit)
        throw new XRPCError("InvalidSwap", `Commit was at ${currentCommit ?? "null"}`);

      return await repo.write(opts.input.writes);
    },
  );

  xrpc.procedure(
    {
      method: "com.atproto.repo.createRecord",
      input: {
        repo: j.string,
        collection: j.string,
        rkey: j.optional(j.string),
        validate: j.optional(j.boolean),
        record: j.unknown,
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
      const did = await resolveHandle(opts.input.repo);
      if (auth.did !== did)
        throw new XRPCError("AuthMissing", "Authentication does not match requested repo");

      const repo = await openRepository(did);
      const results = await repo.write(
        [
          {
            $type: "com.atproto.repo.applyWrites#create",
            rkey: opts.input.rkey,
            collection: opts.input.collection,
            value: opts.input.record,
          },
        ],
        opts.input.swapCommit,
      );

      const firstResult = results.results[0];
      assert(firstResult.$type !== "com.atproto.repo.applyWrites#deleteResult");

      return {
        uri: firstResult.uri,
        cid: firstResult.cid,
        commit: results.commit,
        validationStatus: "valid",
      };
    },
  );

  xrpc.procedure(
    {
      method: "com.atproto.repo.putRecord",
      input: {
        repo: j.string,
        collection: j.string,
        rkey: j.string,
        validate: j.optional(j.boolean),
        record: j.unknown,
        swapRecord: j.optional(j.union(j.literal(null), CidSchema)),
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
      const did = await resolveHandle(opts.input.repo);
      if (auth.did !== did)
        throw new XRPCError("AuthMissing", "Authentication does not match requested repo");

      const repo = await openRepository(did);

      const currentCid = repo.getRecordCid(opts.input.collection, opts.input.rkey);
      const results = await repo.write(
        [
          {
            $type: currentCid
              ? "com.atproto.repo.applyWrites#update"
              : "com.atproto.repo.applyWrites#create",
            rkey: opts.input.rkey,
            collection: opts.input.collection,
            value: opts.input.record,
            swapRecord: opts.input.swapRecord,
          },
        ],
        opts.input.swapCommit,
      );

      const firstResult = results.results[0];
      assert(firstResult.$type !== "com.atproto.repo.applyWrites#deleteResult");

      return {
        uri: firstResult.uri,
        cid: firstResult.cid,
        commit: results.commit,
        validationStatus: "valid",
      };
    },
  );

  xrpc.procedure(
    {
      method: "com.atproto.repo.deleteRecord",
      input: {
        repo: j.string,
        collection: j.string,
        rkey: j.string,
        swapRecord: j.optional(CidSchema),
        swapCommit: j.optional(CidSchema),
      },
    },
    async (ctx, opts) => {
      const auth = apiAuthenticationInfo.get(ctx.request);
      if (!auth) throw new XRPCError("AuthMissing", "Authentication required");
      const did = await resolveHandle(opts.input.repo);
      if (auth.did !== did)
        throw new XRPCError("AuthMissing", "Authentication does not match requested repo");

      const repo = await openRepository(did);

      const results = await repo.write(
        [
          {
            $type: "com.atproto.repo.applyWrites#delete",
            collection: opts.input.collection,
            rkey: opts.input.rkey,
            swapRecord: opts.input.swapRecord,
          },
        ],
        opts.input.swapCommit,
      );

      return { commit: results.commit };
    },
  );
}
