import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/shell/httpie";

export default createGenerator("shell", "httpie", (request) => emit(request));
