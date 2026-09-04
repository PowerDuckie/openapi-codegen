import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/node/fetch";

export default createGenerator("node", "fetch", (request) => emit(request));
