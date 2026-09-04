import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/csharp/restsharp";

export default createGenerator("csharp", "httpclient", (request) => emit(request));
