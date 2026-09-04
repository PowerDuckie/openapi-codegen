import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/ruby/net-http";

export default createGenerator("ruby", "net-http", (request) => emit(request));
