import "./util/idiolect.ts";

import denoJson from "../deno.json" with { type: "json" };
const VERSION = denoJson.version;

import { Secp256k1PrivateKeyExportable } from "@atcute/crypto";
import { Application, Router } from "@oak/oak";
import { TID } from "./_deps.ts";

import { appConfig } from "./config.ts";
import { accountsDb } from "./db/accounts.ts";
import { openRepoDatabase } from "./db/repo_storage.ts";
import { Repository } from "./repo.ts";
import { XRPCRouter } from "./xrpc-server.ts";

const app = new Application();
const xrpc = new XRPCRouter();
const router = new Router();

xrpc.query({ method: "_health" }, () => ({ version: "burrow " + VERSION }));

router.get("/", ctx => {
  ctx.response.type = "text/plain; charset=utf-8";
  ctx.response.body = `burrow pds version ${VERSION}

 /)/)
( . .)
( づ♡

this is an atproto PDS ^-^ see atproto.com`;
});

router.post("/test/create-account", async ctx => {
  const testDomain = "x-burrow-20250718.tmp.bun.how";

  const signingKey = await Secp256k1PrivateKeyExportable.createKeypair();
  accountsDb.createAccount(
    `did:web:testing.${testDomain}`,
    "testing." + testDomain,
    "testing@" + testDomain,
    "password",
    signingKey,
  );
  const storage = await openRepoDatabase(`did:web:testing.${testDomain}`);
  const repo = new Repository(storage, signingKey);
  await repo.initialCommit();

  const record = {
    $type: "how.bun.example.record",
    hello: "world",
  };
  const rkey = TID.now();
  await repo.mutate([{ type: "create", collection: record.$type, rkey, record }]);

  ctx.response.body = ":)";
});

app.use(xrpc.middleware());
app.use(router.routes());
app.use(router.allowedMethods());

console.log(`Listening on: http://${appConfig.bindHost}:${appConfig.port}`);
app.listen({ port: appConfig.port, hostname: appConfig.bindHost });
