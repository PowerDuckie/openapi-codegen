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

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const multipart = Boolean(body) && canHaveBody && hasMultipartBody(request);
  const generatedBody = Boolean(body && canHaveBody);

  const comments: string[] = [];
  const setupLines: string[] = [];
  let bodyExpression: string | undefined;

  if (body && multipart) {
    const fieldLines: string[] = [];
    let fileIndex = 0;

    for (const entry of toKeyValueBody(body.value)) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const filePath = nonBlankString(fileValue.path) ?? DEFAULT_FILE_PATH;
        const fileName = nonBlankString(fileValue.name) ?? DEFAULT_FILE_NAME;
        const contentType =
          nonBlankString(fileValue.contentType) ?? DEFAULT_BINARY_MEDIA_TYPE;
        const variable = `$file${++fileIndex}`;

        if (!nonBlankString(fileValue.path)) {
          comments.push(safeComment(fileComment(filePath, fieldName)));
        }

        setupLines.push(
          `${variable} = new CURLFile(`,
          `  ${escapePhp(filePath)},`,
          `  ${escapePhp(contentType)},`,
          `  ${escapePhp(fileName)}`,
          `);`,
        );

        fieldLines.push(`  ${escapePhp(fieldName)} => ${variable},`);
      } else {
        fieldLines.push(
          `  ${escapePhp(fieldName)} => ${escapePhp(
            entry.value == null
              ? ""
              : typeof entry.value === "string"
                ? entry.value
                : JSON.stringify(entry.value),
          )},`,
        );
      }
    }

    setupLines.push("$postFields = [", ...fieldLines, "];");
    bodyExpression = "$postFields";
  } else if (body && canHaveBody) {
    bodyExpression = escapePhp(
      hasFormBody(request) ? form(body.value) : bodyText(request),
    );
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

  return [
    "<?php",
    "",
    "declare(strict_types=1);",
    "",
    ...comments.map((comment) => `// ${comment}`),
    ...(comments.length > 0 ? [""] : []),
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    "$ch = curl_init();",
    "",
    "if ($ch === false) {",
    "  throw new RuntimeException('Unable to initialize cURL');",
    "}",
    "",
    "try {",
    "  curl_setopt_array($ch, [",
    `    CURLOPT_URL => ${escapePhp(compiled.url)},`,
    `    CURLOPT_CUSTOMREQUEST => ${escapePhp(method)},`,
    "    CURLOPT_RETURNTRANSFER => true,",
    "    CURLOPT_CONNECTTIMEOUT => 10,",
    "    CURLOPT_TIMEOUT => 30,",
    ...(headers.length > 0
      ? [
          "    CURLOPT_HTTPHEADER => [",
          ...headers.map(
            ([name, value]) =>
              `      ${escapePhp(`${String(name)}: ${String(value)}`)},`,
          ),
          "    ],",
        ]
      : []),
    ...(bodyExpression ? [`    CURLOPT_POSTFIELDS => ${bodyExpression},`] : []),
    "  ]);",
    "",
    "  $responseBody = curl_exec($ch);",
    "",
    "  if ($responseBody === false) {",
    "    throw new RuntimeException(",
    "      sprintf('cURL error %d: %s', curl_errno($ch), curl_error($ch))",
    "    );",
    "  }",
    "",
    "  $statusCode = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);",
    "",
    "  if ($statusCode < 200 || $statusCode >= 300) {",
    "    throw new RuntimeException(",
    "      sprintf('HTTP %d: %s', $statusCode, $responseBody)",
    "    );",
    "  }",
    "",
    "  echo $responseBody;",
    "} finally {",
    "  curl_close($ch);",
    "}",
  ].join("\n");
}
