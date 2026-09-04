import {
  bodyText,
  compile,
  form,
  hasFormBody,
  hasJsonBody,
  isContentLengthHeader,
  isContentTypeHeader,
  isTransferEncodingHeader,
  mediaTypeOf,
  normalizeMethod,
  requiresRequestBody,
  supportsRequestBody,
} from "../common";
import type { RequestIR } from "../../types";
import { escapeClojure } from "../../core/helpers";

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const generatedBody =
    Boolean(body && canHaveBody) || (!body && requiresRequestBody(method));

  let payload: string | undefined;
  let contentType: string | undefined;

  if (body && canHaveBody) {
    const isForm = hasFormBody(request);
    const isJson = hasJsonBody(request);

    payload = isForm ? form(body.value) : bodyText(request);
    contentType = mediaTypeOf(
      request,
      isForm
        ? "application/x-www-form-urlencoded"
        : isJson
          ? "application/json"
          : "text/plain",
    );
  } else if (!body && requiresRequestBody(method)) {
    payload = "";
    contentType = "application/octet-stream";
  }

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    return !(
      generatedBody &&
      (isContentLengthHeader(name) ||
        isTransferEncodingHeader(name) ||
        isContentTypeHeader(name))
    );
  });

  const headerEntries = headers.map(
    ([name, value]) =>
      `    ${escapeClojure(String(name))} ${escapeClojure(String(value))}`,
  );

  if (contentType !== undefined) {
    headerEntries.push(`    "Content-Type" ${escapeClojure(contentType)}`);
  }

  return [
    ";; Requires Clojure 1.11+ and clj-http 3.13.0.",
    ";; Run with clj-http on the classpath.",
    "(require '[clj-http.client :as client])",
    "",
    "(let [response",
    "      (try",
    "        (client/request",
    "          {:method",
    `           (keyword ${escapeClojure(method.toLowerCase())})`,
    `           :url ${escapeClojure(compiled.url)}`,
    "           :headers",
    "           {",
    ...headerEntries,
    "           }",
    ...(payload !== undefined
      ? [`           :body ${escapeClojure(payload)}`]
      : []),
    "           :socket-timeout 30000",
    "           :connection-timeout 30000",
    "           :throw-exceptions false",
    "           :as :text})",
    "        (catch Exception exception",
    "          (binding [*out* *err*]",
    '            (println "Request failed:" (.getMessage exception)))',
    "          (System/exit 1)))]",
    "  (if (<= 200 (:status response) 299)",
    '    (print (or (:body response) ""))',
    "    (do",
    "      (binding [*out* *err*]",
    '        (println (str "HTTP "',
    "                      (:status response)",
    '                      ": "',
    '                      (or (:body response) ""))))',
    "      (System/exit 1))))",
  ].join("\n");
}
