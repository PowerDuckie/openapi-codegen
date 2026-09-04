import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/javascript/axios";

export default createGenerator("javascript", "axios", (request) => emit(request));
