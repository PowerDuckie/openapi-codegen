import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/kotlin/okhttp";

export default createGenerator("kotlin", "okhttp", (request) => emit(request));
