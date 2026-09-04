import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeJs,
  fileComment,
  form,
  hasFormBody,
  hasMultipartBody,
  isContentLengthHeader,
  isContentTypeHeader,
  isFileValue,
  isTransferEncodingHeader,
  nonBlankString,
  normalizeMethod,
  supportsRequestBody,
  toKeyValueBody,
} from "../common";
import type { FileValue, RequestIR } from "../../types";

function safeComment(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
}

function textFieldValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "";
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(value);
  }
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const multipart = Boolean(body && canHaveBody && hasMultipartBody(request));
  const generatedBody = Boolean(body && canHaveBody);

  const imports = new Set<string>(['import { fetch, Headers } from "undici";']);

  const comments: string[] = [
    "Requires Node.js 20+, TypeScript 5.2+, and undici 6.x.",
    "Install: npm install undici@^6",
    "Install development tools: npm install --save-dev typescript@^5.2 @types/node",
    "Run: npx tsc request.ts --target ES2022 --module NodeNext --moduleResolution NodeNext && node request.js",
    "Fetch Headers may combine duplicate header values according to Fetch semantics.",
  ];

  const setupLines: string[] = [];
  let bodyExpression: string | undefined;

  if (body && canHaveBody && multipart) {
    imports.add('import { Blob } from "node:buffer";');
    imports.add('import { readFile } from "node:fs/promises";');
    imports.delete('import { fetch, Headers } from "undici";');
    imports.add('import { fetch, FormData, Headers } from "undici";');

    setupLines.push("  const formData = new FormData();");

    let fileIndex = 0;

    for (const entry of toKeyValueBody(body.value)) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const actualPath = nonBlankString(fileValue.path);
        const filePath = actualPath ?? DEFAULT_FILE_PATH;
        const fileName = nonBlankString(fileValue.name) ?? DEFAULT_FILE_NAME;
        const contentType =
          nonBlankString(fileValue.contentType) ?? DEFAULT_BINARY_MEDIA_TYPE;

        if (actualPath === undefined) {
          const comment = fileComment(filePath, fieldName).replace(
            /^\/\/\s*/,
            "",
          );

          comments.push(safeComment(comment));
        }

        fileIndex += 1;
        const dataName = `fileData${fileIndex}`;

        setupLines.push(
          `  const ${dataName} = await readFile(${escapeJs(filePath)});`,
          `  formData.append(`,
          `    ${escapeJs(fieldName)},`,
          `    new Blob([${dataName}], { type: ${escapeJs(contentType)} }),`,
          `    ${escapeJs(fileName)},`,
          `  );`,
        );
      } else {
        setupLines.push(
          `  formData.append(`,
          `    ${escapeJs(fieldName)},`,
          `    ${escapeJs(textFieldValue(entry.value))},`,
          `  );`,
        );
      }
    }

    bodyExpression = "formData";
  } else if (body && canHaveBody) {
    const payload = hasFormBody(request) ? form(body.value) : bodyText(request);

    bodyExpression = escapeJs(payload);
  }

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      generatedBody &&
      (isContentLengthHeader(name) || isTransferEncodingHeader(name))
    ) {
      return false;
    }

    // FormData/undici must generate Content-Type with its boundary.
    if (multipart && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  const headerLines = headers.map(
    ([rawName, rawValue]) =>
      `  headers.append(${escapeJs(
        String(rawName),
      )}, ${escapeJs(String(rawValue))});`,
  );

  return [
    ...comments.map((comment) => `// ${safeComment(comment)}`),
    "",
    [...imports].sort().join("\n"),
    "",
    "async function main(): Promise<void> {",
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    "  const headers = new Headers();",
    ...headerLines,
    "",
    `  const response = await fetch(${escapeJs(compiled.url)}, {`,
    `    method: ${escapeJs(method)},`,
    "    headers,",
    ...(bodyExpression === undefined ? [] : [`    body: ${bodyExpression},`]),
    "    signal: AbortSignal.timeout(30_000),",
    "  });",
    "",
    "  const responseText = await response.text();",
    "",
    "  if (!response.ok) {",
    "    throw new Error(",
    "      `HTTP ${response.status} ${response.statusText}: ${responseText}`,",
    "    );",
    "  }",
    "",
    "  console.log(responseText);",
    "}",
    "",
    "main().catch((error: unknown) => {",
    "  const message =",
    "    error instanceof Error ? error.message : String(error);",
    "  console.error(`Request failed: ${message}`);",
    "  process.exitCode = 1;",
    "});",
  ].join("\n");
}
