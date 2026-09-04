import { emit as emitBrowserOfetch } from "../javascript/ofetch";
import type { RequestIR } from "../../types";
export function emit(request: RequestIR): string {
  return emitBrowserOfetch(request);
}
