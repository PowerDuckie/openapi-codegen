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

function pythonHeaderList(headers: Array<[string, string]>): string[] {
  return headers.map(
    ([name, value]) =>
      `        (${escapePy(String(name))}, ${escapePy(String(value))}),`,
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
        "        files: list[tuple[str, tuple[str, BinaryIO, str]]] = []",
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
        `                content=${escapePy(form(body.value))},`,
      );
    } else {
      /*
       * JSON is intentionally emitted through content=bodyText(...), not
       * json=<Python literal>. stringifyLiteral() produces JSON syntax,
       * which is invalid Python for true, false, and null.
       */
      requestArguments.push(
        `                content=${escapePy(bodyText(request))},`,
      );
    }
  }

  return [
    "# Requires Python 3.10 or later.",
    "# Requires HTTPX 0.27 or later: python -m pip install 'httpx>=0.27'",
    "# Repeated request headers and multipart fields are preserved in order.",
    ...comments.map((comment) => `# ${comment}`),
    "",
    "import asyncio",
    "from contextlib import ExitStack",
    "from typing import BinaryIO",
    "",
    "import httpx",
    "",
    "",
    "async def main() -> None:",
    "    headers = [",
    ...pythonHeaderList(
      headers.map(
        ([name, value]) => [String(name), String(value)] as [string, string],
      ),
    ),
    "    ]",
    "",
    "    timeout = httpx.Timeout(30.0)",
    "",
    "    with ExitStack() as stack:",
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    "        try:",
    "            async with httpx.AsyncClient(timeout=timeout) as client:",
    "                response = await client.request(",
    `                    ${escapePy(method)},`,
    `                    ${escapePy(compiled.url)},`,
    "                    headers=headers,",
    ...requestArguments,
    "                )",
    "",
    "                if not 200 <= response.status_code < 300:",
    "                    raise RuntimeError(",
    '                        f"HTTP {response.status_code}: {response.text}"',
    "                    )",
    "",
    "                print(response.text)",
    "        except httpx.HTTPError as error:",
    '            raise RuntimeError(f"HTTP request failed: {error}") from error',
    "",
    "",
    'if __name__ == "__main__":',
    "    asyncio.run(main())",
  ].join("\n");
}
