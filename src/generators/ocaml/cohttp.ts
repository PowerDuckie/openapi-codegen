import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/ocaml/cohttp";

export default createGenerator("ocaml", "cohttp", (request) => emit(request));
