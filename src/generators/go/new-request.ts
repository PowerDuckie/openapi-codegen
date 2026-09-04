import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/go/new-request";

export default createGenerator("go", "new-request", (request) => emit(request));
