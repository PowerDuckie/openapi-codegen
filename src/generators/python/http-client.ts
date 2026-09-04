import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/python/http-client";

export default createGenerator("python", "http-client", (request) => emit(request));
