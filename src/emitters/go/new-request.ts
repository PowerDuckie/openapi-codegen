import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeGo,
  fileComment,
  form,
  hasFormBody,
  hasJsonBody,
  hasMultipartBody,
  isContentLengthHeader,
  isContentTypeHeader,
  isFileValue,
  isTransferEncodingHeader,
  mediaTypeOf,
  normalizeMethod,
  requiresRequestBody,
  supportsRequestBody,
  toKeyValueBody,
} from "../common";
import type { FileValue, RequestIR } from "../../types";

function nonBlankString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : fallback;
}

function safeComment(value: unknown): string {
  return String(value)
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

function multipartText(value: unknown): string {
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
    const serialized = JSON.stringify(value);
    return serialized === undefined ? String(value) : serialized;
  } catch {
    return String(value);
  }
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const multipart = Boolean(body) && canHaveBody && hasMultipartBody(request);
  const generatedBody =
    Boolean(body && canHaveBody) || (!body && requiresRequestBody(method));

  const imports = new Set<string>([
    '"context"',
    '"fmt"',
    '"io"',
    '"net/http"',
    '"os"',
    '"time"',
  ]);

  const setupLines: string[] = [];
  let requestBodyExpression = "nil";
  let generatedContentType: string | undefined;

  if (body && multipart) {
    imports.add('"bytes"');
    imports.add('"mime/multipart"');
    imports.add('"net/textproto"');

    setupLines.push(
      "  var bodyBuffer bytes.Buffer",
      "  multipartWriter := multipart.NewWriter(&bodyBuffer)",
    );

    toKeyValueBody(body.value).forEach((item, index) => {
      const fieldName = String(item.name);

      if (item.file && isFileValue(item.value)) {
        const fileValue: FileValue = item.value;
        const filePath = nonBlankString(fileValue.path, DEFAULT_FILE_PATH);
        const fileName = nonBlankString(fileValue.name, DEFAULT_FILE_NAME);
        const contentType = nonBlankString(
          fileValue.contentType,
          DEFAULT_BINARY_MEDIA_TYPE,
        );

        const fileVariable = `uploadFile${index}`;
        const partVariable = `filePart${index}`;
        const headerVariable = `fileHeader${index}`;

        if (
          typeof fileValue.path !== "string" ||
          fileValue.path.trim().length === 0
        ) {
          setupLines.push(
            `  // ${safeComment(fileComment(filePath, fieldName))}`,
          );
        }

        setupLines.push(
          `  ${fileVariable}, err := os.Open(${escapeGo(filePath)})`,
          "  if err != nil {",
          `    fmt.Fprintf(os.Stderr, ${escapeGo(
            `open multipart file ${fieldName}: %v\n`,
          )}, err)`,
          "    os.Exit(1)",
          "  }",
          "",
          `  ${headerVariable} := make(textproto.MIMEHeader)`,
          `  ${headerVariable}.Set(`,
          '    "Content-Disposition",',
          "    mime.FormatMediaType(",
          '      "form-data",',
          "      map[string]string{",
          `        "name": ${escapeGo(fieldName)},`,
          `        "filename": ${escapeGo(fileName)},`,
          "      },",
          "    ),",
          "  )",
          `  ${headerVariable}.Set("Content-Type", ${escapeGo(contentType)})`,
          `  ${partVariable}, err := multipartWriter.CreatePart(${headerVariable})`,
          "  if err != nil {",
          `    _ = ${fileVariable}.Close()`,
          `    fmt.Fprintf(os.Stderr, ${escapeGo(
            `create multipart file part ${fieldName}: %v\n`,
          )}, err)`,
          "    os.Exit(1)",
          "  }",
          `  if _, err := io.Copy(${partVariable}, ${fileVariable}); err != nil {`,
          `    _ = ${fileVariable}.Close()`,
          `    fmt.Fprintf(os.Stderr, ${escapeGo(
            `copy multipart file ${fieldName}: %v\n`,
          )}, err)`,
          "    os.Exit(1)",
          "  }",
          `  if err := ${fileVariable}.Close(); err != nil {`,
          `    fmt.Fprintf(os.Stderr, ${escapeGo(
            `close multipart file ${fieldName}: %v\n`,
          )}, err)`,
          "    os.Exit(1)",
          "  }",
        );

        imports.add('"mime"');
      } else {
        setupLines.push(
          `  if err := multipartWriter.WriteField(`,
          `    ${escapeGo(fieldName)},`,
          `    ${escapeGo(multipartText(item.value))},`,
          "  ); err != nil {",
          `    fmt.Fprintf(os.Stderr, ${escapeGo(
            `write multipart field ${fieldName}: %v\n`,
          )}, err)`,
          "    os.Exit(1)",
          "  }",
        );
      }
    });

    setupLines.push(
      "  if err := multipartWriter.Close(); err != nil {",
      '    fmt.Fprintf(os.Stderr, "close multipart writer: %v\\n", err)',
      "    os.Exit(1)",
      "  }",
    );

    requestBodyExpression = "&bodyBuffer";
    generatedContentType = "multipartWriter.FormDataContentType()";
  } else if (body && canHaveBody) {
    imports.add('"strings"');

    const isForm = hasFormBody(request);
    const isJson = hasJsonBody(request);
    const payload = isForm ? form(body.value) : bodyText(request);
    const fallbackMediaType = isForm
      ? "application/x-www-form-urlencoded"
      : isJson
        ? "application/json"
        : "text/plain";

    requestBodyExpression = `strings.NewReader(${escapeGo(payload)})`;
    generatedContentType = escapeGo(mediaTypeOf(request, fallbackMediaType));
  } else if (!body && requiresRequestBody(method)) {
    imports.add('"http"');
    requestBodyExpression = "http.NoBody";
  }

  const filteredHeaders = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      generatedBody &&
      (isContentLengthHeader(name) ||
        isTransferEncodingHeader(name) ||
        isContentTypeHeader(name))
    ) {
      return false;
    }

    return true;
  });

  const headerLines = filteredHeaders.map(
    ([name, value]) =>
      `  req.Header.Add(${escapeGo(String(name))}, ${escapeGo(String(value))})`,
  );

  if (generatedContentType) {
    headerLines.push(
      `  req.Header.Set("Content-Type", ${generatedContentType})`,
    );
  }

  return [
    "package main",
    "",
    "// Requires Go 1.22 or later.",
    "// Run with: go run .",
    "// Standard HTTP proxy environment variables are honored.",
    "import (",
    ...[...imports].sort().map((item) => `  ${item}`),
    ")",
    "",
    "func main() {",
    "  ctx, cancel := context.WithTimeout(",
    "    context.Background(),",
    "    30*time.Second,",
    "  )",
    "  defer cancel()",
    "",
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    "  req, err := http.NewRequestWithContext(",
    "    ctx,",
    `    ${escapeGo(method)},`,
    `    ${escapeGo(compiled.url)},`,
    `    ${requestBodyExpression},`,
    "  )",
    "  if err != nil {",
    '    fmt.Fprintf(os.Stderr, "create request: %v\\n", err)',
    "    os.Exit(1)",
    "  }",
    ...headerLines,
    "",
    "  client := &http.Client{",
    "    Timeout: 30 * time.Second,",
    "  }",
    "",
    "  resp, err := client.Do(req)",
    "  if err != nil {",
    '    fmt.Fprintf(os.Stderr, "perform request: %v\\n", err)',
    "    os.Exit(1)",
    "  }",
    "",
    "  responseBody, readErr := io.ReadAll(resp.Body)",
    "  closeErr := resp.Body.Close()",
    "  if readErr != nil {",
    '    fmt.Fprintf(os.Stderr, "read response body: %v\\n", readErr)',
    "    os.Exit(1)",
    "  }",
    "  if closeErr != nil {",
    '    fmt.Fprintf(os.Stderr, "close response body: %v\\n", closeErr)',
    "    os.Exit(1)",
    "  }",
    "",
    "  if resp.StatusCode < http.StatusOK ||",
    "    resp.StatusCode >= http.StatusMultipleChoices {",
    '    fmt.Fprintf(os.Stderr, "HTTP %s: %s\\n",',
    "      resp.Status,",
    "      string(responseBody),",
    "    )",
    "    os.Exit(1)",
    "  }",
    "",
    "  fmt.Println(string(responseBody))",
    "}",
  ].join("\n");
}
