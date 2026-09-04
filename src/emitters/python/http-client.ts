import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapePy,
  fileComment,
  form,
  formFieldValue,
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
    .replace(/^\/\/\s*/, "")
    .replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .trim();
}

function pythonHeaderList(headers: Array<[string, string]>): string[] {
  return headers.map(
    ([name, value]) =>
      `    (${escapePy(String(name))}, ${escapePy(String(value))}),`,
  );
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const generatedBody = Boolean(body && canHaveBody);
  const multipart = Boolean(body && canHaveBody && hasMultipartBody(request));

  const comments: string[] = [];
  const multipartSetup: string[] = [];

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

  if (body && multipart) {
    for (const entry of toKeyValueBody(body.value)) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const filePath = nonBlankString(fileValue.path) ?? DEFAULT_FILE_PATH;
        const fileName = nonBlankString(fileValue.name) ?? DEFAULT_FILE_NAME;
        const contentType =
          nonBlankString(fileValue.contentType) ?? DEFAULT_BINARY_MEDIA_TYPE;

        if (!nonBlankString(fileValue.path)) {
          comments.push(safeComment(fileComment(filePath, fieldName)));
        }

        multipartSetup.push(
          "    parts.append(",
          "        (",
          `            ${escapePy(fieldName)},`,
          `            ${escapePy(fileName)},`,
          `            ${escapePy(contentType)},`,
          `            Path(${escapePy(filePath)}).read_bytes(),`,
          "        )",
          "    )",
        );
      } else {
        multipartSetup.push(
          "    parts.append(",
          "        (",
          `            ${escapePy(fieldName)},`,
          "            None,",
          "            None,",
          `            ${escapePy(formFieldValue(entry.value))}.encode("utf-8"),`,
          "        )",
          "    )",
        );
      }
    }
  }

  let bodySetup: string[];

  if (!body || !canHaveBody) {
    bodySetup = ["    request_body = None"];
  } else if (multipart) {
    bodySetup = [
      '    boundary = f"----http-client-{secrets.token_hex(24)}"',
      "    parts: list[tuple[str, str | None, str | None, bytes]] = []",
      ...multipartSetup,
      "    request_body = encode_multipart(parts, boundary)",
      '    request_headers.append(("Content-Type", f"multipart/form-data; boundary={boundary}"))',
    ];
  } else if (hasJsonBody(request)) {
    bodySetup = [
      `    request_body = ${escapePy(bodyText(request))}.encode("utf-8")`,
    ];
  } else if (hasFormBody(request)) {
    bodySetup = [
      `    request_body = ${escapePy(form(body.value))}.encode("utf-8")`,
    ];
  } else {
    bodySetup = [
      `    request_body = ${escapePy(bodyText(request))}.encode("utf-8")`,
    ];
  }

  const imports = [
    "import http.client",
    "import secrets",
    "import urllib.parse",
    "from pathlib import Path",
  ];

  const helperLines = multipart
    ? [
        "",
        "",
        "def quote_disposition(value: str) -> str:",
        '    return value.replace("\\\\", "\\\\\\\\").replace(\'"\', \'\\\\"\')',
        "",
        "",
        "def encode_multipart(",
        "    parts: list[tuple[str, str | None, str | None, bytes]],",
        "    boundary: str,",
        ") -> bytes:",
        "    output = bytearray()",
        "    boundary_bytes = boundary.encode('ascii')",
        "",
        "    for field_name, file_name, content_type, value in parts:",
        "        output.extend(b'--' + boundary_bytes + b'\\r\\n')",
        "",
        "        disposition = (",
        "            'Content-Disposition: form-data; name=\"'",
        "            + quote_disposition(field_name)",
        "            + '\"'",
        "        )",
        "",
        "        if file_name is not None:",
        "            disposition += (",
        "                '; filename=\"'",
        "                + quote_disposition(file_name)",
        "                + '\"'",
        "            )",
        "",
        "        output.extend(disposition.encode('utf-8'))",
        "        output.extend(b'\\r\\n')",
        "",
        "        if content_type is not None:",
        "            output.extend(",
        "                f'Content-Type: {content_type}\\r\\n'.encode('utf-8')",
        "            )",
        "",
        "        output.extend(b'\\r\\n')",
        "        output.extend(value)",
        "        output.extend(b'\\r\\n')",
        "",
        "    output.extend(b'--' + boundary_bytes + b'--\\r\\n')",
        "    return bytes(output)",
      ]
    : [];

  return [
    "# Requires Python 3.10 or later.",
    "# Uses only the Python standard library; no installation is required.",
    "# Repeated request headers are preserved in their original order.",
    ...comments.map((comment) => `# ${comment}`),
    "",
    ...imports,
    ...helperLines,
    "",
    "",
    "def main() -> None:",
    `    parsed = urllib.parse.urlsplit(${escapePy(compiled.url)})`,
    "",
    "    if parsed.scheme not in {'http', 'https'}:",
    "        raise ValueError(",
    "            f\"Unsupported URL scheme: {parsed.scheme or 'missing'}\"",
    "        )",
    "",
    "    if parsed.hostname is None:",
    '        raise ValueError("The request URL must include a hostname")',
    "",
    "    path = urllib.parse.urlunsplit(",
    "        ('', '', parsed.path or '/', parsed.query, '')",
    "    )",
    "",
    "    request_headers: list[tuple[str, str]] = [",
    ...pythonHeaderList(
      headers.map(
        ([name, value]) => [String(name), String(value)] as [string, string],
      ),
    ),
    "    ]",
    ...bodySetup,
    "",
    "    connection_class = (",
    "        http.client.HTTPSConnection",
    "        if parsed.scheme == 'https'",
    "        else http.client.HTTPConnection",
    "    )",
    "",
    "    connection = connection_class(",
    "        parsed.hostname,",
    "        parsed.port,",
    "        timeout=30,",
    "    )",
    "",
    "    try:",
    `        connection.putrequest(${escapePy(method)}, path)`,
    "",
    "        for name, value in request_headers:",
    "            connection.putheader(name, value)",
    "",
    "        if request_body is not None:",
    "            connection.putheader('Content-Length', str(len(request_body)))",
    "",
    "        connection.endheaders(request_body)",
    "        response = connection.getresponse()",
    "",
    "        try:",
    "            response_body = response.read()",
    "            charset = response.headers.get_content_charset() or 'utf-8'",
    "            response_text = response_body.decode(",
    "                charset,",
    "                errors='replace',",
    "            )",
    "",
    "            if not 200 <= response.status < 300:",
    "                raise RuntimeError(",
    '                    f"HTTP {response.status} {response.reason}: "',
    "                    f'{response_text}'",
    "                )",
    "",
    "            print(response_text)",
    "        finally:",
    "            response.close()",
    "    except (OSError, http.client.HTTPException) as error:",
    '        raise RuntimeError(f"HTTP request failed: {error}") from error',
    "    finally:",
    "        connection.close()",
    "",
    "",
    "if __name__ == '__main__':",
    "    main()",
  ].join("\n");
}
