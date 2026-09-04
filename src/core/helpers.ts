import type { FileValue, Parameter, RequestIR } from "../types";

export const DEFAULT_FILE_PATH = "/tmp/file.bin";
export const DEFAULT_FILE_NAME = "file.bin";
export const DEFAULT_BINARY_MEDIA_TYPE = "application/octet-stream";

/** Normalize a header name for case-insensitive comparison. */
function normalizeHeaderName(name: string): string {
  return String(name).trim().toLowerCase();
}

export function isContentTypeHeader(name: string): boolean {
  return normalizeHeaderName(name) === "content-type";
}

export function isContentLengthHeader(name: string): boolean {
  return normalizeHeaderName(name) === "content-length";
}

export function isTransferEncodingHeader(name: string): boolean {
  return normalizeHeaderName(name) === "transfer-encoding";
}

/** Normalize an HTTP method to uppercase, falling back to GET. */
export function normalizeMethod(method: string): string {
  const value = String(method ?? "")
    .trim()
    .toUpperCase();

  return value || "GET";
}

/** True when the generator permits a request body for the method. */
export function supportsRequestBody(method: string): boolean {
  const verb = normalizeMethod(method);
  return verb !== "GET" && verb !== "HEAD";
}

/**
 * True when generator policy supplies a body for the method, using an empty
 * body when one was not provided.
 */
export function requiresRequestBody(method: string): boolean {
  const verb = normalizeMethod(method);
  return verb === "POST" || verb === "PUT" || verb === "PATCH";
}

/** Return a nonblank string, or undefined. */
export function nonBlankString(value: unknown): string | undefined;

/** Return a nonblank string, or the supplied fallback. */
export function nonBlankString(value: unknown, fallback: string): string;

export function nonBlankString(
  value: unknown,
  fallback?: string,
): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : fallback;
}

/**
 * Resolve the effective media type:
 * body.mediaType, then the first nonblank Content-Type header, then fallback.
 */
export function mediaTypeOf(request: RequestIR, fallback: string): string {
  const bodyMediaType = nonBlankString(request.body?.mediaType);
  if (bodyMediaType !== undefined) return bodyMediaType.trim();

  const rawHeaders: unknown = request.headers;
  if (!rawHeaders) return fallback;

  const pairs: Array<[unknown, unknown]> = Array.isArray(rawHeaders)
    ? (rawHeaders as Array<[unknown, unknown]>)
    : Object.entries(rawHeaders as Record<string, unknown>);

  for (const [key, rawValue] of pairs) {
    if (!isContentTypeHeader(String(key))) continue;

    const values = Array.isArray(rawValue) ? rawValue : [rawValue];

    for (const candidate of values) {
      if (candidate == null) continue;

      const value = String(candidate).trim();
      if (value) return value;
    }
  }

  return fallback;
}

/** Return the normalized media type without parameters. */
function requestMediaType(request: RequestIR): string {
  return mediaTypeOf(request, "").split(";", 1)[0].trim().toLowerCase();
}

/** True if the effective media type belongs to the JSON family. */
export function hasJsonBody(request: RequestIR): boolean {
  const mediaType = requestMediaType(request);
  return mediaType === "application/json" || mediaType.endsWith("+json");
}

/** True if the effective media type is URL-encoded form data. */
export function hasFormBody(request: RequestIR): boolean {
  return requestMediaType(request) === "application/x-www-form-urlencoded";
}

/** True if the effective media type is multipart form data. */
export function hasMultipartBody(request: RequestIR): boolean {
  return requestMediaType(request) === "multipart/form-data";
}

/** Safely serialize a value as compact JSON with a string fallback. */
function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

/** Serialize primitive and structured values for generated string literals. */
export function kotlinValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return compactJson(value);
}

/** Convert an unknown value into a form or multipart field string. */
export function formFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  return compactJson(value);
}

/** Sanitize text intended for a generated source-code comment. */
function sanitizeCommentText(value: unknown): string {
  return String(value)
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ");
}

/**
 * Build comment text for a placeholder multipart path.
 * The caller must add the target language's comment delimiters.
 */
export function fileComment(path: string, fieldName: string): string {
  return (
    `TODO: replace ${sanitizeCommentText(path)} with the real local file ` +
    `path for multipart field ${sanitizeCommentText(fieldName)}`
  );
}

/** Type guard for a plain, non-array object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Type guard for the internal multipart-file marker shape. */
export function isFileValue(value: unknown): value is FileValue {
  return isRecord(value) && Boolean(value.__file);
}

export function assertIsRecord(
  value: unknown,
  message = "Expected plain record object",
): asserts value is Record<string, unknown> {
  if (!isRecord(value)) throw new TypeError(message);
}

export function assertIsString(
  value: unknown,
  message = "Expected string",
): asserts value is string {
  if (typeof value !== "string") throw new TypeError(message);
}

export function assertIsNumber(
  value: unknown,
  message = "Expected finite number",
): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(message);
  }
}

/** Pretty-print a value as JSON, with safe fallbacks. */
export function stringifyLiteral(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return JSON.stringify(String(value));
  }
}

export function escapeJs(value: string): string {
  return JSON.stringify(String(value));
}

export function escapePy(value: string): string {
  return JSON.stringify(String(value));
}

export function escapeSh(value: string): string {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

export function escapePhp(value: string): string {
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function escapeRuby(value: string): string {
  const text = String(value);

  if (text.includes("\n")) {
    return `%Q{${text.replace(/\\/g, "\\\\").replace(/}/g, "\\}").replace(/\$/g, "\\$")}}`;
  }

  return `'${text.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export function escapePowerShell(value: string): string {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function escapeCSharp(value: string): string {
  return `@"${String(value).replace(/"/g, '""')}"`;
}

export function escapeJava(value: string): string {
  return JSON.stringify(String(value))
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function escapeGo(value: string): string {
  return JSON.stringify(String(value));
}

export function escapeRust(value: string): string {
  return JSON.stringify(String(value));
}

export function escapeObjC(value: string): string {
  return `@${JSON.stringify(String(value))}`;
}

export function escapeSwift(value: string): string {
  return JSON.stringify(String(value));
}

export function escapeR(value: string): string {
  return JSON.stringify(String(value));
}

export function escapeOCaml(value: string): string {
  return JSON.stringify(String(value));
}

export function escapeFSharp(value: string): string {
  return JSON.stringify(String(value));
}

export function escapeClojure(value: string): string {
  return JSON.stringify(String(value));
}

/**
 * Convert headers into an object.
 *
 * Duplicate names are overwritten by the last value because the target shape
 * cannot represent repeated headers.
 */
export function toHeaderObject(
  headers: Array<[string, string]>,
): Record<string, string> {
  const output: Record<string, string> = {};

  for (const [name, value] of headers) {
    output[name] = value;
  }

  return output;
}

/** Flatten a multipart body into ordered field descriptors. */
export function toKeyValueBody(
  value: unknown,
): Array<{ name: string; value: unknown; file: boolean }> {
  if (!isRecord(value)) return [];

  const entries: Array<{
    name: string;
    value: unknown;
    file: boolean;
  }> = [];

  for (const [name, entry] of Object.entries(value)) {
    if (Array.isArray(entry)) {
      for (const item of entry) {
        entries.push({
          name,
          value: item,
          file: isFileValue(item),
        });
      }
    } else {
      entries.push({
        name,
        value: entry,
        file: isFileValue(entry),
      });
    }
  }

  return entries;
}

/** Indent every nonempty line with the given prefix. */
export function indent(text: string, prefix = "  "): string {
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? `${prefix}${line}` : line))
    .join("\n");
}

/** Convert arbitrary text into a valid basic identifier. */
export function sanitizeIdentifier(value: string): string {
  const cleaned = String(value).replace(/[^A-Za-z0-9_]/g, "_");
  const candidate = /^[0-9]/.test(cleaned) ? `_${cleaned}` : cleaned;

  return candidate || "value";
}

/** Generate a function or variable name from the method and path template. */
export function operationName(request: RequestIR): string {
  const verb = normalizeMethod(request.method).toLowerCase();
  const rawPath = typeof request.path === "string" ? request.path : "";

  const path = rawPath
    .replace(/\{([^}]+)\}/g, "_by_$1")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();

  return sanitizeIdentifier(path ? `${verb}_${path}` : `${verb}_request`);
}

/** Return raw body text or serialize a structured value once. */
export function bodyText(request: RequestIR): string {
  if (!request.body) return "";

  const raw = request.body.value;
  if (typeof raw === "string") return raw;

  try {
    return JSON.stringify(raw, null, 2) ?? "";
  } catch {
    return String(raw ?? "");
  }
}

/** Filter parameters by their OpenAPI location. */
export function collectByLocation(
  request: RequestIR,
  location: Parameter["in"],
): Parameter[] {
  const parameters = Array.isArray(request.parameters)
    ? request.parameters
    : [];

  return parameters.filter((parameter) => parameter.in === location);
}

/** Return the first value that is not undefined. */
export function firstDefined<T>(
  ...values: Array<T | undefined>
): T | undefined {
  for (const value of values) {
    if (value !== undefined) return value;
  }

  return undefined;
}

/** Perform a lightweight structural check of an OpenAPI document. */
export function lightweightOpenAPIPreCheck(doc: unknown): string[] {
  const warnings: string[] = [];

  if (!isRecord(doc)) {
    warnings.push("OpenAPI document root must be a plain object");
    return warnings;
  }

  if (typeof doc.openapi !== "string") {
    warnings.push("Missing or non-string openapi version field");
  }

  if (!isRecord(doc.info)) {
    warnings.push("info object missing or not an object");
  }

  if (doc.paths !== undefined && !isRecord(doc.paths)) {
    warnings.push("paths must be an object when defined");
  }

  if (doc.components !== undefined && !isRecord(doc.components)) {
    warnings.push("components must be an object when defined");
  }

  return warnings;
}

/**
 * Shallowly merge allOf schemas.
 *
 * Boolean schema true is ignored; false invalidates the merge. Properties are
 * merged, required entries are deduplicated, and composition arrays are
 * concatenated.
 */
export function mergeAllOfSchemas(
  schemas: unknown[],
  resolver: { deref: (value: unknown) => unknown },
): Record<string, unknown> | undefined {
  const collected: Record<string, unknown> = {};

  for (const rawSchema of schemas) {
    const resolved = resolver.deref(rawSchema);

    if (resolved === false) return undefined;
    if (resolved === true || !isRecord(resolved)) continue;

    for (const [key, value] of Object.entries(resolved)) {
      if (key === "properties") {
        if (!isRecord(value)) continue;

        const existing = isRecord(collected.properties)
          ? collected.properties
          : {};

        collected.properties = {
          ...existing,
          ...value,
        };

        continue;
      }

      if (key === "required") {
        if (!Array.isArray(value)) continue;

        const required = new Set<string>(
          Array.isArray(collected.required)
            ? collected.required.filter(
                (item): item is string => typeof item === "string",
              )
            : [],
        );

        for (const item of value) {
          if (typeof item === "string") required.add(item);
        }

        collected.required = [...required];
        continue;
      }

      if (key === "type") {
        const types = new Set<string>();
        const existing = collected.type;

        if (typeof existing === "string") {
          types.add(existing);
        } else if (Array.isArray(existing)) {
          for (const item of existing) {
            if (typeof item === "string") types.add(item);
          }
        }

        if (typeof value === "string") {
          types.add(value);
        } else if (Array.isArray(value)) {
          for (const item of value) {
            if (typeof item === "string") types.add(item);
          }
        }

        if (types.size === 1) {
          collected.type = [...types][0];
        } else if (types.size > 1) {
          collected.type = [...types];
        }

        continue;
      }

      if (key === "allOf" || key === "oneOf" || key === "anyOf") {
        if (!Array.isArray(value)) continue;

        const existing = Array.isArray(collected[key])
          ? (collected[key] as unknown[])
          : [];

        collected[key] = [...existing, ...value];
        continue;
      }

      collected[key] = value;
    }
  }

  return Object.keys(collected).length > 0 ? collected : undefined;
}

/**
 * Return true for headers forbidden or controlled by browser networking APIs.
 * Content-Type is handled separately because it is valid for non-multipart
 * request bodies.
 */
export function isBrowserForbiddenHeader(name: string): boolean {
  const normalized = normalizeHeaderName(name);

  switch (normalized) {
    case "accept-charset":
    case "accept-encoding":
    case "access-control-request-headers":
    case "access-control-request-method":
    case "connection":
    case "content-length":
    case "cookie":
    case "cookie2":
    case "date":
    case "dnt":
    case "expect":
    case "host":
    case "keep-alive":
    case "origin":
    case "permissions-policy":
    case "referer":
    case "te":
    case "trailer":
    case "transfer-encoding":
    case "upgrade":
    case "via":
      return true;
    default:
      return normalized.startsWith("proxy-") || normalized.startsWith("sec-");
  }
}

/** Remove headers rejected by browser APIs or generated for multipart bodies. */
export function browserHeaders(
  headers: Array<[string, string]>,
  multipart: boolean,
): Array<[string, string]> {
  return headers.filter(([name]) => {
    if (isBrowserForbiddenHeader(name)) return false;
    return !multipart || !isContentTypeHeader(name);
  });
}
