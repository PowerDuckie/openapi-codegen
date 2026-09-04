import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeCSharp,
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

  const bodyLines: string[] = [];

  if (body && multipart) {
    toKeyValueBody(body.value).forEach((item) => {
      const fieldName = String(item.name);

      if (item.file && isFileValue(item.value)) {
        const fileValue: FileValue = item.value;
        const filePath = nonBlankString(fileValue.path, DEFAULT_FILE_PATH);
        const fileName = nonBlankString(fileValue.name, DEFAULT_FILE_NAME);
        const contentType = nonBlankString(
          fileValue.contentType,
          DEFAULT_BINARY_MEDIA_TYPE,
        );

        if (
          typeof fileValue.path !== "string" ||
          fileValue.path.trim().length === 0
        ) {
          bodyLines.push(
            `        // ${safeComment(fileComment(filePath, fieldName))}`,
          );
        }

        bodyLines.push(
          "        requestMessage.AddFile(",
          `            ${escapeCSharp(fieldName)},`,
          `            ${escapeCSharp(filePath)},`,
          `            ${escapeCSharp(contentType)},`,
          `            ${escapeCSharp(fileName)}`,
          "        );",
        );
      } else {
        bodyLines.push(
          "        requestMessage.AddParameter(",
          `            ${escapeCSharp(fieldName)},`,
          `            ${escapeCSharp(multipartText(item.value))}`,
          "        );",
        );
      }
    });
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

    bodyLines.push(
      "        requestMessage.AddStringBody(",
      `            ${escapeCSharp(payload)},`,
      `            ContentType.FromMediaType(${escapeCSharp(mediaType)})`,
      "        );",
    );
  } else if (!body && requiresRequestBody(method)) {
    bodyLines.push(
      "        requestMessage.AddStringBody(",
      '            "",',
      "            ContentType.Binary",
      "        );",
    );
  }

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    return !(
      generatedBody &&
      (isContentLengthHeader(name) ||
        isTransferEncodingHeader(name) ||
        isContentTypeHeader(name))
    );
  });

  const headerLines = headers.map(
    ([name, value]) =>
      `        requestMessage.AddHeader(${escapeCSharp(
        String(name),
      )}, ${escapeCSharp(String(value))});`,
  );

  return [
    "using System;",
    "using System.Threading;",
    "using System.Threading.Tasks;",
    "using RestSharp;",
    "",
    "// Requires .NET 8 and RestSharp 112.x.",
    "// Add the dependency with: dotnet add package RestSharp",
    "// Run with: dotnet run",
    "internal static class Program",
    "{",
    "    private static async Task<int> Main()",
    "    {",
    "        var options = new RestClientOptions",
    "        {",
    `            BaseUrl = new Uri(${escapeCSharp(compiled.url)}),`,
    "            MaxTimeout = 30_000",
    "        };",
    "",
    "        using var client = new RestClient(options);",
    "        var requestMessage = new RestRequest(",
    '            resource: "",',
    `            method: new Method(${escapeCSharp(method)})`,
    "        );",
    "",
    ...headerLines,
    ...(headerLines.length > 0 ? [""] : []),
    ...bodyLines,
    ...(bodyLines.length > 0 ? [""] : []),
    "        using var cancellation =",
    "            new CancellationTokenSource(TimeSpan.FromSeconds(30));",
    "",
    "        try",
    "        {",
    "            var response = await client.ExecuteAsync(",
    "                requestMessage,",
    "                cancellation.Token",
    "            );",
    "            var responseText = response.Content ?? string.Empty;",
    "",
    "            if (!response.IsSuccessful)",
    "            {",
    "                Console.Error.WriteLine(",
    '                    $"HTTP {(int)response.StatusCode} " +',
    '                    $"{response.StatusDescription}: {responseText}"',
    "                );",
    "                return 1;",
    "            }",
    "",
    "            Console.Write(responseText);",
    "            return 0;",
    "        }",
    "        catch (OperationCanceledException exception)",
    "        {",
    '            Console.Error.WriteLine($"Request timed out: {exception.Message}");',
    "            return 1;",
    "        }",
    "        catch (Exception exception)",
    "        {",
    '            Console.Error.WriteLine($"Request failed: {exception.Message}");',
    "            return 1;",
    "        }",
    "    }",
    "}",
  ].join("\n");
}
