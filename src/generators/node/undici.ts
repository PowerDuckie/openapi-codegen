import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/node/undici";

export default createGenerator("node", "undici", (request) => emit(request));
