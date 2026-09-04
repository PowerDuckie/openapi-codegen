import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeFSharp,
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

  const setupLines: string[] = [];
  const cleanupLines: string[] = [];
  let contentLines: string[] = [];

  if (body && multipart) {
    setupLines.push("    use multipart = new MultipartFormDataContent()");

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
            `    // ${safeComment(fileComment(filePath, fieldName))}`,
          );
        }

        setupLines.push(
          `    let ${streamVariable} = File.OpenRead(${escapeFSharp(filePath)})`,
          `    let ${contentVariable} = new StreamContent(${streamVariable})`,
          `    ${contentVariable}.Headers.ContentType <-`,
          `        MediaTypeHeaderValue.Parse(${escapeFSharp(contentType)})`,
          `    multipart.Add(`,
          `        ${contentVariable},`,
          `        ${escapeFSharp(fieldName)},`,
          `        ${escapeFSharp(fileName)}`,
          `    )`,
        );

        cleanupLines.unshift(
          `        ${contentVariable}.Dispose()`,
          `        ${streamVariable}.Dispose()`,
        );
      } else {
        const contentVariable = `fieldContent${index}`;

        setupLines.push(
          `    let ${contentVariable} =`,
          `        new StringContent(${escapeFSharp(multipartText(item.value))})`,
          `    multipart.Add(${contentVariable}, ${escapeFSharp(fieldName)})`,
        );
      }
    });

    contentLines = ["    request.Content <- multipart"];
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

    contentLines = [
      "    request.Content <-",
      `        new StringContent(`,
      `            ${escapeFSharp(payload)},`,
      "            Encoding.UTF8,",
      `            ${escapeFSharp(mediaType)}`,
      "        )",
    ];
  } else if (!body && requiresRequestBody(method)) {
    contentLines = [
      "    request.Content <- new ByteArrayContent(Array.empty<byte>)",
    ];
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

  const headerLines = headers.flatMap(([rawName, rawValue], index) => {
    const name = String(rawName);
    const value = String(rawValue);
    const resultVariable = `headerAdded${index}`;

    return [
      `    let ${resultVariable} =`,
      `        if isNull request.Content then`,
      `            request.Headers.TryAddWithoutValidation(`,
      `                ${escapeFSharp(name)},`,
      `                ${escapeFSharp(value)}`,
      "            )",
      "        else",
      `            request.Headers.TryAddWithoutValidation(`,
      `                ${escapeFSharp(name)},`,
      `                ${escapeFSharp(value)}`,
      "            )",
      `            || request.Content.Headers.TryAddWithoutValidation(`,
      `                ${escapeFSharp(name)},`,
      `                ${escapeFSharp(value)}`,
      "            )",
      `    if not ${resultVariable} then`,
      `        eprintfn ${escapeFSharp(`Ignored invalid header: ${safeComment(name)}`)}`,
    ];
  });

  return [
    "open System",
    "open System.IO",
    "open System.Net.Http",
    "open System.Net.Http.Headers",
    "open System.Text",
    "",
    "// Requires .NET 8 SDK or later.",
    "// Run with: dotnet run",
    "// Standard HTTP proxy environment variables are honored.",
    "[<EntryPoint>]",
    "let main _ =",
    "    use client = new HttpClient()",
    "    client.Timeout <- TimeSpan.FromSeconds(30.0)",
    "",
    "    use request =",
    "        new HttpRequestMessage(",
    `            new HttpMethod(${escapeFSharp(method)}),`,
    `            ${escapeFSharp(compiled.url)}`,
    "        )",
    "",
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    ...contentLines,
    ...(contentLines.length > 0 ? [""] : []),
    ...headerLines,
    ...(headerLines.length > 0 ? [""] : []),
    "    try",
    "        use response = client.Send(request)",
    "        let responseText = response.Content.ReadAsStringAsync().Result",
    "",
    "        if not response.IsSuccessStatusCode then",
    "            eprintfn",
    '                "HTTP %d %s: %s"',
    "                (int response.StatusCode)",
    "                response.ReasonPhrase",
    "                responseText",
    "            1",
    "        else",
    '            printfn "%s" responseText',
    "            0",
    "    with exception ->",
    '        eprintfn "Request failed: %s" exception.Message',
    "        1",
    ...(cleanupLines.length > 0 ? ["    finally", ...cleanupLines] : []),
  ].join("\n");
}
