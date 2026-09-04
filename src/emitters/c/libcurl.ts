import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
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

function escapeCString(value: unknown): string {
  const text = String(value);
  let escaped = '"';

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);

    switch (code) {
      case 0x08:
        escaped += "\\b";
        break;
      case 0x09:
        escaped += "\\t";
        break;
      case 0x0a:
        escaped += "\\n";
        break;
      case 0x0c:
        escaped += "\\f";
        break;
      case 0x0d:
        escaped += "\\r";
        break;
      case 0x22:
        escaped += '\\"';
        break;
      case 0x5c:
        escaped += "\\\\";
        break;
      default:
        if (code < 0x20 || code === 0x7f) {
          escaped += `\\${code.toString(8).padStart(3, "0")}`;
        } else {
          escaped += text[index];
        }
    }
  }

  return `${escaped}"`;
}

function nonBlankString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0
    ? value
    : fallback;
}

function safeComment(value: unknown): string {
  return String(value)
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]+/g, " ")
    .replace(/\*\//g, "* /");
}

function multipartText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function slistAppend(variable: string, value: string): string[] {
  return [
    `  ${variable} = curl_slist_append(${variable}, ${escapeCString(value)});`,
    `  if (!${variable}) {`,
    `    fprintf(stderr, "Failed to allocate request headers\\n");`,
    `    exit_code = 1;`,
    `    goto cleanup;`,
    `  }`,
  ];
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const mustHaveBody = requiresRequestBody(method);
  const multipart = Boolean(body) && canHaveBody && hasMultipartBody(request);
  const hasGeneratedBody = canHaveBody && (Boolean(body) || mustHaveBody);

  const comments: string[] = [
    "/* Requires libcurl development headers and library. */",
    "/* Build: cc example.c -o example $(pkg-config --cflags --libs libcurl) */",
    "/* Proxy and TLS trust settings may be read from the environment. */",
  ];

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      hasGeneratedBody &&
      (isContentLengthHeader(name) || isTransferEncodingHeader(name))
    ) {
      return false;
    }

    if (multipart && isContentTypeHeader(name)) {
      return false;
    }

    if (hasGeneratedBody && !multipart && body && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  const headerSetup: string[] = [];
  for (const [name, value] of headers) {
    headerSetup.push(
      ...slistAppend("headers", `${String(name)}: ${String(value)}`),
    );
  }

  const bodySetup: string[] = [];
  let usesMime = false;

  if (multipart && body) {
    usesMime = true;

    toKeyValueBody(body.value).forEach((entry, index) => {
      const fieldName = String(entry.name);
      const part = `part${index}`;

      bodySetup.push(
        `  curl_mimepart *${part} = curl_mime_addpart(mime);`,
        `  if (!${part}) {`,
        `    fprintf(stderr, "Failed to allocate multipart field\\n");`,
        `    exit_code = 1;`,
        `    goto cleanup;`,
        `  }`,
        `  if (curl_mime_name(${part}, ${escapeCString(fieldName)}) != CURLE_OK) {`,
        `    fprintf(stderr, "Failed to set multipart field name\\n");`,
        `    exit_code = 1;`,
        `    goto cleanup;`,
        `  }`,
      );

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const path = nonBlankString(fileValue.path, DEFAULT_FILE_PATH);
        const name = nonBlankString(fileValue.name, DEFAULT_FILE_NAME);
        const contentType = nonBlankString(
          fileValue.contentType,
          DEFAULT_BINARY_MEDIA_TYPE,
        );

        if (
          typeof fileValue.path !== "string" ||
          fileValue.path.trim().length === 0
        ) {
          comments.push(`/* ${safeComment(fileComment(path, fieldName))} */`);
        }

        bodySetup.push(
          `  if (curl_mime_filedata(${part}, ${escapeCString(path)}) != CURLE_OK ||`,
          `      curl_mime_filename(${part}, ${escapeCString(name)}) != CURLE_OK ||`,
          `      curl_mime_type(${part}, ${escapeCString(contentType)}) != CURLE_OK) {`,
          `    fprintf(stderr, "Failed to configure multipart file\\n");`,
          `    exit_code = 1;`,
          `    goto cleanup;`,
          `  }`,
        );
      } else {
        bodySetup.push(
          `  if (curl_mime_data(${part}, ${escapeCString(multipartText(entry.value))}, CURL_ZERO_TERMINATED) != CURLE_OK) {`,
          `    fprintf(stderr, "Failed to configure multipart field\\n");`,
          `    exit_code = 1;`,
          `    goto cleanup;`,
          `  }`,
        );
      }
    });
  } else if (hasGeneratedBody) {
    const isForm = Boolean(body) && hasFormBody(request);
    const isJson = Boolean(body) && hasJsonBody(request);
    const payload = body ? (isForm ? form(body.value) : bodyText(request)) : "";

    const fallbackMediaType = isForm
      ? "application/x-www-form-urlencoded"
      : isJson
        ? "application/json"
        : "text/plain";

    const mediaType = body
      ? mediaTypeOf(request, fallbackMediaType)
      : fallbackMediaType;

    bodySetup.push(
      ...slistAppend("headers", `Content-Type: ${mediaType}`),
      `  curl_easy_setopt(curl, CURLOPT_POSTFIELDS, ${escapeCString(payload)});`,
      "  curl_easy_setopt(curl, CURLOPT_POSTFIELDSIZE_LARGE, (curl_off_t)-1);",
    ); //Cannot find name 'Buffer'. Do you need to install type definitions for node? Try `npm i --save-dev @types/node` and then add 'node' to the types field in your tsconfig.ts(2591)
  }

  return [
    "#include <curl/curl.h>",
    "#include <stdio.h>",
    "",
    ...comments,
    "",
    "int main(void) {",
    "  int exit_code = 0;",
    "  CURLcode result;",
    "  long status = 0;",
    "  struct curl_slist *headers = NULL;",
    ...(usesMime ? ["  curl_mime *mime = NULL;"] : []),
    "",
    "  if (curl_global_init(CURL_GLOBAL_DEFAULT) != CURLE_OK) {",
    '    fprintf(stderr, "Failed to initialize libcurl\\n");',
    "    return 1;",
    "  }",
    "",
    "  CURL *curl = curl_easy_init();",
    "  if (!curl) {",
    '    fprintf(stderr, "Failed to create libcurl handle\\n");',
    "    curl_global_cleanup();",
    "    return 1;",
    "  }",
    ...(usesMime
      ? [
          "",
          "  mime = curl_mime_init(curl);",
          "  if (!mime) {",
          '    fprintf(stderr, "Failed to create multipart body\\n");',
          "    exit_code = 1;",
          "    goto cleanup;",
          "  }",
        ]
      : []),
    "",
    `  curl_easy_setopt(curl, CURLOPT_URL, ${escapeCString(compiled.url)});`,
    `  curl_easy_setopt(curl, CURLOPT_CUSTOMREQUEST, ${escapeCString(method)});`,
    "  curl_easy_setopt(curl, CURLOPT_CONNECTTIMEOUT, 30L);",
    "  curl_easy_setopt(curl, CURLOPT_TIMEOUT, 30L);",
    "  curl_easy_setopt(curl, CURLOPT_FOLLOWLOCATION, 1L);",
    "  curl_easy_setopt(curl, CURLOPT_NOSIGNAL, 1L);",
    "  curl_easy_setopt(curl, CURLOPT_WRITEFUNCTION, fwrite);",
    "  curl_easy_setopt(curl, CURLOPT_WRITEDATA, stdout);",
    "",
    ...headerSetup,
    ...(headerSetup.length > 0 ? [""] : []),
    ...bodySetup,
    ...(bodySetup.length > 0 ? [""] : []),
    ...(usesMime ? ["  curl_easy_setopt(curl, CURLOPT_MIMEPOST, mime);"] : []),
    "  if (headers) {",
    "    curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);",
    "  }",
    "",
    "  result = curl_easy_perform(curl);",
    "  if (result != CURLE_OK) {",
    '    fprintf(stderr, "Request failed: %s\\n", curl_easy_strerror(result));',
    "    exit_code = 1;",
    "    goto cleanup;",
    "  }",
    "",
    "  if (curl_easy_getinfo(curl, CURLINFO_RESPONSE_CODE, &status) != CURLE_OK) {",
    '    fprintf(stderr, "Failed to read HTTP status\\n");',
    "    exit_code = 1;",
    "    goto cleanup;",
    "  }",
    "",
    "  if (status < 200 || status >= 300) {",
    '    fprintf(stderr, "\\nHTTP request failed with status %ld\\n", status);',
    "    exit_code = 1;",
    "  }",
    "",
    "cleanup:",
    ...(usesMime ? ["  curl_mime_free(mime);"] : []),
    "  curl_slist_free_all(headers);",
    "  curl_easy_cleanup(curl);",
    "  curl_global_cleanup();",
    "  return exit_code;",
    "}",
  ].join("\n");
}
