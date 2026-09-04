import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/r/httr2";

export default createGenerator("r", "httr2", (request) => emit(request));
