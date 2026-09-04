import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/shell/curl";

export default createGenerator("shell", "curl", (request) => emit(request));
