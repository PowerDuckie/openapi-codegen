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

  const comments: string[] = [
    "Requires JDK 17+ and AsyncHttpClient 3.0.1.",
    "Dependency: org.asynchttpclient:async-http-client:3.0.1",
    "Compile: javac -cp 'lib/*' Example.java",
    "Run: java -cp '.:lib/*' Example",
    "Repeated request headers and multipart fields are added separately.",
  ];

  const imports = new Set<string>([
    "import java.time.Duration;",
    "import java.util.concurrent.TimeUnit;",
    "import org.asynchttpclient.AsyncHttpClient;",
    "import org.asynchttpclient.BoundRequestBuilder;",
    "import org.asynchttpclient.DefaultAsyncHttpClientConfig;",
    "import org.asynchttpclient.Response;",
    "import static org.asynchttpclient.Dsl.asyncHttpClient;",
  ]);

  const bodyLines: string[] = [];

  if (body && multipart) {
    imports.add("import java.io.File;");
    imports.add("import org.asynchttpclient.request.body.multipart.FilePart;");
    imports.add(
      "import org.asynchttpclient.request.body.multipart.StringPart;",
    );

    for (const entry of toKeyValueBody(body.value)) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const actualPath = nonBlankString(fileValue.path);
        const filePath = actualPath ?? DEFAULT_FILE_PATH;
        const fileName = nonBlankString(fileValue.name) ?? DEFAULT_FILE_NAME;
        const contentType =
          nonBlankString(fileValue.contentType) ?? DEFAULT_BINARY_MEDIA_TYPE;

        if (!actualPath) {
          comments.push(
            safeComment(fileComment(filePath, fieldName)).replace(
              /^(?:\/\/|#)\s*/,
              "",
            ),
          );
        }

        bodyLines.push(
          "      builder.addBodyPart(new FilePart(",
          `        ${escapeJava(fieldName)},`,
          `        new File(${escapeJava(filePath)}),`,
          `        ${escapeJava(contentType)},`,
          `        null,`,
          `        ${escapeJava(fileName)}`,
          "      ));",
        );
      } else {
        bodyLines.push(
          "      builder.addBodyPart(new StringPart(",
          `        ${escapeJava(fieldName)},`,
          `        ${escapeJava(textFieldValue(entry.value))}`,
          "      ));",
        );
      }
    }
  } else if (body && canHaveBody) {
    const isForm = hasFormBody(request);
    const isJson = hasJsonBody(request);
    const payload = isForm ? form(body.value) : bodyText(request);
    const fallbackMediaType = isForm
      ? "application/x-www-form-urlencoded"
      : isJson
        ? "application/json"
        : "text/plain";
    const contentType = mediaTypeOf(request, fallbackMediaType);

    bodyLines.push(
      `      builder.setHeader("Content-Type", ${escapeJava(contentType)});`,
      `      builder.setBody(${escapeJava(payload)});`,
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

    /*
     * Multipart encoding generates its boundary-bearing Content-Type.
     * Other generated bodies set their effective Content-Type below.
     */
    if (generatedBody && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  const headerLines = headers.map(
    ([name, value]) =>
      `      builder.addHeader(${escapeJava(String(name))}, ${escapeJava(
        String(value),
      )});`,
  );

  return [
    ...comments.map((comment) => `// ${safeComment(comment)}`),
    "",
    [...imports].sort().join("\n"),
    "",
    "public final class Example {",
    "  private Example() {}",
    "",
    "  public static void main(String[] args) throws Exception {",
    "    DefaultAsyncHttpClientConfig config =",
    "      new DefaultAsyncHttpClientConfig.Builder()",
    "        .setConnectTimeout(Duration.ofSeconds(30))",
    "        .setReadTimeout(Duration.ofSeconds(30))",
    "        .setRequestTimeout(Duration.ofSeconds(30))",
    "        .build();",
    "",
    "    try (AsyncHttpClient client = asyncHttpClient(config)) {",
    "      BoundRequestBuilder builder = client.prepare(",
    `        ${escapeJava(method)},`,
    `        ${escapeJava(compiled.url)}`,
    "      );",
    ...headerLines,
    ...(headerLines.length > 0 ? [""] : []),
    ...bodyLines,
    ...(bodyLines.length > 0 ? [""] : []),
    "      Response response = builder",
    "        .execute()",
    "        .get(30, TimeUnit.SECONDS);",
    "      String responseBody = response.getResponseBody();",
    "",
    "      if (response.getStatusCode() < 200 ||",
    "          response.getStatusCode() >= 300) {",
    "        throw new IllegalStateException(",
    '          "HTTP " + response.getStatusCode() + " "',
    '            + response.getStatusText() + ": " + responseBody',
    "        );",
    "      }",
    "",
    "      System.out.println(responseBody);",
    "    }",
    "  }",
    "}",
  ].join("\n");
}
