import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/shell/wget";

export default createGenerator("shell", "wget", (request) => emit(request));
