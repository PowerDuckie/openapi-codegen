import {
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

function safeComment(value: string): string {
  return value
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
    "import kong.unirest.HttpRequest;",
    "import kong.unirest.HttpResponse;",
    "import kong.unirest.Unirest;",
  ]);

  const comments: string[] = [
    "// Requires JDK 17+ and com.konghq:unirest-java:3.14.5.",
    "// Compile and run with the Unirest dependency and its transitive dependencies on the classpath.",
    "// Proxy and TLS behavior can be configured through Unirest.config() when required.",
  ];

  /*
   * Generated entities own their framing headers. Multipart additionally owns
   * Content-Type because Unirest must append the generated boundary.
   */
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

  const emitHeaders = (source: Array<[unknown, unknown]>): string[] =>
    source.map(
      ([name, value]) =>
        `      .header(${escapeJava(String(name))}, ${escapeJava(
          String(value),
        )})`,
    );

  let requestDeclaration: string[];

  if (body && multipart) {
    imports.add("import java.io.File;");

    const fieldLines = toKeyValueBody(body.value).map((entry) => {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const filePath = nonBlankString(fileValue.path, DEFAULT_FILE_PATH);

        if (
          typeof fileValue.path !== "string" ||
          fileValue.path.trim().length === 0
        ) {
          comments.push(`// ${safeComment(fileComment(filePath, fieldName))}`);
        }

        /*
         * The portable Unirest File overload derives filename and media type
         * from the File. It cannot consistently override both metadata values
         * across supported Unirest 3.x releases.
         */
        return [
          "      .field(",
          `        ${escapeJava(fieldName)},`,
          `        new File(${escapeJava(filePath)})`,
          "      )",
        ].join("\n");
      }

      return [
        "      .field(",
        `        ${escapeJava(fieldName)},`,
        `        ${escapeJava(multipartText(entry.value))}`,
        "      )",
      ].join("\n");
    });

    const chain = [
      `      Unirest.request(${escapeJava(method)}, ${escapeJava(compiled.url)})`,
      ...emitHeaders(headers),
      ...fieldLines,
    ];

    chain[chain.length - 1] = `${chain[chain.length - 1]};`;
    requestDeclaration = ["    HttpRequest<?> httpRequest =", ...chain];
  } else if (body && canHaveBody) {
    const isForm = hasFormBody(request);
    const isJson = hasJsonBody(request);
    const payload = isForm ? form(body.value) : bodyText(request);
    const fallbackMediaType = isForm
      ? "application/x-www-form-urlencoded"
      : isJson
        ? "application/json"
        : "text/plain";
    const mediaType = mediaTypeOf(request, fallbackMediaType);

    const effectiveHeaders = headers.filter(
      ([name]) => !isContentTypeHeader(String(name)),
    );

    requestDeclaration = [
      "    HttpRequest<?> httpRequest =",
      `      Unirest.request(${escapeJava(method)}, ${escapeJava(compiled.url)})`,
      ...emitHeaders(effectiveHeaders),
      `      .header("Content-Type", ${escapeJava(mediaType)})`,
      `      .body(${escapeJava(payload)});`,
    ];
  } else if (!body && requiresRequestBody(method)) {
    const effectiveHeaders = headers.filter(
      ([name]) => !isContentTypeHeader(String(name)),
    );

    requestDeclaration = [
      "    HttpRequest<?> httpRequest =",
      `      Unirest.request(${escapeJava(method)}, ${escapeJava(compiled.url)})`,
      ...emitHeaders(effectiveHeaders),
      `      .header("Content-Type", "application/octet-stream")`,
      '      .body("");',
    ];
  } else {
    const chain = [
      `      Unirest.request(${escapeJava(method)}, ${escapeJava(compiled.url)})`,
      ...emitHeaders(headers),
    ];

    chain[chain.length - 1] = `${chain[chain.length - 1]};`;
    requestDeclaration = ["    HttpRequest<?> httpRequest =", ...chain];
  }

  return [
    [...imports].sort().join("\n"),
    "",
    ...comments,
    "public final class Example {",
    "  private Example() {}",
    "",
    "  public static void main(String[] args) {",
    "    int exitCode = 0;",
    "",
    "    try {",
    "      Unirest.config()",
    "        .connectTimeout(30_000)",
    "        .requestTimeout(30_000);",
    "",
    ...requestDeclaration.map((line) => `  ${line}`),
    "",
    "      HttpResponse<String> response = httpRequest.asString();",
    "      String responseText = response.getBody() == null",
    '        ? ""',
    "        : response.getBody();",
    "",
    "      if (!response.isSuccess()) {",
    "        System.err.println(",
    '          "HTTP " + response.getStatus() + " "',
    '            + response.getStatusText() + ": " + responseText',
    "        );",
    "        exitCode = 1;",
    "      } else {",
    "        System.out.println(responseText);",
    "      }",
    "    } catch (RuntimeException exception) {",
    "      exception.printStackTrace();",
    "      exitCode = 1;",
    "    } finally {",
    "      Unirest.shutDown();",
    "    }",
    "",
    "    if (exitCode != 0) {",
    "      System.exit(exitCode);",
    "    }",
    "  }",
    "}",
  ].join("\n");
}
