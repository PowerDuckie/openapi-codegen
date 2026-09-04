export * from "./types";
export * from "./core/refs";
export * from "./core/example";
export * from "./core/serialize";
export * from "./core/generator";
export * from "./core/registry";
export * from "./core/plugin";
export * from "./core/request";
export { normalize } from "./core/normalize";
export { register, get, list, use, builtins } from "./registry";

import { builtins, get } from "./registry";
import { normalize } from "./core/normalize";
import type { GenerateOptions } from "./types";

builtins();

export function generate(options: GenerateOptions): string {
  const generator = get(options.language, options.client);
  if (!generator) {
    throw new Error(`Unsupported generator: ${options.language}/${options.client}`);
  }

  const request = options.request ?? normalize(options);
  return generator.generate(request);
}
