import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/python/httpx-sync";

export default createGenerator("python", "httpx-sync", (request) => emit(request));
