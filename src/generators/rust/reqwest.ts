import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/rust/reqwest";

export default createGenerator("rust", "reqwest", (request) => emit(request));
