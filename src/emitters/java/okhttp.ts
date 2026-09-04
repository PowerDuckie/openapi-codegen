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
  requiresRequestBody,
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
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";

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
  const multipart = Boolean(
    body && canHaveBody && hasMultipartBody(request),
  );
  const generatedBody = Boolean(
    (body && canHaveBody) || (!body && requiresRequestBody(method)),
  );

  const comments: string[] = [
    "Requires JDK 17+ and OkHttp 4.12.0.",
    "Dependency: com.squareup.okhttp3:okhttp:4.12.0",
    "Compile: javac -cp 'lib/*' Example.java",
    "Run: java -cp '.:lib/*' Example",
  ];

  const imports = new Set<string>([
    "import java.io.IOException;",
    "import java.time.Duration;",
    "import okhttp3.OkHttpClient;",
    "import okhttp3.Request;",
    "import okhttp3.RequestBody;",
    "import okhttp3.Response;",
  ]);

  let bodyBlock: string;

  if (body && multipart) {
    imports.add("import java.io.File;");
    imports.add("import okhttp3.MediaType;");
    imports.add("import okhttp3.MultipartBody;");

    const parts: string[] = [];

    for (const entry of toKeyValueBody(body.value)) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const actualPath = nonBlankString(fileValue.path);
        const filePath = actualPath ?? DEFAULT_FILE_PATH;
        const fileName =
          nonBlankString(fileValue.name) ?? DEFAULT_FILE_NAME;
        const contentType =
          nonBlankString(fileValue.contentType) ??
          DEFAULT_BINARY_MEDIA_TYPE;

        if (!actualPath) {
          comments.push(
            safeComment(fileComment(filePath, fieldName)).replace(
              /^(?:\/\/|#)\s*/,
              "",
            ),
          );
        }

        parts.push(
          "      .addFormDataPart(",
          `        ${escapeJava(fieldName)},`,
          `        ${escapeJava(fileName)},`,
          "        RequestBody.create(",
          `          new File(${escapeJava(filePath)}),`,
          `          MediaType.get(${escapeJava(contentType)})`,
          "        )",
          "      )",
        );
      } else {
        parts.push(
          "      .addFormDataPart(",
          `        ${escapeJava(fieldName)},`,
          `        ${escapeJava(textFieldValue(entry.value))}`,
          "      )",
        );
      }
    }

    bodyBlock = [
      "    RequestBody body = new MultipartBody.Builder()",
      "      .setType(MultipartBody.FORM)",
      ...parts,
      "      .build();",
    ].join("\n");
  } else if (body && canHaveBody) {
    imports.add("import okhttp3.MediaType;");

    const isForm = hasFormBody(request);
    const isJson = hasJsonBody(request);
    const payload = isForm ? form(body.value) : bodyText(request);
    const fallbackMediaType = isForm
      ? "application/x-www-form-urlencoded"
      : isJson
        ? "application/json"
        : "text/plain";
    const mediaType = mediaTypeOf(request, fallbackMediaType);

    bodyBlock = [
      "    RequestBody body = RequestBody.create(",
      `      ${escapeJava(payload)},`,
      `      MediaType.get(${escapeJava(mediaType)})`,
      "    );",
    ].join("\n");
  } else if (!body && requiresRequestBody(method)) {
    bodyBlock = [
      "    RequestBody body = RequestBody.create(",
      "      new byte[0],",
      "      null",
      "    );",
    ].join("\n");
  } else {
    bodyBlock = "    RequestBody body = null;";
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

    // RequestBody supplies Content-Type, including multipart's boundary.
    if (generatedBody && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  const headerLines = headers.map(
    ([name, value]) =>
      `      .addHeader(${escapeJava(String(name))}, ${escapeJava(
        String(value),
      )})`,
  );

  return [
    ...comments.map((comment) => `// ${safeComment(comment)}`),
    "",
    [...imports].sort().join("\n"),
    "",
    "public final class Example {",
    "  private Example() {}",
    "",
    "  public static void main(String[] args) {",
    "    OkHttpClient client = new OkHttpClient.Builder()",
    "      .connectTimeout(Duration.ofSeconds(30))",
    "      .readTimeout(Duration.ofSeconds(30))",
    "      .writeTimeout(Duration.ofSeconds(30))",
    "      .callTimeout(Duration.ofSeconds(30))",
    "      .build();",
    "",
    bodyBlock,
    "",
    "    Request httpRequest = new Request.Builder()",
    `      .url(${escapeJava(compiled.url)})`,
    ...headerLines,
    `      .method(${escapeJava(method)}, body)`,
    "      .build();",
    "",
    "    try (Response response =",
    "        client.newCall(httpRequest).execute()) {",
    "      String responseText = response.body() == null",
    '        ? ""',
    "        : response.body().string();",
    "",
    "      if (!response.isSuccessful()) {",
    "        throw new IOException(",
    '          "HTTP " + response.code() + " " + response.message()',
    '            + ": " + responseText',
    "        );",
    "      }",
    "",
    "      System.out.println(responseText);",
    "    } catch (IOException exception) {",
    "      exception.printStackTrace();",
    "      System.exit(1);",
    "    } finally {",
    "      client.dispatcher().executorService().shutdown();",
    "      client.connectionPool().evictAll();",
    "      if (client.cache() != null) {",
    "        try {",
    "          client.cache().close();",
    "        } catch (IOException exception) {",
    "          exception.printStackTrace();",
    "        }",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");
}