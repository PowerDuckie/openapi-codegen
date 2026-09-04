export type Pair = [string, string];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value) && !(value as { __file?: boolean }).__file;

const isPrimitive = (value: unknown): value is string | number | boolean =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

const stringValue = (value: unknown): string => {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  return JSON.stringify(value);
};

function percentEncode(value: string, allowReserved = false): string {
  return allowReserved ? value : encodeURIComponent(value);
}

function cookieEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
}

function headerSanitize(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\0/g, "");
}

/**
 * Iterative flattenPairs, no recursion, avoid browser stack-overflow for deep nested payloads.
 * Replaces old recursive implementation.
 */
function flattenPairs(prefix: string, value: unknown, encode: (input: string) => string): Pair[] {
  const result: Pair[] = [];
  const stack: Array<{ prefix: string; value: unknown }> = [{ prefix, value }];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) continue;
    const { prefix: p, value: v } = item;

    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) {
        stack.push({ prefix: `${p}[${i}]`, value: v[i] });
      }
    } else if (isRecord(v)) {
      const entries = Object.entries(v);
      for (let i = entries.length - 1; i >= 0; i--) {
        const [k, val] = entries[i];
        stack.push({ prefix: `${p}[${k}]`, value: val });
      }
    } else {
      result.push([encode(p), encode(stringValue(v))]);
    }
  }
  return result;
}

export function parameter(parameter: {
  name: string;
  in: string;
  value: unknown;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
}): Pair[] {
  const style =
    parameter.style ??
    (parameter.in === "query" || parameter.in === "querystring" || parameter.in === "cookie" ? "form" : "simple");
  const explode = parameter.explode ?? (style === "form" || style === "deepObject");
  const allowReserved = Boolean(parameter.allowReserved);
  const value = parameter.value;
  if (value == null) {
    return [];
  }
  const encode =
    parameter.in === "cookie"
      ? (input: string) => cookieEncode(input)
      : parameter.in === "header"
        ? (input: string) => headerSanitize(input)
        : (input: string) => percentEncode(input, allowReserved);

  if (style === "deepObject" && isRecord(value)) {
    return flattenPairs(parameter.name, value, encode);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => encode(stringValue(item)));
    switch (style) {
      case "form":
        return explode ? items.map((item) => [encode(parameter.name), item]) : [[encode(parameter.name), items.join(",")]];
      case "spaceDelimited":
        return [[encode(parameter.name), items.join("%20")]];
      case "pipeDelimited":
        return [[encode(parameter.name), items.join("|")]];
      case "label":
        return [[encode(parameter.name), "." + items.join(explode ? "." : ",")]];
      case "matrix":
        return explode
          ? [[encode(parameter.name), items.map((item) => `;${parameter.name}=${item}`).join("")]]
          : [[encode(parameter.name), `;${parameter.name}=${items.join(",")}`]];
      case "simple":
      default:
        return [[encode(parameter.name), items.join(",")]];
    }
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).flatMap(([key, item]) => {
      return [[encode(key), encode(stringValue(item))]] as Pair[];
    });
    switch (style) {
      case "form":
        return explode ? entries : [[encode(parameter.name), entries.flat().join(",")]];
      case "simple":
        return [[encode(parameter.name), explode ? entries.map(([k, v]) => `${k}=${v}`).join(",") : entries.flat().join(",")]];
      case "label":
        return [[encode(parameter.name), "." + (explode ? entries.map(([k, v]) => `${k}=${v}`).join(".") : entries.flat().join("."))]];
      case "matrix":
        return [[encode(parameter.name), explode ? entries.map(([k, v]) => `;${k}=${v}`).join("") : `;${parameter.name}=${entries.flat().join(",")}`]];
      default:
        return [[encode(parameter.name), entries.flat().join(",")]];
    }
  }
  if (style === "label") {
    return [[encode(parameter.name), "." + encode(stringValue(value))]];
  }
  if (style === "matrix") {
    return [[encode(parameter.name), `;${parameter.name}=${encode(stringValue(value))}`]];
  }
  return [[encode(parameter.name), encode(stringValue(value))]];
}

export function query(pairs: Pair[]): string {
  return pairs.map(([key, value]) => `${key}=${value}`).join("&");
}

export function cookie(pairs: Pair[]): string {
  return pairs.map(([key, value]) => `${cookieEncode(key)}=${cookieEncode(value)}`).join("; ");
}

export function headerValue(value: string): string {
  return headerSanitize(value);
}
