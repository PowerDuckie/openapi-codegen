import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/node/ofetch";

export default createGenerator("node", "ofetch", (request) => emit(request));
