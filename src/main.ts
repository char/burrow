import "./util/idiolect.ts";

import denoJson from "../deno.json" with { type: "json" };
const VERSION = denoJson.version;

import { Application, Router } from "@oak/oak";

import { apiAuthMiddleware } from "./auth.ts";
import { appConfig } from "./config.ts";
import { setupRepoRoutes } from "./routes/atproto_repo.ts";
import { setupCookieAuthRoutes } from "./routes/cookie_auth.ts";
import { setupDidWebRoutes } from "./routes/did_web.ts";
import { setupOAuthRoutes } from "./routes/oauth.ts";
import { setupTestRoutes } from "./routes/test.ts";
import { XRPCRouter } from "./xrpc-server.ts";
import { setupServerRoutes } from "./routes/atproto_server.ts";
import { setupSyncRoutes } from "./routes/atproto_sync.ts";

const app = new Application({ keys: [appConfig.cookieSecret] });
const xrpc = new XRPCRouter();
const router = new Router();

app.use(async (ctx, next) => {
  ctx.response.headers.set("access-control-allow-origin", "*");
  ctx.response.headers.set("access-control-allow-methods", "*");
  if (ctx.request.headers.has("access-control-request-headers"))
    ctx.response.headers.set(
      "access-control-allow-headers",
      ctx.request.headers.get("access-control-request-headers")!,
    );

  try {
    return await next();
  } catch (err) {
    console.error(err);
    ctx.response.status = 500;
    ctx.response.body = "Internal Server Error";
    ctx.response.type = "text/plain";
  }
});

xrpc.query({ method: "_health" }, () => ({ version: "burrow " + VERSION }));

router.get("/", ctx => {
  ctx.response.type = "text/plain; charset=utf-8";
  ctx.response.body = `burrow pds version ${VERSION}

 /)/)
( . .)
( づ♡

this is an atproto PDS ^-^ see atproto.com`;
});

app.use(apiAuthMiddleware);

router.get("/static/:file*", async ctx => {
  try {
    await ctx.send({ root: "./static", path: ctx.params.file });
  } catch {
    ctx.response.status = 404;
    ctx.response.type = "text/plain";
    ctx.response.body = "Not Found";
  }
});

setupCookieAuthRoutes(app, router);
setupOAuthRoutes(app, router);
setupTestRoutes(app, router);
setupDidWebRoutes(app, router);
setupServerRoutes(app, xrpc);
setupRepoRoutes(app, xrpc);
setupSyncRoutes(app, xrpc);

app.use(xrpc.middleware());
app.use(router.routes());
app.use(router.allowedMethods());

app.use(ctx => {
  ctx.response.type = "text/plain";
  ctx.response.body = "not found :(";
  ctx.response.status = 404;
});

console.log(`Listening on: http://${appConfig.bindHost}:${appConfig.port}`);
app.listen({ port: appConfig.port, hostname: appConfig.bindHost });
