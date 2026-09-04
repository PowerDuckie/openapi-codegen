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

  const fileParameters: string[] = [];
  const setupLines: string[] = [];
  let bodyExpression: string | undefined;

  if (multipart) {
    setupLines.push("  const formData = new FormData();");

    let fileIndex = 0;

    for (const entry of entries) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        fileIndex += 1;
        const parameterName = `file${fileIndex}`;
        fileParameters.push(`${parameterName}: File`);

        /*
         * In browsers, File supplies its own name and media type.
         * FileValue.path cannot be accessed from browser JavaScript.
         */
        setupLines.push(
          `  formData.append(${escapeJs(fieldName)}, ${parameterName});`,
        );
      } else {
        setupLines.push(
          `  formData.append(${escapeJs(fieldName)}, ${escapeJs(
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

  /*
   * browserHeaders() removes headers that browser Fetch does not permit.
   * Headers.append() is used instead of an object so duplicate inputs are
   * represented as faithfully as Fetch's header model permits.
   */
  const headers = browserHeaders(compiled.headers, multipart).filter(
    ([rawName]) => {
      const name = String(rawName);

      if (
        generatedBody &&
        (isContentLengthHeader(name) || isTransferEncodingHeader(name))
      ) {
        return false;
      }

      // FormData must generate Content-Type together with its boundary.
      if (multipart && isContentTypeHeader(name)) {
        return false;
      }

      return true;
    },
  );

  const headerLines = headers.map(
    ([name, value]) =>
      `  headers.append(${escapeJs(String(name))}, ${escapeJs(
        String(value),
      )});`,
  );

  const signature =
    fileParameters.length === 0
      ? "export async function sendRequest(): Promise<string> {"
      : [
          "export async function sendRequest(",
          ...fileParameters.map(
            (parameter, index) =>
              `  ${parameter}${index < fileParameters.length - 1 ? "," : ""}`,
          ),
          "): Promise<string> {",
        ].join("\n");

  return [
    "// Requires a modern browser with Fetch, FormData, File, Headers, and AbortController.",
    "// Requires TypeScript 5.2+.",
    "// Compile: npx tsc main.ts --target ES2022 --module ES2022 --lib ES2022,DOM --strict",
    "// Fetch may combine repeated header values according to the browser header model.",
    "// Multipart files must be supplied as browser File arguments; local paths are inaccessible.",
    "",
    signature,
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    "  const headers = new Headers();",
    ...headerLines,
    "",
    "  const controller = new AbortController();",
    "  const timeoutId = globalThis.setTimeout(",
    "    () => controller.abort(),",
    "    30_000,",
    "  );",
    "",
    "  try {",
    `    const response = await fetch(${escapeJs(compiled.url)}, {`,
    `      method: ${escapeJs(method)},`,
    "      headers,",
    ...(bodyExpression ? [`      body: ${bodyExpression},`] : []),
    "      signal: controller.signal,",
    "    });",
    "",
    "    const responseText = await response.text();",
    "",
    "    if (!response.ok) {",
    "      throw new Error(",
    "        `HTTP ${response.status} ${response.statusText}: ${responseText}`,",
    "      );",
    "    }",
    "",
    "    return responseText;",
    "  } catch (error: unknown) {",
    '    if (error instanceof DOMException && error.name === "AbortError") {',
    '      throw new Error("Request timed out after 30 seconds", {',
    "        cause: error,",
    "      });",
    "    }",
    "",
    "    throw error;",
    "  } finally {",
    "    globalThis.clearTimeout(timeoutId);",
    "  }",
    "}",
  ].join("\n");
}
