import { example, ExampleGenContext } from "./example";
import { RefResolver } from "./refs";
import { isRecord, firstDefined, lightweightOpenAPIPreCheck } from "./helpers";

/** local type-assert helper, moved to module top-level to avoid nested-function TS error */
function assertIsRecord(v: unknown): asserts v is Record<string, unknown> {
  if (!isRecord(v)) throw new TypeError("expected record object");
}

function pickContent(
  content: Record<string, unknown> | undefined,
): [string, unknown] | undefined {
  if (!content) {
    return undefined;
  }
  const entries = Object.entries(content);
  const preferred = [
    /^application\/([a-z0-9.+-]+\+)?json(?:;.*)?$/i,
    /^application\/x-www-form-urlencoded(?:;.*)?$/i,
    /^multipart\/form-data(?:;.*)?$/i,
    /^text\//i,
    /^application\/octet-stream(?:;.*)?$/i,
  ];
  for (const matcher of preferred) {
    const match = entries.find(([mediaType]) => matcher.test(mediaType));
    if (match) {
      return match;
    }
  }
  return entries[0];
}

function mergeParameters(
  pathParameters: unknown[],
  operationParameters: unknown[],
  resolver: RefResolver,
): unknown[] {
  const merged = new Map<string, unknown>();
  for (const entry of [...pathParameters, ...operationParameters]) {
    const parameter = resolver.deref(entry);
    if (!isRecord(parameter)) continue;
    const nameVal = parameter.name;
    const inVal = parameter.in;
    if (typeof nameVal !== "string" || typeof inVal !== "string") continue;
    const key = `${inVal}:${nameVal}`;
    if (!merged.has(key)) {
      merged.set(key, parameter);
    }
  }
  return [...merged.values()];
}

/**
 * Read example value from MediaType Object following OAS3.2 semantics.
 * Priority: mediaTypeObject.example → mediaTypeObject.examples map first entry value → schema-derived example
 */
/**
 * Read example value from MediaType Object following OAS3.2 semantics.
 * Priority: mediaTypeObject.example → mediaTypeObject.examples map first entry value → schema‑derived example
 */
function readExampleForMediaType(
  mediaTypeObject: unknown,
  resolver: RefResolver,
  ctx: ExampleGenContext,
): unknown {
  if (!isRecord(mediaTypeObject)) return undefined;
  if (mediaTypeObject.example !== undefined) {
    return mediaTypeObject.example;
  }
  if (isRecord(mediaTypeObject.examples)) {
    const first = Object.values(mediaTypeObject.examples)[0];
    if (first !== undefined) {
      const resolvedExampleObj = resolver.deref(first);
      if (
        isRecord(resolvedExampleObj) &&
        resolvedExampleObj.value !== undefined
      ) {
        return resolvedExampleObj.value;
      }
    }
  }
  return example(mediaTypeObject.schema, resolver, undefined, 0, ctx);
}

/**
 * Read first ExampleObject.value from examples map (parameter / media-type examples map).
 * Resolves $ref on example object.
 */
function readFirstExampleValue(
  examples: unknown,
  resolver: RefResolver,
): unknown {
  if (!isRecord(examples)) {
    return undefined;
  }
  const firstEntry = Object.values(examples)[0];
  if (firstEntry === undefined) {
    return undefined;
  }
  const resolved = resolver.deref(firstEntry);
  return isRecord(resolved) ? resolved.value : undefined;
}

export function normalize(options: {
  document: unknown;
  path: string;
  method: string;
  serverUrl?: string;
  securityValues?: Record<string, string>;
  softRefMode?: boolean;
}) {
  const root = options.document;
  const preWarnings = lightweightOpenAPIPreCheck(root);
  const resolver = new RefResolver(root, !!options.softRefMode);

  // narrow type once, reduce repeated casting
  const rootRec = isRecord(root) ? root : undefined;
  const paths = rootRec?.paths;

  let pathItem: unknown;
  if (isRecord(paths)) {
    pathItem = resolver.deref(paths[options.path]);
  }

  const methodLower = String(options.method).toLowerCase();
  const operation = isRecord(pathItem)
    ? resolver.deref(pathItem[methodLower])
    : undefined;

  if (!isRecord(operation)) {
    throw new Error("Operation not found");
  }

  const pathItemParams =
    isRecord(pathItem) && Array.isArray(pathItem.parameters)
      ? (pathItem.parameters as unknown[])
      : [];
  const opParams = Array.isArray(operation.parameters)
    ? (operation.parameters as unknown[])
    : [];

  const mergedParameters = mergeParameters(pathItemParams, opParams, resolver);

  const parameterEntries = mergedParameters.map((parameter) => {
    assertIsRecord(parameter);
    return {
      name: String(parameter.name),
      in: String(parameter.in),
      value: firstDefined(
        parameter.example,
        readFirstExampleValue(parameter.examples, resolver),
        example(parameter.schema, resolver),
      ),
      style: typeof parameter.style === "string" ? parameter.style : undefined,
      explode:
        typeof parameter.explode === "boolean" ? parameter.explode : undefined,
      allowReserved:
        typeof parameter.allowReserved === "boolean"
          ? parameter.allowReserved
          : undefined,
    };
  });

  const requestBody = resolver.deref(operation.requestBody);
  const chosen = isRecord(requestBody)
    ? pickContent(requestBody.content as Record<string, unknown> | undefined)
    : undefined;

  // inside normalize(), body context (request body): skip readOnly, do NOT skip writeOnly
  const bodyCtx: ExampleGenContext = { isRequestBody: true, isResponse: false };

  const body = chosen
    ? {
        mediaType: chosen[0],
        value: readExampleForMediaType(chosen[1], resolver, bodyCtx),
        encoding: isRecord(chosen[1])
          ? (chosen[1] as Record<string, unknown>).encoding
          : undefined,
      }
    : undefined;

  const security: Array<{
    name: string;
    type: string;
    scheme?: string;
    in?: string;
    paramName?: string;
    value: string;
  }> = [];

  // fix ts(18046): narrow unknown to array
  let effectiveSecurity: unknown[] = [];
  if (Array.isArray(operation.security)) {
    effectiveSecurity = operation.security;
  } else if (rootRec && Array.isArray(rootRec.security)) {
    effectiveSecurity = rootRec.security;
  }

  // fix syntax error ?.[name] → ?.[xxx] is invalid; use intermediate variable
  const components = rootRec?.components;
  const securitySchemes = isRecord(components)
    ? components.securitySchemes
    : undefined;

  for (const requirement of effectiveSecurity) {
    if (!isRecord(requirement)) continue;
    for (const name of Object.keys(requirement)) {
      let scheme: unknown;
      if (isRecord(securitySchemes)) {
        scheme = resolver.deref(securitySchemes[name]);
      }
      if (!isRecord(scheme)) continue;
      security.push({
        name,
        type: String(scheme.type),
        scheme: typeof scheme.scheme === "string" ? scheme.scheme : undefined,
        in: typeof scheme.in === "string" ? scheme.in : undefined,
        paramName: typeof scheme.name === "string" ? scheme.name : undefined,
        value: options.securityValues?.[name] ?? `{{${name}}}`,
      });
    }
  }

  // resolve baseUrl
  let baseUrl = options.serverUrl;
  if (
    !baseUrl &&
    Array.isArray(operation.servers) &&
    isRecord(operation.servers[0])
  ) {
    baseUrl = String(operation.servers[0].url);
  }
  if (
    !baseUrl &&
    isRecord(pathItem) &&
    Array.isArray(pathItem.servers) &&
    isRecord(pathItem.servers[0])
  ) {
    baseUrl = String(pathItem.servers[0].url);
  }
  if (
    !baseUrl &&
    Array.isArray(rootRec?.servers) &&
    isRecord((rootRec?.servers as unknown[])[0])
  ) {
    baseUrl = String(
      ((rootRec?.servers as unknown[])[0] as Record<string, unknown>).url,
    );
  }
  if (!baseUrl) {
    baseUrl = "https://example.com";
  }

  return {
    preWarnings,
    method: String(options.method).toUpperCase(),
    baseUrl,
    path: options.path,
    parameters: parameterEntries,
    headers: parameterEntries.filter((parameter) => parameter.in === "header"),
    body,
    security,
  };
}
