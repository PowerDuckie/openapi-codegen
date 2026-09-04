import { example, type ExampleGenContext } from "./example";
import { RefResolver } from "./refs";
import { firstDefined, isRecord, lightweightOpenAPIPreCheck } from "./helpers";

const HTTP_METHODS = new Set([
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
]);

const CONTENT_PREFERENCES: RegExp[] = [
  /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;.*)?$/i,
  /^application\/x-www-form-urlencoded(?:\s*;.*)?$/i,
  /^multipart\/form-data(?:\s*;.*)?$/i,
  /^text\/[a-z0-9.+-]+(?:\s*;.*)?$/i,
  /^application\/octet-stream(?:\s*;.*)?$/i,
];

interface NormalizeOptions {
  document: unknown;
  path: string;
  method: string;
  serverUrl?: string;
  securityValues?: Record<string, string>;
  softRefMode?: boolean;
}

interface NormalizedParameter {
  name: string;
  in: string;
  value: unknown;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
}

interface NormalizedSecurity {
  name: string;
  type: string;
  scheme?: string;
  in?: string;
  paramName?: string;
  value: string;
}

function own(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function nonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normalizeMethod(value: unknown): string {
  const method = nonBlankString(value)?.toLowerCase();

  if (!method || !HTTP_METHODS.has(method)) {
    throw new Error(`Unsupported HTTP method: ${String(value)}`);
  }

  return method;
}

function pickContent(content: unknown): [string, unknown] | undefined {
  if (!isRecord(content)) return undefined;

  const entries = Object.entries(content).filter(
    ([mediaType]) => mediaType.trim().length > 0,
  );

  for (const matcher of CONTENT_PREFERENCES) {
    const match = entries.find(([mediaType]) => matcher.test(mediaType.trim()));
    if (match) return match;
  }

  return entries[0];
}

/**
 * Merge path-level and operation-level parameters.
 *
 * OpenAPI defines a parameter's identity as the combination of `name` and
 * `in`. Operation-level parameters override path-level parameters.
 */
function mergeParameters(
  pathParameters: unknown,
  operationParameters: unknown,
  resolver: RefResolver,
): Record<string, unknown>[] {
  const merged = new Map<string, Record<string, unknown>>();

  const add = (entries: unknown, overwrite: boolean): void => {
    if (!Array.isArray(entries)) return;

    for (const entry of entries) {
      const parameter = resolver.deref(entry);
      if (!isRecord(parameter)) continue;

      const name = nonBlankString(parameter.name);
      const location = nonBlankString(parameter.in)?.toLowerCase();

      if (!name || !location) continue;

      const key = `${location}\u0000${name}`;
      if (overwrite || !merged.has(key)) {
        merged.set(key, parameter);
      }
    }
  };

  add(pathParameters, false);
  add(operationParameters, true);

  return [...merged.values()];
}

/**
 * Read the first usable value from an OpenAPI examples map.
 *
 * Example Object references are resolved. Inline Example Objects and direct
 * values are both accepted for resilience.
 */
function readFirstExampleValue(
  examples: unknown,
  resolver: RefResolver,
): unknown {
  if (!isRecord(examples)) return undefined;

  for (const entry of Object.values(examples)) {
    const resolved = resolver.deref(entry);

    if (isRecord(resolved) && own(resolved, "value")) {
      return resolved.value;
    }

    if (!isRecord(resolved) && resolved !== undefined) {
      return resolved;
    }
  }

  return undefined;
}

/**
 * Select a request example according to OpenAPI precedence:
 * Media Type Object `example`, first usable `examples` entry, then schema.
 */
function readExampleForMediaType(
  mediaTypeObject: unknown,
  resolver: RefResolver,
  context: ExampleGenContext,
): unknown {
  const resolved = resolver.deref(mediaTypeObject);
  if (!isRecord(resolved)) return undefined;

  if (own(resolved, "example")) {
    return resolved.example;
  }

  const examplesValue = readFirstExampleValue(resolved.examples, resolver);
  if (examplesValue !== undefined) {
    return examplesValue;
  }

  return example(resolved.schema, resolver, undefined, 0, context);
}

function resolveServerUrl(server: unknown): string | undefined {
  if (!isRecord(server)) return undefined;

  let url = nonBlankString(server.url);
  if (!url) return undefined;

  const variables = isRecord(server.variables) ? server.variables : undefined;

  url = url.replace(/\{([^{}]+)\}/g, (placeholder, variableName: string) => {
    if (!variables) return placeholder;

    const variable = variables[variableName];
    if (!isRecord(variable)) return placeholder;

    const value = firstDefined(variable.default, variable.example);
    return value === undefined
      ? placeholder
      : encodeURIComponent(String(value));
  });

  return url;
}

function firstServerUrl(servers: unknown): string | undefined {
  if (!Array.isArray(servers)) return undefined;

  for (const server of servers) {
    const url = resolveServerUrl(server);
    if (url) return url;
  }

  return undefined;
}

function resolveBaseUrl(
  explicitServerUrl: unknown,
  operation: Record<string, unknown>,
  pathItem: Record<string, unknown>,
  root: Record<string, unknown>,
): string {
  return (
    nonBlankString(explicitServerUrl) ??
    firstServerUrl(operation.servers) ??
    firstServerUrl(pathItem.servers) ??
    firstServerUrl(root.servers) ??
    "https://example.com"
  );
}

function resolveSecuritySchemes(
  root: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!isRecord(root.components)) return undefined;
  return isRecord(root.components.securitySchemes)
    ? root.components.securitySchemes
    : undefined;
}

function normalizeSecurity(
  root: Record<string, unknown>,
  operation: Record<string, unknown>,
  resolver: RefResolver,
  securityValues: Record<string, string> | undefined,
): NormalizedSecurity[] {
  /*
   * An operation-level empty security array explicitly disables inherited
   * root security.
   */
  const requirements = Array.isArray(operation.security)
    ? operation.security
    : Array.isArray(root.security)
      ? root.security
      : [];

  const schemes = resolveSecuritySchemes(root);
  if (!schemes) return [];

  const result: NormalizedSecurity[] = [];
  const seen = new Set<string>();

  /*
   * Security Requirement Objects are alternatives, while properties within
   * one object are combined. This normalized representation remains flat for
   * compatibility with existing emitters.
   */
  for (const requirement of requirements) {
    if (!isRecord(requirement)) continue;

    for (const name of Object.keys(requirement)) {
      if (seen.has(name)) continue;

      const scheme = resolver.deref(schemes[name]);
      if (!isRecord(scheme)) continue;

      const type = nonBlankString(scheme.type);
      if (!type) continue;

      seen.add(name);
      result.push({
        name,
        type,
        scheme: nonBlankString(scheme.scheme)?.toLowerCase(),
        in: nonBlankString(scheme.in)?.toLowerCase(),
        paramName: nonBlankString(scheme.name),
        value: securityValues?.[name] ?? `{{${name}}}`,
      });
    }
  }

  return result;
}

export function normalize(options: NormalizeOptions) {
  if (!isRecord(options)) {
    throw new TypeError("normalize options must be an object");
  }

  if (!isRecord(options.document)) {
    throw new TypeError("OpenAPI document root must be a plain object");
  }

  const root = options.document;
  const preWarnings = lightweightOpenAPIPreCheck(root);
  const resolver = new RefResolver(root, options.softRefMode === true);

  const path = nonBlankString(options.path);
  if (!path) {
    throw new TypeError("OpenAPI path must be a non-empty string");
  }

  const method = normalizeMethod(options.method);

  if (!isRecord(root.paths)) {
    throw new Error("OpenAPI document does not define a valid paths object");
  }

  if (!own(root.paths, path)) {
    throw new Error(`Path not found: ${path}`);
  }

  const pathItem = resolver.deref(root.paths[path]);
  if (!isRecord(pathItem)) {
    throw new Error(`Invalid Path Item Object: ${path}`);
  }

  const operation = resolver.deref(pathItem[method]);
  if (!isRecord(operation)) {
    throw new Error(`Operation not found: ${method.toUpperCase()} ${path}`);
  }

  const mergedParameters = mergeParameters(
    pathItem.parameters,
    operation.parameters,
    resolver,
  );

  const parameters: NormalizedParameter[] = mergedParameters.map(
    (parameter) => {
      const name = nonBlankString(parameter.name);
      const location = nonBlankString(parameter.in)?.toLowerCase();

      if (!name || !location) {
        throw new TypeError("Resolved parameter must define name and in");
      }

      const parameterExample = own(parameter, "example")
        ? parameter.example
        : undefined;

      return {
        name,
        in: location,
        value: firstDefined(
          parameterExample,
          readFirstExampleValue(parameter.examples, resolver),
          example(parameter.schema, resolver),
        ),
        style: nonBlankString(parameter.style),
        explode:
          typeof parameter.explode === "boolean"
            ? parameter.explode
            : undefined,
        allowReserved:
          typeof parameter.allowReserved === "boolean"
            ? parameter.allowReserved
            : undefined,
      };
    },
  );

  const requestBody = resolver.deref(operation.requestBody);
  const chosen = isRecord(requestBody)
    ? pickContent(requestBody.content)
    : undefined;

  const bodyContext: ExampleGenContext = {
    isRequestBody: true,
    isResponse: false,
  };

  let body:
    | {
        mediaType: string;
        value: unknown;
        encoding?: unknown;
      }
    | undefined;

  if (chosen) {
    const mediaTypeObject = resolver.deref(chosen[1]);

    body = {
      mediaType: chosen[0],
      value: readExampleForMediaType(mediaTypeObject, resolver, bodyContext),
      encoding: isRecord(mediaTypeObject)
        ? mediaTypeObject.encoding
        : undefined,
    };
  }

  const security = normalizeSecurity(
    root,
    operation,
    resolver,
    options.securityValues,
  );

  const baseUrl = resolveBaseUrl(options.serverUrl, operation, pathItem, root);

  return {
    preWarnings,
    method: method.toUpperCase(),
    baseUrl,
    path,
    parameters,
    headers: parameters.filter((parameter) => parameter.in === "header"),
    body,
    security,
  };
}
