import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeJava,
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
  nonBlankString,
  normalizeMethod,
  supportsRequestBody,
  toKeyValueBody,
} from "../common";
import type { FileValue, RequestIR } from "../../types";

function safeComment(value: string): string {
  return value
    .replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .trim();
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

function multipartQuotedValue(value: string): string {
  return value
    .replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const multipart = Boolean(
    body && canHaveBody && hasMultipartBody(request),
  );
  const generatedBody = Boolean(body && canHaveBody);
  const comments: string[] = [
    "Requires JDK 17+; no external dependencies.",
    "Compile: javac Example.java",
    "Run: java Example",
    "Repeated request headers and multipart fields are emitted separately.",
  ];

  const imports = new Set<string>([
    "import java.net.URI;",
    "import java.net.http.HttpClient;",
    "import java.net.http.HttpRequest;",
    "import java.net.http.HttpResponse;",
    "import java.nio.charset.StandardCharsets;",
    "import java.time.Duration;",
  ]);

  const declarations: string[] = [];
  let bodyPublisher = "HttpRequest.BodyPublishers.noBody()";
  let generatedContentType: string | undefined;

  if (body && multipart) {
    imports.add("import java.io.ByteArrayOutputStream;");
    imports.add("import java.nio.file.Files;");
    imports.add("import java.nio.file.Path;");
    imports.add("import java.util.UUID;");

    declarations.push(
      '    String boundary = "----JavaBoundary" + UUID.randomUUID();',
      "    ByteArrayOutputStream multipartBody =",
      "      new ByteArrayOutputStream();",
    );

    let fileIndex = 0;

    for (const entry of toKeyValueBody(body.value)) {
      const fieldName = multipartQuotedValue(String(entry.name));

      declarations.push(
        "    multipartBody.write(",
        '      ("--" + boundary + "\\r\\n")',
        "        .getBytes(StandardCharsets.UTF_8)",
        "    );",
      );

      if (entry.file && isFileValue(entry.value)) {
        fileIndex += 1;

        const fileValue: FileValue = entry.value;
        const actualPath = nonBlankString(fileValue.path);
        const filePath = actualPath ?? DEFAULT_FILE_PATH;
        const fileName = multipartQuotedValue(
          nonBlankString(fileValue.name) ?? DEFAULT_FILE_NAME,
        );
        const contentType = (
          nonBlankString(fileValue.contentType) ??
          DEFAULT_BINARY_MEDIA_TYPE
        )
          .replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, "")
          .trim() || DEFAULT_BINARY_MEDIA_TYPE;
        const pathVariable = `filePath${fileIndex}`;

        if (!actualPath) {
          comments.push(
            safeComment(fileComment(filePath, String(entry.name))).replace(
              /^(?:\/\/|#)\s*/,
              "",
            ),
          );
        }

        declarations.push(
          `    Path ${pathVariable} = Path.of(${escapeJava(filePath)});`,
          "    multipartBody.write(",
          `      ${escapeJava(
            `Content-Disposition: form-data; name="${fieldName}"; filename="${fileName}"\r\n`,
          )}.getBytes(StandardCharsets.UTF_8)`,
          "    );",
          "    multipartBody.write(",
          `      ${escapeJava(
            `Content-Type: ${contentType}\r\n\r\n`,
          )}.getBytes(StandardCharsets.UTF_8)`,
          "    );",
          `    Files.copy(${pathVariable}, multipartBody);`,
          "    multipartBody.write(",
          '      "\\r\\n".getBytes(StandardCharsets.UTF_8)',
          "    );",
        );
      } else {
        declarations.push(
          "    multipartBody.write(",
          `      ${escapeJava(
            `Content-Disposition: form-data; name="${fieldName}"\r\n\r\n`,
          )}.getBytes(StandardCharsets.UTF_8)`,
          "    );",
          "    multipartBody.write(",
          `      ${escapeJava(
            textFieldValue(entry.value),
          )}.getBytes(StandardCharsets.UTF_8)`,
          "    );",
          "    multipartBody.write(",
          '      "\\r\\n".getBytes(StandardCharsets.UTF_8)',
          "    );",
        );
      }
    }

    declarations.push(
      "    multipartBody.write(",
      '      ("--" + boundary + "--\\r\\n")',
      "        .getBytes(StandardCharsets.UTF_8)",
      "    );",
    );

    bodyPublisher =
      "HttpRequest.BodyPublishers.ofByteArray(multipartBody.toByteArray())";
    generatedContentType = '"multipart/form-data; boundary=" + boundary';
  } else if (body && canHaveBody) {
    const isForm = hasFormBody(request);
    const isJson = hasJsonBody(request);
    const payload = isForm ? form(body.value) : bodyText(request);
    const fallbackContentType = isForm
      ? "application/x-www-form-urlencoded"
      : isJson
        ? "application/json"
        : "text/plain";

    bodyPublisher = [
      "HttpRequest.BodyPublishers.ofString(",
      `${escapeJava(payload)}, StandardCharsets.UTF_8`,
      ")",
    ].join("");

    generatedContentType = escapeJava(
      mediaTypeOf(request, fallbackContentType),
    );
  }

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      generatedBody &&
      (isContentLengthHeader(name) ||
        isTransferEncodingHeader(name))
    ) {
      return false;
    }

    if (generatedBody && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  const headerLines = headers.map(
    ([name, value]) =>
      `      .header(${escapeJava(String(name))}, ${escapeJava(
        String(value),
      )})`,
  );

  if (generatedContentType !== undefined) {
    headerLines.push(
      `      .header("Content-Type", ${generatedContentType})`,
    );
  }

  return [
    ...comments.map((comment) => `// ${safeComment(comment)}`),
    "",
    [...imports].sort().join("\n"),
    "",
    "public final class Example {",
    "  private Example() {}",
    "",
    "  public static void main(String[] args) throws Exception {",
    "    HttpClient client = HttpClient.newBuilder()",
    "      .connectTimeout(Duration.ofSeconds(30))",
    "      .followRedirects(HttpClient.Redirect.NORMAL)",
    "      .build();",
    "",
    ...declarations,
    ...(declarations.length > 0 ? [""] : []),
    "    HttpRequest httpRequest = HttpRequest.newBuilder()",
    `      .uri(URI.create(${escapeJava(compiled.url)}))`,
    "      .timeout(Duration.ofSeconds(30))",
    ...headerLines,
    `      .method(${escapeJava(method)}, ${bodyPublisher})`,
    "      .build();",
    "",
    "    HttpResponse<String> response = client.send(",
    "      httpRequest,",
    "      HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8)",
    "    );",
    "",
    "    String responseBody = response.body();",
    "    if (response.statusCode() < 200 ||",
    "        response.statusCode() >= 300) {",
    "      throw new IllegalStateException(",
    '        "HTTP " + response.statusCode() + ": " + responseBody',
    "      );",
    "    }",
    "",
    "    System.out.println(responseBody);",
    "  }",
    "}",
  ].join("\n");
}