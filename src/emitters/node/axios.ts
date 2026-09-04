import { emit as emitBrowserAxios } from "../javascript/axios";
import type { RequestIR } from "../../types";
export function emit(request: RequestIR): string {
  return emitBrowserAxios(request);
}
