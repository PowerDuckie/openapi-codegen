import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/fsharp/httpclient";

export default createGenerator("fsharp", "httpclient", (request) => emit(request));
