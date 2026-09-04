import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/javascript/fetch";

export default createGenerator("javascript", "fetch", (request) => emit(request));
