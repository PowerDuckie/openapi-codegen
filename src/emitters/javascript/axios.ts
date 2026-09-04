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
  const functionName = safeIdentifier(operationName(request), "sendRequest");

  const entries = body && multipart ? toKeyValueBody(body.value) : [];

  const fileParameters: string[] = [];
  const prefix: string[] = [];
  let dataExpression: string | undefined;

  if (multipart) {
    prefix.push("  const formData = new FormData();");

    let fileIndex = 0;

    for (const entry of entries) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        fileIndex += 1;
        const parameterName = `file${fileIndex}`;
        fileParameters.push(`${parameterName}: File`);

        /*
         * Browser File objects already carry their filename and media type.
         * FileValue.path is not usable in browser code.
         */
        prefix.push(
          `  formData.append(${escapeJs(fieldName)}, ${parameterName});`,
        );
      } else {
        prefix.push(
          `  formData.append(${escapeJs(fieldName)}, ${escapeJs(
            formFieldValue(entry.value),
          )});`,
        );
      }
    }

    dataExpression = "formData";
  } else if (body && canHaveBody) {
    dataExpression = escapeJs(
      hasFormBody(request) ? form(body.value) : bodyText(request),
    );
  }

  /*
   * Browser environments prohibit or control several request headers.
   * browserHeaders() removes those headers while retaining the ordered list.
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

      /*
       * The browser must generate multipart Content-Type with its boundary.
       */
      if (multipart && isContentTypeHeader(name)) {
        return false;
      }

      return true;
    },
  );

  const headerCode = headers.map(
    ([name, value]) =>
      `  headers.append(${escapeJs(String(name))}, ${escapeJs(
        String(value),
      )});`,
  );

  const invocationArguments = fileParameters.map(
    (_, index) => `file${index + 1}`,
  );

  return [
    "// Requires a modern browser with File, FormData, Headers, and AbortController.",
    "// Requires TypeScript 5.2+ and Axios 1.7.x.",
    "// Install: npm install axios@^1.7",
    "// Compile: npx tsc --target ES2022 --module ES2022 --moduleResolution bundler --lib ES2022,DOM main.ts",
    "// Axios/browser header handling may combine repeated header values.",
    "// Browser code cannot read local filesystem paths; pass each multipart file as a File argument.",
    "",
    'import axios, { AxiosError } from "axios";',
    "",
    `export async function ${functionName}(`,
    ...fileParameters.map(
      (parameter, index) =>
        `  ${parameter}${index < fileParameters.length - 1 ? "," : ""}`,
    ),
    `): Promise<void> {`,
    ...prefix,
    ...(prefix.length > 0 ? [""] : []),
    "  const headers = new Headers();",
    ...headerCode,
    "",
    "  const response = await axios.request<string>({",
    `    method: ${escapeJs(method)},`,
    `    url: ${escapeJs(compiled.url)},`,
    "    headers,",
    ...(dataExpression ? [`    data: ${dataExpression},`] : []),
    "    timeout: 30_000,",
    '    responseType: "text",',
    "    transformResponse: [(value: string) => value],",
    "    validateStatus: () => true,",
    "  });",
    "",
    "  const responseText =",
    '    typeof response.data === "string"',
    "      ? response.data",
    '      : String(response.data ?? "");',
    "",
    "  if (response.status < 200 || response.status >= 300) {",
    "    throw new Error(",
    "      `HTTP ${response.status} ${response.statusText}: ${responseText}`,",
    "    );",
    "  }",
    "",
    "  console.log(responseText);",
    "}",
    "",
    ...(fileParameters.length === 0
      ? [
          `${functionName}().catch((error: unknown) => {`,
          "  if (error instanceof AxiosError) {",
          "    console.error(error.message);",
          "  } else {",
          "    console.error(error);",
          "  }",
          "});",
        ]
      : [
          "// Call the exported function with browser File objects:",
          `// ${functionName}(${invocationArguments.join(", ")}).catch(console.error);`,
        ]),
  ].join("\n");
}
