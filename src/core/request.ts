import { cookie, headerValue, parameter, query } from "./serialize";
import type { Body, RequestIR } from "../types";

export interface CompiledRequest {
  url: string;
  headers: Array<[string, string]>;
  body?: Body;
  queryPairs: Array<[string, string]>;
  cookiePairs: Array<[string, string]>;
}

function trimSlashes(input: string): string {
  return input.replace(/\/+$/g, "");
}

function joinUrl(baseUrl: string, path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedBase = trimSlashes(baseUrl || "");
  if (!path.startsWith("/")) {
    path = "/" + path;
  }
  return normalizedBase + path;
}

export function compile(request: RequestIR): CompiledRequest {
  let path = request.path;
  for (const item of request.parameters.filter(
    (parameter) => parameter.in === "path",
  )) {
    const rendered = parameter(item)
      .map((pair) => pair[1])
      .join(",");
    path = path.replace(new RegExp(`\\{${item.name}\\}`, "g"), rendered);
  }

  const queryPairs = request.parameters
    .filter(
      (parameter) => parameter.in === "query" || parameter.in === "querystring",
    )
    .flatMap((item) => parameter(item));

  const headerPairs = request.headers.flatMap((header) => parameter(header));

  const cookiePairs = request.parameters
    .filter((parameter) => parameter.in === "cookie")
    .flatMap((item) => parameter(item));

  for (const security of request.security || []) {
    const rawValue = String(security.value ?? "");
    if (security.type === "apiKey") {
      if (security.in === "query") {
        queryPairs.push([
          encodeURIComponent(security.paramName || security.name),
          encodeURIComponent(rawValue),
        ]);
      } else if (security.in === "cookie") {
        cookiePairs.push([security.paramName || security.name, rawValue]);
      } else {
        headerPairs.push([
          security.paramName || security.name,
          headerValue(rawValue),
        ]);
      }
    } else if (security.type === "http" && security.scheme === "bearer") {
      headerPairs.push(["Authorization", headerValue(`Bearer ${rawValue}`)]);
    } else if (security.type === "http" && security.scheme === "basic") {
      headerPairs.push(["Authorization", headerValue(`Basic ${rawValue}`)]);
    }
  }

  if (cookiePairs.length > 0) {
    headerPairs.push(["Cookie", cookie(cookiePairs)]);
  }

  const url = joinUrl(request.baseUrl, path);
  const queryString = query(queryPairs);

  return {
    url: queryString ? `${url}?${queryString}` : url,
    headers: headerPairs,
    body: request.body,
    queryPairs,
    cookiePairs,
  };
}

export function form(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }
  const pairs: string[] = [];
  for (const [key, current] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (Array.isArray(current)) {
      for (const item of current) {
        pairs.push(
          `${encodeURIComponent(key)}=${encodeURIComponent(String(item ?? ""))}`,
        );
      }
      continue;
    }
    pairs.push(
      `${encodeURIComponent(key)}=${encodeURIComponent(String(current ?? ""))}`,
    );
  }
  return pairs.join("&");
}
