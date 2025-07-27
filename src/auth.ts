import { Middleware, Request } from "@oak/oak";
import { j } from "./_deps.ts";
import { appConfig } from "./config.ts";
import { Did, DidSchema, isDid } from "./util/did.ts";
import { decodeJwt, verifyJwtHS256Signature } from "./util/jwt.ts";

// TODO: what else does this need?
type AuthInfo = {
  did: Did;
};

const dpopAuthJwtHeader = j
  .obj({
    typ: j.literal("at+jwt"),
    alg: j.literal("HS256"),
  })
  .$pipe(j.compile);
const dpopAuthJwtPayload = j
  .obj({
    sub: DidSchema,
    iss: j.string,
  })
  .$pipe(j.compile);

export const apiAuthenticationInfo = new WeakMap<Request, AuthInfo>();
export const apiAuthMiddleware: Middleware = async (ctx, next) => {
  const authorizationHeader = ctx.request.headers.get("authorization");
  if (!authorizationHeader) return next();

  if (authorizationHeader.startsWith("DPoP ")) {
    try {
      const jwt = authorizationHeader.substring("DPoP ".length);
      const decoded = decodeJwt(jwt);

      const { value: header } = dpopAuthJwtHeader(decoded.header);
      if (!header) throw new Error("bad auth jwt header");
      const { value: payload } = dpopAuthJwtPayload(decoded.payload);
      if (!payload) throw new Error("bad auth jwt payload");

      // FIXME: read dpop header and verify stuff

      if (!(await verifyJwtHS256Signature(appConfig.jwtSecret, jwt)))
        throw new Error("bad jwt signature");
      apiAuthenticationInfo.set(ctx.request, { did: payload.sub });
    } catch (err) {
      console.warn(err);

      ctx.response.status = 401;
      ctx.response.type = "application/json";
      ctx.response.body = {
        error: "invalid_dpop_proof",
        message: "failed to verify dpop proof signature",
      };
      return;
    }
  }

  if (appConfig.adminPassword && authorizationHeader.startsWith("Admin ")) {
    const did = authorizationHeader.substring("Admin ".length);
    if (ctx.request.headers.get("X-Admin-Password") !== appConfig.adminPassword)
      throw new Error("bad auth admin password");
    if (!isDid(did)) throw new Error("bad auth did");
    apiAuthenticationInfo.set(ctx.request, { did });
  }

  return next();
};

export const cookieAuthInfo = new WeakMap<Request, Did>();
export const cookieAuthMiddleware: Middleware = async (ctx, next) => {
  const burrowAuth = await ctx.cookies.get("burrow-auth", { signed: true });
  if (burrowAuth) cookieAuthInfo.set(ctx.request, burrowAuth as Did);
  return await next();
};
