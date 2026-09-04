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
  const generatedBody = Boolean(
    (body && canHaveBody) || (!body && requiresRequestBody(method)),
  );

  const comments: string[] = [
    "Requires JDK 17+, Kotlin 1.9+, and OkHttp 4.12.0.",
    "Dependency: com.squareup.okhttp3:okhttp:4.12.0",
    "Compile: kotlinc Main.kt -cp okhttp-4.12.0.jar:okio-jvm-3.6.0.jar -include-runtime -d main.jar",
    "Run: java -cp main.jar:okhttp-4.12.0.jar:okio-jvm-3.6.0.jar MainKt",
    "OkHttp addHeader() preserves repeated request-header values.",
  ];

  const imports = new Set<string>([
    "import java.time.Duration",
    "import okhttp3.OkHttpClient",
    "import okhttp3.Request",
    "import okhttp3.RequestBody",
  ]);

  let bodyCode: string;

  if (body && multipart) {
    imports.add("import java.io.File");
    imports.add("import okhttp3.MediaType.Companion.toMediaType");
    imports.add("import okhttp3.MultipartBody");
    imports.add("import okhttp3.RequestBody.Companion.asRequestBody");

    const partCode: string[] = [];

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

        partCode.push(
          "    .addFormDataPart(",
          `      ${escapeJava(fieldName)},`,
          `      ${escapeJava(fileName)},`,
          `      File(${escapeJava(filePath)}).asRequestBody(`,
          `        ${escapeJava(contentType)}.toMediaType()`,
          "      )",
          "    )",
        );
      } else {
        partCode.push(
          "    .addFormDataPart(",
          `      ${escapeJava(fieldName)},`,
          `      ${escapeJava(textFieldValue(entry.value))}`,
          "    )",
        );
      }
    }

    bodyCode = [
      "  val body: RequestBody = MultipartBody.Builder()",
      "    .setType(MultipartBody.FORM)",
      ...partCode,
      "    .build()",
    ].join("\n");
  } else if (body && canHaveBody) {
    imports.add("import okhttp3.MediaType.Companion.toMediaType");
    imports.add("import okhttp3.RequestBody.Companion.toRequestBody");

    const isForm = hasFormBody(request);
    const isJson = hasJsonBody(request);
    const payload = isForm ? form(body.value) : bodyText(request);
    const fallbackMediaType = isForm
      ? "application/x-www-form-urlencoded"
      : isJson
        ? "application/json"
        : "text/plain";

    const mediaType = mediaTypeOf(request, fallbackMediaType);

    bodyCode = [
      "  val body: RequestBody =",
      `    ${escapeJava(payload)}.toRequestBody(`,
      `      ${escapeJava(mediaType)}.toMediaType()`,
      "    )",
    ].join("\n");
  } else if (requiresRequestBody(method)) {
    imports.add("import okhttp3.RequestBody.Companion.toRequestBody");

    bodyCode = [
      "  val body: RequestBody =",
      `    ${escapeJava("")}.toRequestBody(null)`,
    ].join("\n");
  } else {
    bodyCode = "  val body: RequestBody? = null";
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
     * MultipartBody must generate its boundary-bearing Content-Type.
     * Other generated RequestBody instances carry the selected media type.
     */
    if (generatedBody && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  const headerCode = headers.map(
    ([name, value]) =>
      `    .addHeader(${escapeJava(String(name))}, ${escapeJava(
        String(value),
      )})`,
  );

  return [
    [...imports].sort().join("\n"),
    "",
    ...comments.map((comment) => `// ${safeComment(comment)}`),
    "",
    "fun main() {",
    "  val client = OkHttpClient.Builder()",
    "    .connectTimeout(Duration.ofSeconds(30))",
    "    .readTimeout(Duration.ofSeconds(30))",
    "    .writeTimeout(Duration.ofSeconds(30))",
    "    .callTimeout(Duration.ofSeconds(30))",
    "    .build()",
    "",
    bodyCode,
    "",
    "  val httpRequest = Request.Builder()",
    `    .url(${escapeJava(compiled.url)})`,
    ...headerCode,
    `    .method(${escapeJava(method)}, body)`,
    "    .build()",
    "",
    "  try {",
    "    client.newCall(httpRequest).execute().use { response ->",
    "      val responseText = response.body?.string().orEmpty()",
    "",
    "      if (!response.isSuccessful) {",
    "        throw IllegalStateException(",
    '          "HTTP ${response.code} ${response.message}: $responseText"',
    "        )",
    "      }",
    "",
    "      println(responseText)",
    "    }",
    "  } finally {",
    "    client.dispatcher.executorService.shutdown()",
    "    client.connectionPool.evictAll()",
    "    client.cache?.close()",
    "  }",
    "}",
  ].join("\n");
}
