import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/python/aiohttp";

export default createGenerator("python", "aiohttp", (request) => emit(request));
