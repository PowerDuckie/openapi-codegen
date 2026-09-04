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

function phpHeaderArray(headers: Array<[string, string]>): string[] {
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

  const lines = ["  'headers' => ["];

  for (const { name, values } of grouped.values()) {
    if (values.length === 1) {
      lines.push(`    ${escapePhp(name)} => ${escapePhp(values[0])},`);
    } else {
      lines.push(
        `    ${escapePhp(name)} => [`,
        ...values.map((value) => `      ${escapePhp(value)},`),
        "    ],",
      );
    }
  }

  lines.push("  ],");
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
  const resourceVariables: string[] = [];
  const multipartLines: string[] = [];

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

        resourceVariables.push(variable);

        multipartLines.push(
          "    [",
          `      'name' => ${escapePhp(fieldName)},`,
          `      'contents' => ${variable},`,
          `      'filename' => ${escapePhp(fileName)},`,
          "      'headers' => [",
          `        'Content-Type' => ${escapePhp(contentType)},`,
          "      ],",
          "    ],",
        );
      } else {
        const value =
          entry.value == null
            ? ""
            : typeof entry.value === "string"
              ? entry.value
              : JSON.stringify(entry.value);

        multipartLines.push(
          "    [",
          `      'name' => ${escapePhp(fieldName)},`,
          `      'contents' => ${escapePhp(value)},`,
          "    ],",
        );
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

  const requestOptions = [
    ...phpHeaderArray(headers),
    "  'connect_timeout' => 10.0,",
    "  'timeout' => 30.0,",
    "  'http_errors' => false,",
  ];

  if (body && canHaveBody) {
    if (multipart) {
      requestOptions.push("  'multipart' => [", ...multipartLines, "  ],");
    } else {
      requestOptions.push(
        `  'body' => ${escapePhp(
          hasFormBody(request) ? form(body.value) : bodyText(request),
        )},`,
      );
    }
  }

  return [
    "<?php",
    "",
    "declare(strict_types=1);",
    "",
    "require __DIR__ . '/vendor/autoload.php';",
    "",
    "use GuzzleHttp\\Client;",
    "",
    ...comments.map((comment) => `// ${comment}`),
    ...(comments.length > 0 ? [""] : []),
    "$client = new Client();",
    ...resourceVariables.map(
      (variable, index) =>
        `${variable} = fopen(${escapePhp(
          nonBlankString(
            (
              toKeyValueBody(body?.value).filter(
                (entry) => entry.file && isFileValue(entry.value),
              )[index]?.value as FileValue | undefined
            )?.path,
          ) ?? DEFAULT_FILE_PATH,
        )}, 'rb');`,
    ),
    ...(resourceVariables.length > 0 ? [""] : []),
    ...resourceVariables.flatMap((variable) => [
      `if (${variable} === false) {`,
      `  throw new RuntimeException('Unable to open multipart file');`,
      "}",
    ]),
    ...(resourceVariables.length > 0 ? [""] : []),
    "try {",
    `  $response = $client->request(${escapePhp(method)}, ${escapePhp(
      compiled.url,
    )}, [`,
    ...requestOptions,
    "  ]);",
    "",
    "  $responseBody = (string) $response->getBody();",
    "  $statusCode = $response->getStatusCode();",
    "",
    "  if ($statusCode < 200 || $statusCode >= 300) {",
    "    throw new RuntimeException(",
    "      sprintf('HTTP %d: %s', $statusCode, $responseBody)",
    "    );",
    "  }",
    "",
    "  echo $responseBody;",
    "} finally {",
    ...resourceVariables.map(
      (variable) => `  if (is_resource(${variable})) { fclose(${variable}); }`,
    ),
    "}",
  ].join("\n");
}
