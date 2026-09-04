import {
  bodyText,
  compile,
  escapeJs,
  form,
  hasFormBody,
  hasJsonBody,
  isContentLengthHeader,
  isContentTypeHeader,
  isTransferEncodingHeader,
  mediaTypeOf,
  normalizeMethod,
  requiresRequestBody,
  supportsRequestBody,
} from "../common";
import type { RequestIR } from "../../types";

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const generatedBody =
    Boolean(body && canHaveBody) || (!body && requiresRequestBody(method));

  let payload: string | undefined;
  let contentType: string | undefined;

  if (body && canHaveBody) {
    const isForm = hasFormBody(request);
    const isJson = hasJsonBody(request);

    payload = isForm ? form(body.value) : bodyText(request);
    contentType = mediaTypeOf(
      request,
      isForm
        ? "application/x-www-form-urlencoded"
        : isJson
          ? "application/json"
          : "text/plain",
    );
  } else if (!body && requiresRequestBody(method)) {
    payload = "";
  }

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    return !(
      generatedBody &&
      (isContentLengthHeader(name) ||
        isTransferEncodingHeader(name) ||
        (contentType !== undefined && isContentTypeHeader(name)))
    );
  });

  const headerLines = headers.map(
    ([name, value]) =>
      `  request.headers.add(${escapeJs(String(name))}, ${escapeJs(
        String(value),
      )});`,
  );

  if (contentType !== undefined) {
    headerLines.push(
      `  request.headers[${escapeJs("Content-Type")}] = ${escapeJs(
        contentType,
      )};`,
    );
  }

  return [
    "import 'dart:async';",
    "import 'dart:io';",
    "",
    "import 'package:http/http.dart' as http;",
    "",
    "// Requires Dart 3 and package:http.",
    "// Add the dependency with: dart pub add http",
    "// Run with: dart run",
    "Future<void> main() async {",
    "  final client = http.Client();",
    "",
    "  try {",
    `    final request = http.Request(${escapeJs(method)}, Uri.parse(${escapeJs(
      compiled.url,
    )}));`,
    ...headerLines.map((line) => `  ${line}`),
    ...(payload !== undefined
      ? [`    request.body = ${escapeJs(payload)};`]
      : []),
    "",
    "    final streamedResponse = await client",
    "        .send(request)",
    "        .timeout(const Duration(seconds: 30));",
    "    final responseText = await streamedResponse.stream",
    "        .bytesToString()",
    "        .timeout(const Duration(seconds: 30));",
    "",
    "    if (streamedResponse.statusCode < 200 ||",
    "        streamedResponse.statusCode >= 300) {",
    "      stderr.writeln(",
    "        'HTTP ${streamedResponse.statusCode} '",
    "        '${streamedResponse.reasonPhrase ?? ''}: $responseText',",
    "      );",
    "      exitCode = 1;",
    "      return;",
    "    }",
    "",
    "    stdout.write(responseText);",
    "  } on TimeoutException catch (exception) {",
    "    stderr.writeln('Request timed out: $exception');",
    "    exitCode = 1;",
    "  } on Object catch (exception, stackTrace) {",
    "    stderr.writeln('Request failed: $exception');",
    "    stderr.writeln(stackTrace);",
    "    exitCode = 1;",
    "  } finally {",
    "    client.close();",
    "  }",
    "}",
  ].join("\n");
}