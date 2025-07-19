import "./util/idiolect.ts";

import { appConfig } from "./config.ts";

import { Application, Router } from "@oak/oak";
import { XRPCRouter } from "./xrpc-server.ts";

const app = new Application();
const xrpc = new XRPCRouter();
const router = new Router();

xrpc.query({ method: "_health" }, () => ({ version: "burrow 0.1.0" }));

app.use(xrpc.middleware());
app.use(router.routes());
app.use(router.allowedMethods());

console.log(`Listening on: http://${appConfig.bindHost}:${appConfig.port}`);
app.listen({ port: appConfig.port, hostname: appConfig.bindHost });
