// deno-lint-ignore-file no-explicit-any

import { Context, Middleware } from "@oak/oak";
import { URLSearchParams } from "node:url";
import { j } from "./_deps.ts";
import { appConfig } from "./config.ts";
import { isDid, resolveDid } from "./did.ts";
import { logging } from "./util/log.ts";

const xrpcPattern = new URLPattern({ pathname: "/xrpc/:lxm" });

export const ERROR_TYPES = {
  InvalidRequest: 400,
  RecordNotFound: 404,
  MethodNotImplemented: 501,
  InternalServerError: 500,
} as const;

export class XRPCError extends Error {
  constructor(
    public error: keyof typeof ERROR_TYPES,
    message: string,
    public extra: unknown & object = {},
  ) {
    super(message);
  }
}

const createSpecParser = (name: string) => (specSchema: Record<string, j.AnySchema>) =>
  specSchema
    ? j.compile(j.obj(specSchema)).$pipe(f => (v: unknown) => {
        const { value, errors } = f(v);
        if (errors)
          throw new XRPCError("InvalidRequest", "Invalid data for: " + name, { errors });
        return value;
      })
    : undefined;

const createParamCoercer = (specSchema: Record<string, j.AnySchema>) => {
  const lines: string[] = [];

  lines.push(`const { coerceNumber, coerceBoolean } = env`);
  lines.push(`return (params) => {`);
  lines.push(`const o = {}`);

  const unwrapOptional = (o: j.AnySchema) =>
    o.type === "optional" ? (o as j.OptionalSchema<j.AnySchema>).schema : o;
  const unwrapArray = (a: j.AnySchema) =>
    a.type === "array" ? (a as j.ArraySchema<j.AnySchema>).items : a;

  for (const [key, schema] of Object.entries(specSchema)) {
    const s1 = unwrapOptional(schema);
    const s2 = unwrapArray(s1);
    if (s2.type === "union") throw new Error("unions are not supported in param coercion");
    if (s2.type === "object") throw new Error("objects are not supported in param coercion");

    const optional = schema !== s1;
    const multiple = s1 !== s2;
    const coerce =
      s2.type === "number" ? `coerceNumber` : s2.type === "boolean" ? `coerceBoolean` : "";

    if (optional) lines.push(`if (params.has(${key.$json})) {`);
    if (multiple) {
      if (coerce) lines.push(`o[${key.$json}] = params.getAll(${key.$json}).map(${coerce});`);
      else lines.push(`o[${key.$json}] = params.getAll(${key.$json});`);
    } else {
      lines.push(`o[${key.$json}] = ${coerce}(params.get(${key.$json}));`);
    }
    if (optional) lines.push(`}`);
  }

  lines.push(`return o;`);
  lines.push(`}`);

  const f = new Function("env", lines.join("\n"));
  return f({
    coerceNumber: (n: string) => Number(n),
    coerceBoolean: (b: string) => !["0", "false"].includes(b),
  });
};

type InferSpecType<T extends Record<string, j.AnySchema> | undefined> = undefined extends T
  ? never
  : j.Infer<j.ObjectSchema<NonNullable<T>>>;

interface QuerySpecIn {
  method: string;
  params?: Record<string, j.AnySchema>;
  output?: Record<string, j.AnySchema>;
}

interface ProcedureSpecIn {
  method: string;
  params?: Record<string, j.AnySchema>;
  input?: Record<string, j.AnySchema>;
  output?: Record<string, j.AnySchema>;
}

type AnyRouteHandler = (ctx: Context, opts: { params: any; input: any }) => any;

interface XRPCRoute {
  type: "query" | "procedure";
  method: string;
  coerceParams?: (params: URLSearchParams) => any;
  parseParams?: (params: any) => any;
  parseInput?: (input: any) => any;
  parseOutput?: (output: any) => any;
  handler: AnyRouteHandler;
}

type QueryHandler<Q extends QuerySpecIn> = (
  ctx: Context,
  opts: { params: InferSpecType<Q["params"]> },
) => undefined extends Q["output"] ? unknown : InferSpecType<Q["output"]>;

type ProcedureHandler<P extends ProcedureSpecIn> = (
  ctx: Context,
  opts: { params: InferSpecType<P["params"]>; input: InferSpecType<P["input"]> },
) => undefined extends P["output"] ? unknown : InferSpecType<P["output"]>;

export class XRPCRouter {
  routes = new Map<string, XRPCRoute>();

  query<Q extends QuerySpecIn>(spec: Q, handler: QueryHandler<Q>): void {
    this.routes.set(spec.method, {
      type: "query",
      method: spec.method,
      coerceParams: spec.params?.$pipe(createParamCoercer),
      parseParams: spec.params?.$pipe(createSpecParser("params")),
      parseOutput: spec.output?.$pipe(createSpecParser("output")),
      handler,
    });
  }

  procedure<P extends ProcedureSpecIn>(spec: P, handler: ProcedureHandler<P>): void {
    this.routes.set(spec.method, {
      type: "procedure",
      method: spec.method,
      coerceParams: spec.params?.$pipe(createParamCoercer),
      parseParams: spec.params?.$pipe(createSpecParser("params")),
      parseInput: spec.input?.$pipe(createSpecParser("input")),
      parseOutput: spec.output?.$pipe(createSpecParser("output")),
      handler,
    });
  }

  async #handleProxy(ctx: Context, lxm: string) {
    let origin = new URL(appConfig.fallbackAppviewUrl);

    const proxyHeader = ctx.request.headers.get("atproto-proxy");
    if (proxyHeader) {
      const [did, fragment] = proxyHeader.split("#");
      if (!fragment)
        throw new XRPCError("InvalidRequest", "no fragment for atproto-proxy value");
      if (!isDid(did))
        throw new XRPCError("InvalidRequest", "atproto-proxy value was not a did");
      const doc = await resolveDid(did).$mapErr(
        () => new XRPCError("InternalServerError", "unable to resolve atproto-proxy service"),
      );
      const endpoint = doc.service?.find(it => it.id === "#" + fragment)?.serviceEndpoint;
      if (typeof endpoint === "string") origin = new URL(endpoint);
    } else {
      // we're using the fallback appview
      if (origin.hostname.endsWith(".bsky.app") && !lxm.startsWith("app.bsky")) {
        throw new XRPCError("MethodNotImplemented", "Method Not Implemented");
      }
    }

    const url = new URL(ctx.request.url);
    url.protocol = origin.protocol;
    url.host = origin.host;
    url.port = origin.port;

    const response = await fetch(url, {
      method: ctx.request.method,
      body: ctx.request.body.has ? ctx.request.body.stream : undefined,
      headers: {
        "content-type": ctx.request.headers.get("content-type"),
        // TODO: for authorization, create a service jwt
        "atproto-accept-labelers": ctx.request.headers.get("atproto-accept-labelers"),
      }
        .$pipe(Object.entries)
        .filter(([_k, v]) => v != null)
        .$pipe(Object.fromEntries),
    });

    ctx.response.status = response.status;
    ctx.response.headers = response.headers;
    ctx.response.body = response.body;
  }

  middleware(): Middleware {
    return async (ctx, next) => {
      const matches = xrpcPattern.exec(ctx.request.url);
      if (!matches) return next();
      const lxm = matches.pathname.groups.lxm!;
      const route = this.routes.get(lxm);
      try {
        if (ctx.request.method === "OPTIONS") {
          ctx.response.headers.set("access-control-max-age", "600");
          ctx.response.headers.set("access-control-allow-origin", "*");
          const methods = route
            ? route.type === "query"
              ? ["OPTIONS", "GET", "HEAD"]
              : // route.type === "procedure"
                ["OPTIONS", "POST"]
            : ["OPTIONS", "GET", "HEAD", "POST"];
          ctx.response.headers.set("allow", methods.join(","));
          ctx.response.headers.set("access-control-allow-methods", methods.join(","));
          ctx.response.status = 204;
          return;
        }

        if (!route) return await this.#handleProxy(ctx, lxm);

        let output = undefined;

        let params = undefined;
        if (route.coerceParams && route.parseParams) {
          params = route.parseParams(route.coerceParams(ctx.request.url.searchParams));
        }

        if (route.type === "query") {
          if (ctx.request.method === "HEAD") {
            ctx.response.status = 204;
          } else if (ctx.request.method === "GET") {
            output = await route.handler(ctx, { params, input: undefined });
          } else {
            throw new XRPCError(
              "MethodNotImplemented",
              `${ctx.request.method} not implemented for ${lxm}`,
            );
          }
        } else if (route.type === "procedure") {
          let input = undefined;
          if (route.parseInput) {
            const jsonBody = await ctx.request.body.json();
            input = route.parseInput(jsonBody);
          }
          output = await route.handler(ctx, { params, input });
        }

        if (output !== undefined) {
          if (route.parseOutput) output = route.parseOutput(output);

          ctx.response.status = 200;
          ctx.response.type = "application/json";
          ctx.response.body = output;
        }
      } catch (err) {
        if (err instanceof XRPCError) {
          ctx.response.status = ERROR_TYPES[err.error];
          ctx.response.type = "application/json";
          ctx.response.body = {
            error: err.error,
            message: err.message,
            ...err.extra,
          };
        } else {
          ctx.response.status = 500;
          ctx.response.type = "application/json";
          ctx.response.body = {
            error: "InternalServerError",
            message: "Internal Server Error",
          };

          logging.warn("[xrpc] unhandled error: " + err);
        }
      }
    };
  }
}
