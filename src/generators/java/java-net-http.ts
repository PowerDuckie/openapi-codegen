import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/java/java-net-http";

export default createGenerator("java", "java-net-http", (request) => emit(request));
