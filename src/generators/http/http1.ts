import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/http/http1";

export default createGenerator("http", "http1", (request) => emit(request));
