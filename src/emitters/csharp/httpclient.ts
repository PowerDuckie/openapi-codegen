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

  const setupLines: string[] = [];
  const disposalLines: string[] = [];
  let contentAssigned = false;

  if (body && multipart) {
    setupLines.push(
      "            var multipart = new MultipartFormDataContent();",
    );
    disposalLines.push("            multipart.Dispose();");

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
        const streamVariable = `fileStream${index}`;
        const contentVariable = `fileContent${index}`;

        if (
          typeof fileValue.path !== "string" ||
          fileValue.path.trim().length === 0
        ) {
          setupLines.push(
            `            // ${safeComment(fileComment(filePath, fieldName))}`,
          );
        }

        setupLines.push(
          `            var ${streamVariable} = File.OpenRead(${escapeCSharp(filePath)});`,
          `            var ${contentVariable} = new StreamContent(${streamVariable});`,
          `            ${contentVariable}.Headers.ContentType =`,
          `                MediaTypeHeaderValue.Parse(${escapeCSharp(contentType)});`,
          "            multipart.Add(",
          `                ${contentVariable},`,
          `                ${escapeCSharp(fieldName)},`,
          `                ${escapeCSharp(fileName)}`,
          "            );",
        );
      } else {
        setupLines.push(
          "            multipart.Add(",
          `                new StringContent(${escapeCSharp(multipartText(item.value))}),`,
          `                ${escapeCSharp(fieldName)}`,
          "            );",
        );
      }
    });

    setupLines.push("            message.Content = multipart;");
    contentAssigned = true;
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

    setupLines.push(
      "            message.Content = new StringContent(",
      `                ${escapeCSharp(payload)},`,
      "                Encoding.UTF8,",
      `                ${escapeCSharp(mediaType)}`,
      "            );",
    );
    contentAssigned = true;
  } else if (!body && requiresRequestBody(method)) {
    setupLines.push(
      "            message.Content = new ByteArrayContent(Array.Empty<byte>());",
    );
    contentAssigned = true;
  }

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    return !(
      generatedBody &&
      (isContentLengthHeader(name) ||
        isTransferEncodingHeader(name) ||
        (contentAssigned && isContentTypeHeader(name)))
    );
  });

  const headerLines = headers.flatMap(([rawName, rawValue], index) => {
    const name = String(rawName);
    const value = String(rawValue);
    const variable = `headerAdded${index}`;

    return [
      `            var ${variable} = message.Headers.TryAddWithoutValidation(`,
      `                ${escapeCSharp(name)},`,
      `                ${escapeCSharp(value)}`,
      "            );",
      ...(contentAssigned
        ? [
            `            if (!${variable})`,
            "            {",
            `                ${variable} = message.Content!.Headers.TryAddWithoutValidation(`,
            `                    ${escapeCSharp(name)},`,
            `                    ${escapeCSharp(value)}`,
            "                );",
            "            }",
          ]
        : []),
      `            if (!${variable})`,
      "            {",
      `                Console.Error.WriteLine(${escapeCSharp(
        `Ignored invalid header: ${safeComment(name)}`,
      )});`,
      "            }",
    ];
  });

  return [
    "using System;",
    "using System.IO;",
    "using System.Net.Http;",
    "using System.Net.Http.Headers;",
    "using System.Text;",
    "using System.Threading;",
    "using System.Threading.Tasks;",
    "",
    "// Requires .NET 8 SDK or later.",
    "// Create and run with: dotnet new console && dotnet run",
    "// Standard HTTP proxy environment variables are honored.",
    "internal static class Program",
    "{",
    "    private static async Task<int> Main()",
    "    {",
    "        using var client = new HttpClient",
    "        {",
    "            Timeout = TimeSpan.FromSeconds(30)",
    "        };",
    "",
    "        using var message = new HttpRequestMessage(",
    `            new HttpMethod(${escapeCSharp(method)}),`,
    `            ${escapeCSharp(compiled.url)}`,
    "        );",
    "",
    "        using var cancellation =",
    "            new CancellationTokenSource(TimeSpan.FromSeconds(30));",
    "",
    "        try",
    "        {",
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    ...headerLines,
    ...(headerLines.length > 0 ? [""] : []),
    "            using var response = await client.SendAsync(",
    "                message,",
    "                HttpCompletionOption.ResponseHeadersRead,",
    "                cancellation.Token",
    "            );",
    "            var responseText =",
    "                await response.Content.ReadAsStringAsync(cancellation.Token);",
    "",
    "            if (!response.IsSuccessStatusCode)",
    "            {",
    "                Console.Error.WriteLine(",
    '                    $"HTTP {(int)response.StatusCode} " +',
    '                    $"{response.ReasonPhrase}: {responseText}"',
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
    ...(disposalLines.length > 0
      ? ["        finally", "        {", ...disposalLines, "        }"]
      : []),
    "    }",
    "}",
  ].join("\n");
}
