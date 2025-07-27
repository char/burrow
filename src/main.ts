import "./util/idiolect.ts";

import { apiAuthMiddleware } from "./auth.ts";
import { appConfig } from "./config.ts";
import { app, router, xrpc } from "./web.ts";

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
    ctx.response.body = "internal server error :(";
    ctx.response.type = "text/plain";
  }
});

app.use(apiAuthMiddleware);
app.use(apiAuthMiddleware);

import "./routes/mod.ts";

app.use(xrpc.middleware());
app.use(router.routes());
app.use(router.allowedMethods());

app.use(ctx => {
  ctx.response.type = "text/plain";
  ctx.response.body = "not found :(";
  ctx.response.status = 404;
});

if (import.meta.main) {
  console.log(`Listening on: http://${appConfig.bindHost}:${appConfig.port}`);
  app.listen({ port: appConfig.port, hostname: appConfig.bindHost });
}
