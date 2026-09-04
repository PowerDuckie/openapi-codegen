import type { Generator } from "../types";

const store = new Map<string, Generator>();

function key(language: string, client: string): string {
  return `${language.toLowerCase()}\0${client.toLowerCase()}`;
}

export function registerGenerator(generator: Generator): void {
  store.set(key(generator.language, generator.client), generator);
}

export function getGenerator(language: string, client: string): Generator | undefined {
  return store.get(key(language, client));
}

export function listGenerators(): Array<{ language: string; client: string }> {
  return [...store.values()].map((item) => ({ language: item.language, client: item.client }));
}
