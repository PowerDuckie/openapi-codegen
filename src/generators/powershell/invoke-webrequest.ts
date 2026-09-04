import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/powershell/invoke-webrequest";

export default createGenerator("powershell", "invoke-webrequest", (request) => emit(request));
