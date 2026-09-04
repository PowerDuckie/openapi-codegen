/**
 * Shared type definitions for OpenAPI3.2 code-generation library
 * Browser-compatible, compliant with OAS 3.2 specification
 */
export type ParameterLocation =
  | "path"
  | "query"
  | "querystring"
  | "header"
  | "cookie";

export interface FileValue {
  __file: true;
  path?: string;
  name?: string;
  contentType?: string;
  data?: string | ArrayBuffer | Uint8Array | Blob;
}

export interface Parameter {
  name: string;
  in: ParameterLocation;
  value: unknown;
  style?: string;
  explode?: boolean;
  allowReserved?: boolean;
}

export interface Body {
  mediaType: string;
  value: unknown;
  encoding?: Record<string, unknown>;
}

export interface Security {
  name: string;
  type: string;
  scheme?: string;
  in?: string;
  paramName?: string;
  value: string;
}

export interface RequestIR {
  method: string;
  baseUrl: string;
  path: string;
  parameters: Parameter[];
  headers: Parameter[];
  body?: Body;
  security: Security[];
}

export interface GenerateResult {
  code: string;
  files?: Record<string, string>;
  metadata?: Record<string, unknown>;
}

export interface Generator {
  language: string;
  client: string;
  generate(request: RequestIR): string;
}

export interface Plugin {
  name: string;
  register(api: { register(generator: Generator): void }): void;
}

export interface GenerateOptions {
  language: string;
  client: string;
  request?: RequestIR;
  document?: unknown;
  path?: string;
  method?: string;
  serverUrl?: string;
  securityValues?: Record<string, string>;
  softRefMode?: boolean;
}
