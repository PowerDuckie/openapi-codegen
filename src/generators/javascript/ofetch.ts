import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/javascript/ofetch";

export default createGenerator("javascript", "ofetch", (request) => emit(request));
