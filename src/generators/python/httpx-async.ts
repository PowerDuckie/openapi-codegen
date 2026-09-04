import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/python/httpx-async";

export default createGenerator("python", "httpx-async", (request) => emit(request));
