import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/objc/nsurlsession";

export default createGenerator("objc", "nsurlsession", (request) => emit(request));
