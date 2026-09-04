import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/swift/nsurlsession";

export default createGenerator("swift", "nsurlsession", (request) => emit(request));
