import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/clojure/clj-http";

export default createGenerator("clojure", "clj-http", (request) => emit(request));
