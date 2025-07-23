import { Application, Middleware, Router } from "@oak/oak";
import { URLSearchParams } from "node:url";
import { nanoid } from "npm:nanoid";
import { assert, j, ventoEnv } from "../_deps.ts";
import { appConfig } from "../config.ts";
import { mainDb } from "../db/main_db.ts";
import { signJwtHS256 } from "../util/jwt.ts";
import { prefixedStringSchema, urlSchema } from "../util/schemas.ts";
import { cookieAuthInfo } from "./cookie_auth.ts";

const oauthPushedRequestSchema = j.compile(
  j.obj({
    client_id: urlSchema,
    response_type: j.literal("code"),
    response_mode: j.optional(j.union(j.literal("query"), j.literal("fragment"))),
    code_challenge: j.string,
    code_challenge_method: j.literal("S256"),
    state: j.string,
    redirect_uri: j.string,
    scope: j.string,
    client_assertion_type: j.optional(j.string),
    client_assertion: j.optional(j.string),
    login_hint: j.optional(j.string),
  }),
);

export function setupOAuthRoutes(app: Application, router: Router) {
  const oauthCorsMiddleware: Middleware = (ctx, next) => {
    ctx.response.headers.set("access-control-max-age", "600");
    ctx.response.headers.set("access-control-allow-headers", "Content-Type,DPoP");
    ctx.response.headers.set("access-control-allow-methods", "*");
    ctx.response.headers.set("access-control-allow-origin", "*");
    return next();
  };

  router.get("/.well-known/oauth-protected-resource", oauthCorsMiddleware, ctx => {
    ctx.response.type = "application/json";
    ctx.response.body = {
      resource: appConfig.baseUrl,
      authorization_servers: [appConfig.baseUrl],
      scopes_supported: [],
      bearer_methods_supported: ["header"],
      resource_documentation: "https://atproto.com",
    };
  });

  router.get("/.well-known/oauth-authorization-server", oauthCorsMiddleware, ctx => {
    ctx.response.type = "application/json";
    ctx.response.body = {
      issuer: appConfig.baseUrl,
      authorization_endpoint: new URL("/oauth/authorize", appConfig.baseUrl).href,
      token_endpoint: new URL("/oauth/token", appConfig.baseUrl).href,
      pushed_authorization_request_endpoint: new URL("/oauth/par", appConfig.baseUrl),
      require_pushed_authorization_requests: true,

      scopes_supported: ["atproto", "transition:generic", "transition:chat.bsky"],
      subject_types_supported: ["public"],
      response_types_supported: ["code"],
      response_modes_supported: ["query", "fragment"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256", "plain"],
      ui_locales_supported: ["en-US"],
      display_values_supported: ["page"],

      authorization_response_iss_parameter_supported: true,

      request_object_signing_alg_values_supported: ["none"],
      request_object_encryption_alg_values_supported: [],
      request_object_encryption_enc_values_supported: [],

      token_endpoint_auth_methods_supported: ["none"],
      token_endpoint_auth_signing_alg_values_supported: ["ES256"],
      // revocation_endpoint: new URL("/oauth/revoke", appConfig.baseUrl),
      // introspection_endpoint: new URL("/oauth/introspect", appConfig.baseUrl),
      dpop_signing_alg_values_supported: ["ES256"],
      client_id_metadata_document_supported: true,
    };
  });

  router.options("/oauth/par", oauthCorsMiddleware, ctx => {
    ctx.response.status = 204;
  });

  router.post("/oauth/par", oauthCorsMiddleware, async ctx => {
    // oauth 2.0 wants urlencoded, atproto oauth wants json
    const body =
      ctx.request.headers.get("content-type") === "application/x-www-form-urlencoded"
        ? Object.fromEntries(await ctx.request.body.form())
        : await ctx.request.body.json();
    const token = nanoid(24);

    const uri = "urn:ietf:params:oauth:request_uri:" + token;
    void mainDb.db.run("DELETE FROM oauth_pars WHERE expires_at < ?", Date.now());
    mainDb.insertOAuthRequest(uri, body, Date.now() + 3600_000);

    ctx.response.type = "application/json";
    ctx.response.body = { request_uri: uri, expires_in: 3600 };
    ctx.response.status = 201;
  });

  const oauthParams = j.compile(
    j.obj({
      client_id: urlSchema,
      request_uri: prefixedStringSchema("urn:ietf:params:oauth:request_uri:"),
    }),
  );
  router.get("/oauth/authorize", oauthCorsMiddleware, async ctx => {
    try {
      const { value: params, errors: paramsErrors } = oauthParams({
        client_id: ctx.request.url.searchParams.get("client_id") ?? undefined,
        request_uri: ctx.request.url.searchParams.get("request_uri"),
      });

      ctx.response.type = "text/html";

      if (paramsErrors) {
        ctx.response.status = 400;
        throw new Error(
          "OAuth authorization request has invalid parameters." +
            "\n" +
            JSON.stringify(paramsErrors),
        );
      }

      const requestObj = mainDb.getOAuthRequest(params.request_uri);
      if (requestObj === undefined)
        throw new Error("OAuth authorization request was not found (did it expire?)");

      const { value: request, errors: requestErrors } = oauthPushedRequestSchema(requestObj);
      if (requestErrors) {
        ctx.response.status = 500;
        throw new Error("Internal Server Error");
      }

      // FIXME: fetch client metadata doc and validate redirect uri etcetcetc

      const code = "cod-" + nanoid(24);
      mainDb.insertOAuthCode(code, request, params.request_uri);

      const currentUser = cookieAuthInfo.get(ctx.request);
      if (
        currentUser === undefined ||
        (request.login_hint && request.login_hint !== currentUser)
      ) {
        const { content } = await ventoEnv.run("./src/templates/sign_in.vto", {
          prefillident: request.login_hint,
          redirect: ctx.request.url.pathname + ctx.request.url.search,
        });
        ctx.response.body = content;
        return;
      }

      const rendered = await ventoEnv.run("./src/templates/oauth_authorize.vto", {
        code,
        request,
        currentUser,
        request_uri: params.request_uri,
      });
      ctx.response.body = rendered.content;
    } catch (err) {
      if (err instanceof Error) {
        const { content } = await ventoEnv.run("./src/templates/oauth_authorize_error.vto", {
          message: err.message,
        });
        ctx.response.body = content;
      } else throw err;
    }
  });

  router.post("/oauth/authorize", async ctx => {
    const currentUser = cookieAuthInfo.get(ctx.request);
    if (currentUser === undefined) {
      ctx.response.status = 403;
      ctx.response.type = "text/plain";
      ctx.response.body = "you must be logged in to authorize an oauth session";
      return;
    }

    const body = await ctx.request.body.form();
    const codeStr = body.get("code");
    if (codeStr === null) {
      ctx.response.status = 400;
      ctx.response.type = "text/plain";
      ctx.response.body = "'code' is a required parameter";
      return;
    }
    const code = mainDb.retrieveOAuthCode(codeStr);
    if (!code) {
      ctx.response.status = 404;
      ctx.response.type = "text/plain";
      ctx.response.body = "no stored code with the given id";
      return;
    }
    if (code.authorized_by) {
      ctx.response.status = 409;
      ctx.response.type = "text/plain";
      ctx.response.body = "oauth authorization was already granted";
      return;
    }
    mainDb.activateOAuthCode(code.code, currentUser);
    const request = oauthPushedRequestSchema(code.request).value!;

    const params = new URLSearchParams();
    params.set("code", code.code);
    params.set("state", request.state);
    params.set("iss", appConfig.baseUrl);

    if (request.response_mode === "fragment") {
      ctx.response.redirect(request.redirect_uri + "#" + params.toString());
    } else if (request.response_mode === "query") {
      ctx.response.redirect(request.redirect_uri + "?" + params.toString());
    } else {
      throw new Error("unrecognized response_mode");
    }
  });

  const OAuthTokenBodySchema = j.obj({
    client_id: urlSchema,
    code: j.string,
    code_verifier: j.optional(j.string),
    grant_type: j.literal("authorization_code"),
    redirect_uri: j.string,
  });
  const parseOAuthTokenBody = j.compile(OAuthTokenBodySchema);
  router.options("/oauth/token", oauthCorsMiddleware, ctx => (ctx.response.status = 204));
  router.post("/oauth/token", oauthCorsMiddleware, async ctx => {
    const body = await ctx.request.body.json();
    const { value, errors } = parseOAuthTokenBody(body);
    if (errors) {
      return; // todo
    }

    const code = mainDb.retrieveOAuthCode(value.code);
    if (!code) return; // FIXME: return error response
    if (code.authorized_at === null) return; // ^
    assert(code.authorized_by !== null);
    const request = oauthPushedRequestSchema(code.request).value!;

    mainDb.db.run("DELETE FROM oauth_codes WHERE code = ?", code.code);

    const header = { typ: "at+jwt", alg: "HS256" };
    const now = Math.floor(Date.now() / 1000);
    const expiry = 7 * 24 * 60 * 60;
    const payload = {
      jti: "tok-" + nanoid(24),
      sub: code.authorized_by,
      iat: now,
      exp: now + expiry,
      // FIXME: cnf.jkt excluded for now because atcute doesn't care
      iss: appConfig.baseUrl,
      _scope: request.scope,
    };

    const refreshToken = "refresh-" + nanoid(32);
    mainDb.insertOAuthRefresh(
      refreshToken,
      code.authorized_by!,
      request.scope,
      Date.now() + 365 * 24 * 60 * 60 * 1000,
    );

    const accessToken = await signJwtHS256(appConfig.jwtSecret, header, payload);

    ctx.response.type = "application/json";
    ctx.response.body = {
      access_token: accessToken,
      token_type: "DPoP",
      refresh_token: refreshToken,
      scope: request.scope,
      expires_in: expiry,
      sub: code.authorized_by,
    };
  });
}
