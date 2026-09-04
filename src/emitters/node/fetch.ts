import { emit as emitBrowserFetch } from "../javascript/fetch";
import type { RequestIR } from "../../types";
export function emit(request: RequestIR): string {
  return `import fetch from "node-fetch";\n\n${emitBrowserFetch(request)}`;
}
