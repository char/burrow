import "./util/idiolect.ts";

import { appConfig } from "./config.ts";

import { Application, Router } from "@oak/oak";
import { XRPCRouter } from "./xrpc-server.ts";

import denoJson from "../deno.json" with { type: "json" };
const VERSION = denoJson.version;

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

app.use(xrpc.middleware());
app.use(router.routes());
app.use(router.allowedMethods());

console.log(`Listening on: http://${appConfig.bindHost}:${appConfig.port}`);
app.listen({ port: appConfig.port, hostname: appConfig.bindHost });
