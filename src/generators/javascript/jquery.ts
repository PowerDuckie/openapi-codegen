import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/javascript/jquery";

export default createGenerator("javascript", "jquery", (request) => emit(request));
