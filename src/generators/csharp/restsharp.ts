import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/csharp/restsharp";

export default createGenerator("csharp", "restsharp", (request) => emit(request));
