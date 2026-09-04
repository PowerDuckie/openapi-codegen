import { createGenerator } from "../../core/generator";
import { emit } from "../../emitters/php/laravel-http";

export default createGenerator("php", "laravel-http", (request) => emit(request));
