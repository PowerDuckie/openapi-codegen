import type { Generator, RequestIR } from "../types";
export type GeneratorEmitter = (request: RequestIR) => string;
export function createGenerator(
  language: string,
  client: string,
  emit: GeneratorEmitter,
): Generator {
  return {
    language,
    client,
    generate(request: RequestIR): string {
      return emit(request);
    },
  };
}
