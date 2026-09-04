import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeSh,
  fileComment,
  form,
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

function safeShellComment(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
}

function formFieldValue(value: unknown): string {
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
  const generatedBody = Boolean(body && canHaveBody);

  const comments: string[] = [
    "# Requires curl 7.76.0+.",
    "# Install: https://curl.se/download.html",
    "# Repeated headers and multipart fields are emitted separately.",
    "# --connect-timeout limits connection setup; --max-time limits the whole transfer.",
  ];

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      generatedBody &&
      (isContentLengthHeader(name) || isTransferEncodingHeader(name))
    ) {
      return false;
    }

    // curl must generate multipart Content-Type and its boundary.
    if (multipart && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  const lines: string[] = [
    `curl --fail-with-body --show-error --silent`,
    `  --connect-timeout 30`,
    `  --max-time 30`,
    `  --request ${escapeSh(method)}`,
    `  --url ${escapeSh(compiled.url)}`,
  ];

  for (const [rawName, rawValue] of headers) {
    lines.push(
      `  --header ${escapeSh(`${String(rawName)}: ${String(rawValue)}`)}`,
    );
  }

  if (body && canHaveBody && multipart) {
    for (const entry of toKeyValueBody(body.value)) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const actualPath = nonBlankString(fileValue.path);
        const filePath = actualPath ?? DEFAULT_FILE_PATH;
        const fileName = nonBlankString(fileValue.name) ?? DEFAULT_FILE_NAME;
        const contentType =
          nonBlankString(fileValue.contentType) ?? DEFAULT_BINARY_MEDIA_TYPE;

        if (actualPath === undefined) {
          comments.push(
            `# ${safeShellComment(fileComment(filePath, fieldName))}`,
          );
        }

        /*
         * curl multipart syntax:
         *   field=@path;filename=name;type=media/type
         *
         * --form-string is not used for files because it treats @ literally.
         */
        lines.push(
          `  --form ${escapeSh(
            `${fieldName}=@${filePath};filename=${fileName};type=${contentType}`,
          )}`,
        );
      } else {
        /*
         * --form-string prevents values beginning with @, <, or other curl
         * form metacharacters from being interpreted as files or commands.
         */
        lines.push(
          `  --form-string ${escapeSh(
            `${fieldName}=${formFieldValue(entry.value)}`,
          )}`,
        );
      }
    }
  } else if (body && canHaveBody) {
    const data = hasFormBody(request) ? form(body.value) : bodyText(request);

    /*
     * --data-binary preserves the generated body exactly, except that curl's
     * command-line argument interface cannot represent embedded NUL bytes.
     */
    lines.push(`  --data-binary ${escapeSh(data)}`);
  }

  const command = lines
    .map((line, index) => (index < lines.length - 1 ? `${line} \\` : line))
    .join("\n");

  return [...comments, command].join("\n");
}
