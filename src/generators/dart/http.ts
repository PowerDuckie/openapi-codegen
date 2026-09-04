import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/dart/http";

export default createGenerator("dart", "http", (request) => emit(request));
