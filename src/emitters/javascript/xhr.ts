import {
  bodyText,
  browserHeaders,
  compile,
  escapeJs,
  form,
  formFieldValue,
  hasFormBody,
  hasMultipartBody,
  isContentLengthHeader,
  isContentTypeHeader,
  isFileValue,
  isTransferEncodingHeader,
  normalizeMethod,
  supportsRequestBody,
  toKeyValueBody,
} from "../common";
import type { RequestIR } from "../../types";

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const multipart = Boolean(body && canHaveBody && hasMultipartBody(request));
  const generatedBody = Boolean(body && canHaveBody);

  const entries = body && multipart ? toKeyValueBody(body.value) : [];

  const parameters: string[] = [];
  const setupLines: string[] = [];
  let bodyExpression = "null";

  if (multipart) {
    setupLines.push("    const formData = new FormData();");

    let fileIndex = 0;

    for (const entry of entries) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        fileIndex += 1;
        const parameterName = `file${fileIndex}`;

        parameters.push(`${parameterName}: File`);
        setupLines.push(
          `    formData.append(${escapeJs(fieldName)}, ${parameterName});`,
        );
      } else {
        setupLines.push(
          `    formData.append(${escapeJs(fieldName)}, ${escapeJs(
            formFieldValue(entry.value),
          )});`,
        );
      }
    }

    bodyExpression = "formData";
  } else if (body && canHaveBody) {
    bodyExpression = escapeJs(
      hasFormBody(request) ? form(body.value) : bodyText(request),
    );
  }

  const headers = browserHeaders(compiled.headers, multipart).filter(
    ([rawName]) => {
      const name = String(rawName);

      if (
        generatedBody &&
        (isContentLengthHeader(name) || isTransferEncodingHeader(name))
      ) {
        return false;
      }

      // XMLHttpRequest must generate multipart Content-Type and its boundary.
      if (multipart && isContentTypeHeader(name)) {
        return false;
      }

      return true;
    },
  );

  const signature =
    parameters.length === 0
      ? "export function sendRequest(): Promise<string> {"
      : [
          "export function sendRequest(",
          ...parameters.map(
            (parameter, index) =>
              `  ${parameter}${index < parameters.length - 1 ? "," : ""}`,
          ),
          "): Promise<string> {",
        ].join("\n");

  return [
    "// Requires a modern browser with XMLHttpRequest, FormData, and File.",
    "// Requires TypeScript 5.2+.",
    "// Compile: npx tsc main.ts --target ES2022 --module ES2022 --lib ES2022,DOM --strict",
    "// Browsers may combine repeated request headers set through XMLHttpRequest.",
    "// Multipart files must be supplied as File arguments; browsers cannot read local paths.",
    "",
    signature,
    "  return new Promise((resolve, reject) => {",
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    "    const xhr = new XMLHttpRequest();",
    `    xhr.open(${escapeJs(method)}, ${escapeJs(compiled.url)}, true);`,
    "    xhr.timeout = 30_000;",
    '    xhr.responseType = "text";',
    "",
    ...headers.map(
      ([name, value]) =>
        `    xhr.setRequestHeader(${escapeJs(String(name))}, ${escapeJs(
          String(value),
        )});`,
    ),
    ...(headers.length > 0 ? [""] : []),
    "    xhr.onload = () => {",
    "      if (xhr.status >= 200 && xhr.status < 300) {",
    "        resolve(xhr.responseText);",
    "        return;",
    "      }",
    "",
    "      reject(",
    "        new Error(",
    "          `HTTP ${xhr.status} ${xhr.statusText}: ${xhr.responseText}`,",
    "        ),",
    "      );",
    "    };",
    "",
    "    xhr.onerror = () => {",
    '      reject(new Error("Network request failed"));',
    "    };",
    "",
    "    xhr.ontimeout = () => {",
    '      reject(new Error("Request timed out after 30 seconds"));',
    "    };",
    "",
    "    xhr.onabort = () => {",
    '      reject(new Error("Request aborted"));',
    "    };",
    "",
    `    xhr.send(${bodyExpression});`,
    "  });",
    "}",
  ].join("\n");
}
