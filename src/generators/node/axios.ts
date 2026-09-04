import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/node/axios";

export default createGenerator("node", "axios", (request) => emit(request));
