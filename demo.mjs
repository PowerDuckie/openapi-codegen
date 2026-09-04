import fs from "node:fs";
import {
  parseOpenAPI,
  buildRequests,
  emitCode
} from "./dist/index.js";

const spec = JSON.parse(fs.readFileSync("./openapi.json", "utf8"));

const api = parseOpenAPI(spec);
const requests = buildRequests(api);

for (const req of requests) {
  const curlCode = emitCode("shell/curl", req);
  const fetchCode = emitCode("javascript/fetch", req);
  const pythonCode = emitCode("python/requests", req);

  console.log("operationId:", req.operationId);
  console.log("--- curl ---");
  console.log(curlCode);
  console.log("--- fetch ---");
  console.log(fetchCode);
  console.log("--- python ---");
  console.log(pythonCode);
}