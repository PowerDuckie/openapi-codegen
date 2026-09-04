import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/powershell/invoke-restmethod";

export default createGenerator("powershell", "invoke-restmethod", (request) => emit(request));
