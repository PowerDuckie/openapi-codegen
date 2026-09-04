import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeSh,
  fileComment,
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

function stringValue(value: unknown): string {
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
  const urlEncoded = Boolean(body && canHaveBody && hasFormBody(request));
  const generatedBody = Boolean(body && canHaveBody);

  const comments: string[] = [
    "Requires HTTPie 3.2+.",
    "Install: python3 -m pip install 'httpie>=3.2,<4'",
    "HTTPie preserves repeated header arguments and repeated form fields.",
  ];

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      generatedBody &&
      (isContentLengthHeader(name) || isTransferEncodingHeader(name))
    ) {
      return false;
    }

    if ((multipart || urlEncoded) && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  const parts: string[] = ["http", "--check-status", "--timeout=30"];

  if (multipart || urlEncoded) {
    parts.push("--form");
  }

  parts.push(escapeSh(method), escapeSh(compiled.url));

  for (const [rawName, rawValue] of headers) {
    parts.push(escapeSh(`${String(rawName)}:${String(rawValue)}`));
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
          comments.push(safeShellComment(fileComment(filePath, fieldName)));
        }

        parts.push(
          escapeSh(
            `${fieldName}@${filePath};type=${contentType};filename=${fileName}`,
          ),
        );
      } else {
        parts.push(escapeSh(`${fieldName}=${stringValue(entry.value)}`));
      }
    }
  } else if (body && canHaveBody && urlEncoded) {
    for (const entry of toKeyValueBody(body.value)) {
      parts.push(escapeSh(`${String(entry.name)}=${stringValue(entry.value)}`));
    }
  } else if (body && canHaveBody) {
    const command = [
      `printf '%s' ${escapeSh(bodyText(request))}`,
      "|",
      parts.join(" "),
    ].join(" ");

    return [
      ...comments.map((line) => `# ${safeShellComment(line)}`),
      command,
    ].join("\n");
  }

  const command = parts
    .map((part, index) => (index === 0 ? part : `  ${part}`))
    .join(" \\\n");

  return [
    ...comments.map((line) => `# ${safeShellComment(line)}`),
    command,
  ].join("\n");
}
