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
  operationName,
  supportsRequestBody,
  toKeyValueBody,
} from "../common";
import type { RequestIR } from "../../types";

function safeIdentifier(value: string, fallback: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_$]/g, "_");
  const candidate = /^[A-Za-z_$]/.test(cleaned) ? cleaned : `_${cleaned}`;

  return candidate.length > 0 ? candidate : fallback;
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const multipart = Boolean(body && canHaveBody && hasMultipartBody(request));
  const generatedBody = Boolean(body && canHaveBody);
  const name = safeIdentifier(operationName(request), "sendRequest");

  const entries = body && multipart ? toKeyValueBody(body.value) : [];

  const parameters: string[] = [];
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

        parameters.push(`${parameterName}: File`);
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
   * browserHeaders() removes browser-controlled or forbidden headers.
   * Use Headers.append() to retain duplicates as far as Fetch permits.
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

      // FormData must generate the boundary-bearing Content-Type.
      if (multipart && isContentTypeHeader(name)) {
        return false;
      }

      return true;
    },
  );

  const signature =
    parameters.length === 0
      ? `export async function ${name}(): Promise<string> {`
      : [
          `export async function ${name}(`,
          ...parameters.map(
            (parameter, index) =>
              `  ${parameter}${index < parameters.length - 1 ? "," : ""}`,
          ),
          "): Promise<string> {",
        ].join("\n");

  return [
    "// Requires a modern browser with FormData, File, Headers, and AbortSignal.timeout().",
    "// Requires TypeScript 5.2+ and ofetch 1.4+.",
    "// Install: npm install ofetch@^1.4",
    "// Compile: npx tsc main.ts --target ES2022 --module ES2022 --moduleResolution bundler --lib ES2022,DOM --strict",
    "// Fetch may combine repeated headers according to its header model.",
    "// Multipart files must be supplied as File arguments; browsers cannot read local paths.",
    "",
    'import { ofetch } from "ofetch";',
    "",
    signature,
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    "  const headers = new Headers();",
    ...headers.map(
      ([name, value]) =>
        `  headers.append(${escapeJs(String(name))}, ${escapeJs(
          String(value),
        )});`,
    ),
    "",
    "  try {",
    "    return await ofetch<string>(",
    `      ${escapeJs(compiled.url)},`,
    "      {",
    `        method: ${escapeJs(method)},`,
    "        headers,",
    ...(bodyExpression ? [`        body: ${bodyExpression},`] : []),
    "        signal: AbortSignal.timeout(30_000),",
    '        responseType: "text",',
    "        retry: 0,",
    "      },",
    "    );",
    "  } catch (error: unknown) {",
    "    if (error instanceof Error) {",
    "      throw new Error(`Request failed: ${error.message}`, {",
    "        cause: error,",
    "      });",
    "    }",
    "",
    '    throw new Error("Request failed with an unknown error", {',
    "      cause: error,",
    "    });",
    "  }",
    "}",
  ].join("\n");
}
