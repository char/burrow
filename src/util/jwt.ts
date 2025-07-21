import { fromBase64Url, toBase64Url } from "@atcute/multibase";
import { decodeUtf8From, encodeUtf8 } from "@atcute/uint8array";
import { safely } from "./safely.ts";

// decode a jwt's parts. does not verify signature
export function decodeJwt(jwt: string): {
  header: object;
  payload: object;
  signature: Uint8Array;
} {
  const [encodedHeader, encodedPayload, encodedSignature] = jwt.split(".");

  const header = safely(fromBase64Url)(encodedHeader)
    .unwrap(cause => new Error("failed to decode jwt header base64", { cause }))
    .$pipe(safely(decodeUtf8From))
    .unwrap(cause => new Error("failed to decode jwt header utf8", { cause }))
    .$pipe(safely(JSON.parse))
    .unwrap(cause => new Error("failed to parse jwt header json", { cause }));

  const payload = safely(fromBase64Url)(encodedPayload)
    .unwrap(cause => new Error("failed to decode jwt payload base64", { cause }))
    .$pipe(safely(decodeUtf8From))
    .unwrap(cause => new Error("failed to decode jwt payload utf8", { cause }))
    .$pipe(safely(JSON.parse))
    .unwrap(cause => new Error("failed to parse jwt payload json", { cause }));

  const signature = safely(fromBase64Url)(encodedSignature).unwrap(
    cause => new Error("failed to decode jwt signature base64", { cause }),
  );

  return { header, payload, signature };
}

export async function signJwtHS256(
  secretKey: Uint8Array,
  header: object,
  payload: object,
): Promise<string> {
  const message = `${header.$json}.${payload.$json}`;
  const alg = { name: "HMAC", hash: "SHA-256" };
  const signature = await crypto.subtle.sign(
    alg,
    await crypto.subtle.importKey("raw", secretKey, alg, false, ["sign"]),
    encodeUtf8(message),
  );
  return `${message}.${toBase64Url(new Uint8Array(signature))}`;
}

export async function verifyJwtHS256Signature(
  secretKey: Uint8Array,
  jwt: string,
): Promise<boolean> {
  const [header, payload, signature] = jwt.split(".");
  const message = `${header}.${payload}`;
  const alg = { name: "HMAC", hash: "SHA-256" };
  const expectedSignature = await crypto.subtle.sign(
    alg,
    await crypto.subtle.importKey("raw", secretKey, alg, false, ["sign"]),
    encodeUtf8(message),
  );
  return toBase64Url(new Uint8Array(expectedSignature)) === signature;
}
