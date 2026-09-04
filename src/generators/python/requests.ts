import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/python/requests";

export default createGenerator("python", "requests", (request) => emit(request));
