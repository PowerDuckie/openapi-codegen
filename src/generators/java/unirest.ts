import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/java/unirest";

export default createGenerator("java", "unirest", (request) => emit(request));
