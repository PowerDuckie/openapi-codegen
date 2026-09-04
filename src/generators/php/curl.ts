import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/php/curl";

export default createGenerator("php", "curl", (request) => emit(request));
