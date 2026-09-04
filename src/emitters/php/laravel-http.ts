import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapePhp,
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
  return value
    .replace(/^\/\/\s*/, "")
    .replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .trim();
}

function phpHeaders(headers: Array<[string, string]>): string[] {
  const grouped = new Map<string, { name: string; values: string[] }>();

  for (const [rawName, rawValue] of headers) {
    const name = String(rawName);
    const key = name.trim().toLowerCase();
    const existing = grouped.get(key);

    if (existing) {
      existing.values.push(String(rawValue));
    } else {
      grouped.set(key, {
        name,
        values: [String(rawValue)],
      });
    }
  }

  const lines = ["$headers = ["];

  for (const { name, values } of grouped.values()) {
    if (values.length === 1) {
      lines.push(`  ${escapePhp(name)} => ${escapePhp(values[0])},`);
    } else {
      lines.push(
        `  ${escapePhp(name)} => [`,
        ...values.map((value) => `    ${escapePhp(value)},`),
        "  ],",
      );
    }
  }

  lines.push("];");
  return lines;
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const multipart = Boolean(body) && canHaveBody && hasMultipartBody(request);
  const generatedBody = Boolean(body && canHaveBody);

  const comments: string[] = [];
  const setupLines: string[] = [];
  const attachLines: string[] = [];
  const dataLines: string[] = [];
  const fileVariables: string[] = [];

  if (body && multipart) {
    let fileIndex = 0;

    for (const entry of toKeyValueBody(body.value)) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const filePath = nonBlankString(fileValue.path) ?? DEFAULT_FILE_PATH;
        const fileName = nonBlankString(fileValue.name) ?? DEFAULT_FILE_NAME;
        const contentType =
          nonBlankString(fileValue.contentType) ?? DEFAULT_BINARY_MEDIA_TYPE;
        const variable = `$fileHandle${++fileIndex}`;

        if (!nonBlankString(fileValue.path)) {
          comments.push(safeComment(fileComment(filePath, fieldName)));
        }

        fileVariables.push(variable);

        setupLines.push(
          `${variable} = fopen(${escapePhp(filePath)}, 'rb');`,
          `if (${variable} === false) {`,
          `  throw new RuntimeException(${escapePhp(
            `Unable to open multipart file: ${filePath}`,
          )});`,
          "}",
        );

        attachLines.push(
          `  ->attach(${escapePhp(fieldName)}, ${variable}, ${escapePhp(
            fileName,
          )}, ['Content-Type' => ${escapePhp(contentType)}])`,
        );
      } else {
        const value =
          entry.value == null
            ? ""
            : typeof entry.value === "string"
              ? entry.value
              : JSON.stringify(entry.value);

        dataLines.push(`  ${escapePhp(fieldName)} => ${escapePhp(value)},`);
      }
    }
  }

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      generatedBody &&
      (isContentLengthHeader(name) || isTransferEncodingHeader(name))
    ) {
      return false;
    }

    if (multipart && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  let sendLine: string;

  if (!body || !canHaveBody) {
    sendLine = `  ->send(${escapePhp(method)}, ${escapePhp(compiled.url)});`;
  } else if (multipart) {
    sendLine = `  ->${method.toLowerCase()}(${escapePhp(
      compiled.url,
    )}, $fields);`;
  } else {
    const mediaType =
      nonBlankString(body.mediaType) ?? "application/octet-stream";

    sendLine = [
      `  ->withBody(${escapePhp(
        hasFormBody(request) ? form(body.value) : bodyText(request),
      )}, ${escapePhp(mediaType)})`,
      `  ->send(${escapePhp(method)}, ${escapePhp(compiled.url)});`,
    ].join("\n");
  }

  return [
    "<?php",
    "",
    "declare(strict_types=1);",
    "",
    "use Illuminate\\Support\\Facades\\Http;",
    "",
    ...comments.map((comment) => `// ${comment}`),
    ...(comments.length > 0 ? [""] : []),
    ...phpHeaders(headers),
    ...(multipart ? ["", "$fields = [", ...dataLines, "];"] : []),
    ...(setupLines.length > 0 ? ["", ...setupLines] : []),
    "",
    "try {",
    "  $response = Http::withHeaders($headers)",
    "    ->connectTimeout(10)",
    "    ->timeout(30)",
    ...attachLines,
    sendLine,
    "",
    "  if (!$response->successful()) {",
    "    throw new RuntimeException(",
    "      sprintf('HTTP %d: %s', $response->status(), $response->body())",
    "    );",
    "  }",
    "",
    "  echo $response->body();",
    "} finally {",
    ...fileVariables.map(
      (variable) => `  if (is_resource(${variable})) { fclose(${variable}); }`,
    ),
    "}",
  ].join("\n");
}
