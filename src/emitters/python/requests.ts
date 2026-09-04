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

function pythonHeaderLines(headers: Array<[string, string]>): string[] {
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
  const setupLines: string[] = [];
  const requestArguments: string[] = [];

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

  if (body && canHaveBody) {
    if (multipart) {
      setupLines.push(
        "        data: list[tuple[str, str]] = []",
        [
          "        files: list[",
          "            tuple[str, tuple[str, BinaryIO, str]]",
          "        ] = []",
        ].join("\n"),
      );

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

          setupLines.push(
            `        file_handle = stack.enter_context(open(${escapePy(
              filePath,
            )}, "rb"))`,
            "        files.append(",
            "            (",
            `                ${escapePy(fieldName)},`,
            "                (",
            `                    ${escapePy(fileName)},`,
            "                    file_handle,",
            `                    ${escapePy(contentType)},`,
            "                ),",
            "            )",
            "        )",
          );
        } else {
          setupLines.push(
            `        data.append((${escapePy(fieldName)}, ${escapePy(
              formFieldValue(entry.value),
            )}))`,
          );
        }
      }

      requestArguments.push("                data=data,");
      requestArguments.push("                files=files,");
    } else if (hasFormBody(request)) {
      requestArguments.push(
        `                data=${escapePy(form(body.value))},`,
      );
    } else {
      /*
       * Send JSON and arbitrary bodies as serialized content. This avoids
       * emitting JSON syntax as invalid Python source and preserves the
       * exact body representation produced by bodyText().
       */
      requestArguments.push(
        `                data=${escapePy(bodyText(request))},`,
      );
    }
  }

  return [
    "# Requires Python 3.10 or later.",
    "# Requires Requests 2.31 or later:",
    "#   python -m pip install 'requests>=2.31'",
    "# Requests cannot preserve duplicate request headers; values are",
    "# combined with commas in their original order.",
    "# Duplicate multipart fields and files are preserved.",
    ...comments.map((comment) => `# ${comment}`),
    "",
    "from contextlib import ExitStack",
    "from typing import BinaryIO",
    "",
    "import requests",
    "",
    "",
    "def combine_headers(",
    "    values: list[tuple[str, str]],",
    ") -> dict[str, str]:",
    "    headers: dict[str, str] = {}",
    "    canonical_names: dict[str, str] = {}",
    "",
    "    for name, value in values:",
    "        normalized = name.lower()",
    "        existing_name = canonical_names.get(normalized)",
    "",
    "        if existing_name is None:",
    "            canonical_names[normalized] = name",
    "            headers[name] = value",
    "        else:",
    "            headers[existing_name] = (",
    "                f'{headers[existing_name]}, {value}'",
    "            )",
    "",
    "    return headers",
    "",
    "",
    "def main() -> None:",
    "    header_items: list[tuple[str, str]] = [",
    ...pythonHeaderLines(
      headers.map(
        ([name, value]) => [String(name), String(value)] as [string, string],
      ),
    ),
    "    ]",
    "    headers = combine_headers(header_items)",
    "",
    "    with ExitStack() as stack:",
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    "        try:",
    "            with requests.Session() as session:",
    "                response = session.request(",
    `                    method=${escapePy(method)},`,
    `                    url=${escapePy(compiled.url)},`,
    "                    headers=headers,",
    ...requestArguments,
    "                    timeout=30,",
    "                )",
    "",
    "                try:",
    "                    response_text = response.text",
    "",
    "                    if not 200 <= response.status_code < 300:",
    "                        raise RuntimeError(",
    '                            f"HTTP {response.status_code}: "',
    '                            f"{response_text}"',
    "                        )",
    "",
    "                    print(response_text)",
    "                finally:",
    "                    response.close()",
    "        except requests.RequestException as error:",
    "            raise RuntimeError(",
    '                f"HTTP request failed: {error}"',
    "            ) from error",
    "",
    "",
    'if __name__ == "__main__":',
    "    main()",
  ].join("\n");
}
