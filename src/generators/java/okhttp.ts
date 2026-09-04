import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/java/okhttp";

export default createGenerator("java", "okhttp", (request) => emit(request));
