import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/javascript/xhr";

export default createGenerator("javascript", "xhr", (request) => emit(request));
