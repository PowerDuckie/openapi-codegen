import {
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapePowerShell,
  fileComment,
  form,
  formFieldValue,
  hasFormBody,
  hasMultipartBody,
  isContentLengthHeader,
  isContentTypeHeader,
  isFileValue,
  isTransferEncodingHeader,
  nonBlankString,
  normalizeMethod,
  supportsRequestBody,
  toKeyValueBody,
} from "../common";
import type { FileValue, RequestIR } from "../../types";

function safeComment(value: string): string {
  return value
    .replace(/^\/\/\s*/, "")
    .replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .trim();
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const multipart = Boolean(body) && canHaveBody && hasMultipartBody(request);
  const generatedBody = Boolean(body && canHaveBody);

  const comments: string[] = [];
  const setupLines: string[] = [];

  if (body && multipart) {
    setupLines.push("$form = [ordered]@{}");

    for (const entry of toKeyValueBody(body.value)) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const filePath = nonBlankString(fileValue.path) ?? DEFAULT_FILE_PATH;

        if (!nonBlankString(fileValue.path)) {
          comments.push(safeComment(fileComment(filePath, fieldName)));
        }

        setupLines.push(
          `$form[${escapePowerShell(fieldName)}] = Get-Item -LiteralPath ${escapePowerShell(
            filePath,
          )} -ErrorAction Stop`,
        );
      } else {
        setupLines.push(
          `$form[${escapePowerShell(fieldName)}] = ${escapePowerShell(
            formFieldValue(entry.value),
          )}`,
        );
      }
    }
  }

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      generatedBody &&
      (isContentLengthHeader(name) || isTransferEncodingHeader(name))
    ) {
      return false;
    }

    return !multipart || !isContentTypeHeader(name);
  });

  const contentTypeHeader = headers.find(([name]) =>
    isContentTypeHeader(String(name)),
  );

  const ordinaryHeaders = headers.filter(
    ([name]) => !isContentTypeHeader(String(name)),
  );

  /*
   * Invoke-WebRequest accepts a Hashtable for -Headers but cannot reliably
   * represent repeated header fields. Combine repeated values in insertion
   * order instead of silently overwriting them.
   */
  const groupedHeaders = new Map<string, { name: string; values: string[] }>();

  for (const [rawName, rawValue] of ordinaryHeaders) {
    const name = String(rawName);
    const key = name.trim().toLowerCase();
    const current = groupedHeaders.get(key);

    if (current) {
      current.values.push(String(rawValue));
    } else {
      groupedHeaders.set(key, {
        name,
        values: [String(rawValue)],
      });
    }
  }

  const headerLines = [...groupedHeaders.values()].map(
    ({ name, values }) =>
      `$headers[${escapePowerShell(name)}] = ${escapePowerShell(
        values.join(", "),
      )}`,
  );

  const bodyParameterLines =
    !body || !canHaveBody
      ? []
      : multipart
        ? ["$parameters['Form'] = $form"]
        : [
            `$parameters['Body'] = ${escapePowerShell(
              hasFormBody(request) ? form(body.value) : bodyText(request),
            )}`,
          ];

  return [
    "# Requires PowerShell 7.4 or later.",
    "# Multipart uploads require Invoke-WebRequest -Form support.",
    "# Repeated request-header values are combined with commas.",
    "",
    ...comments.map((comment) => `# ${comment}`),
    ...(comments.length > 0 ? [""] : []),
    "$headers = @{}",
    ...headerLines,
    "",
    "$parameters = @{",
    `  Method = ${escapePowerShell(method)}`,
    `  Uri = ${escapePowerShell(compiled.url)}`,
    "  Headers = $headers",
    "  TimeoutSec = 30",
    "  ErrorAction = 'Stop'",
    ...(contentTypeHeader && !multipart
      ? [`  ContentType = ${escapePowerShell(String(contentTypeHeader[1]))}`]
      : []),
    "}",
    ...(setupLines.length > 0 ? ["", ...setupLines] : []),
    ...(bodyParameterLines.length > 0 ? ["", ...bodyParameterLines] : []),
    "",
    "try {",
    "  $response = Invoke-WebRequest @parameters",
    "  $response.Content",
    "} catch {",
    "  $statusCode = $null",
    "  $responseBody = $null",
    "",
    "  if ($null -ne $_.Exception.Response) {",
    "    $statusCode = [int]$_.Exception.Response.StatusCode",
    "  }",
    "",
    "  if ($null -ne $_.ErrorDetails -and $_.ErrorDetails.Message) {",
    "    $responseBody = $_.ErrorDetails.Message",
    "  }",
    "",
    "  if ($null -ne $statusCode) {",
    '    $message = "HTTP ${statusCode}: ${responseBody}"',
    "  } else {",
    "    $message = $_.Exception.Message",
    "  }",
    "",
    "  throw [System.Net.Http.HttpRequestException]::new(",
    "    $message,",
    "    $_.Exception",
    "  )",
    "}",
  ].join("\n");
}
