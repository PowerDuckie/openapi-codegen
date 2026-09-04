import type { Generator, Plugin } from "../types";

export interface PluginApi {
  register(generator: Generator): void;
}

export function applyPlugin(plugin: Plugin, api: PluginApi): void {
  plugin.register(api);
}
