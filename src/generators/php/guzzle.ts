import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/php/guzzle";

export default createGenerator("php", "guzzle", (request) => emit(request));
