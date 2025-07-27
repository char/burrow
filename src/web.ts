import { Application, Router } from "@oak/oak";

import { appConfig } from "./config.ts";
import { XRPCRouter } from "./xrpc-server.ts";

export const app = new Application({ keys: [appConfig.cookieSecret] });
export const xrpc = new XRPCRouter();
export const router = new Router();
