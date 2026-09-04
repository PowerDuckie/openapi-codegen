import type { Generator, Plugin } from "./types";
import { applyPlugin } from "./core/plugin";
import { getGenerator, listGenerators, registerGenerator } from "./core/registry";
import g0 from "./generators/c/libcurl";
import g1 from "./generators/csharp/httpclient";
import g2 from "./generators/csharp/restsharp";
import g3 from "./generators/clojure/clj-http";
import g4 from "./generators/dart/http";
import g5 from "./generators/fsharp/httpclient";
import g6 from "./generators/go/new-request";
import g7 from "./generators/http/http1";
import g8 from "./generators/java/asynchttp";
import g9 from "./generators/java/java-net-http";
import g10 from "./generators/java/okhttp";
import g11 from "./generators/java/unirest";
import g12 from "./generators/javascript/fetch";
import g13 from "./generators/javascript/axios";
import g14 from "./generators/javascript/ofetch";
import g15 from "./generators/javascript/jquery";
import g16 from "./generators/javascript/xhr";
import g17 from "./generators/kotlin/okhttp";
import g18 from "./generators/node/fetch";
import g19 from "./generators/node/axios";
import g20 from "./generators/node/ofetch";
import g21 from "./generators/node/undici";
import g22 from "./generators/objc/nsurlsession";
import g23 from "./generators/ocaml/cohttp";
import g24 from "./generators/php/curl";
import g25 from "./generators/php/guzzle";
import g26 from "./generators/php/laravel-http";
import g27 from "./generators/powershell/invoke-webrequest";
import g28 from "./generators/powershell/invoke-restmethod";
import g29 from "./generators/python/http-client";
import g30 from "./generators/python/requests";
import g31 from "./generators/python/aiohttp";
import g32 from "./generators/python/httpx-sync";
import g33 from "./generators/python/httpx-async";
import g34 from "./generators/r/httr2";
import g35 from "./generators/ruby/net-http";
import g36 from "./generators/rust/reqwest";
import g37 from "./generators/shell/curl";
import g38 from "./generators/shell/wget";
import g39 from "./generators/shell/httpie";
import g40 from "./generators/swift/nsurlsession";

const builtinGenerators: Generator[] = [g0,g1,g2,g3,g4,g5,g6,g7,g8,g9,g10,g11,g12,g13,g14,g15,g16,g17,g18,g19,g20,g21,g22,g23,g24,g25,g26,g27,g28,g29,g30,g31,g32,g33,g34,g35,g36,g37,g38,g39,g40];
let initialized = false;

export function register(generator: Generator): void { registerGenerator(generator); }
export function get(language: string, client: string): Generator | undefined { return getGenerator(language, client); }
export function list(): Array<{ language: string; client: string }> { return listGenerators(); }
export function use(plugin: Plugin): void { applyPlugin(plugin, { register }); }

export function builtins(): void {
  if (initialized) return;
  initialized = true;
  builtinGenerators.forEach(register);
}
