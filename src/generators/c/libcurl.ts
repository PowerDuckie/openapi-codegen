import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/c/libcurl";

export default createGenerator("c", "libcurl", (request) => emit(request));
