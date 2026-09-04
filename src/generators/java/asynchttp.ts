import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/java/asynchttp";

export default createGenerator("java", "asynchttp", (request) => emit(request));
