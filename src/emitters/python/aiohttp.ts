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

function pythonHeaderList(headers: Array<[string, string]>): string {
  if (headers.length === 0) return "[]";

  return [
    "[",
    ...headers.map(
      ([name, value]) =>
        `        (${escapePy(String(name))}, ${escapePy(String(value))}),`,
    ),
    "    ]",
  ].join("\n");
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
  let bodyArgument: string | undefined;

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
      setupLines.push("    form_data = aiohttp.FormData(quote_fields=True)");

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
            `    file_handle = stack.enter_context(open(${escapePy(
              filePath,
            )}, "rb"))`,
            [
              "    form_data.add_field(",
              `        ${escapePy(fieldName)},`,
              "        file_handle,",
              `        filename=${escapePy(fileName)},`,
              `        content_type=${escapePy(contentType)},`,
              "    )",
            ].join("\n"),
          );
        } else {
          setupLines.push(
            [
              "    form_data.add_field(",
              `        ${escapePy(fieldName)},`,
              `        ${escapePy(formFieldValue(entry.value))},`,
              "    )",
            ].join("\n"),
          );
        }
      }

      bodyArgument = "data=form_data,";
    } else if (hasJsonBody(request)) {
      /*
       * Pass serialized JSON as data rather than json= so values outside
       * Python's literal syntax remain valid, and bodyText() is used only once.
       */
      bodyArgument = `data=${escapePy(bodyText(request))},`;
    } else if (hasFormBody(request)) {
      bodyArgument = `data=${escapePy(form(body.value))},`;
    } else {
      bodyArgument = `data=${escapePy(bodyText(request))},`;
    }
  }

  return [
    "# Requires Python 3.10 or later.",
    "# Requires aiohttp 3.9 or later: python -m pip install 'aiohttp>=3.9'",
    "# Repeated request headers are preserved in their original order.",
    ...comments.map((comment) => `# ${comment}`),
    "",
    "import asyncio",
    "from contextlib import ExitStack",
    "",
    "import aiohttp",
    "",
    "",
    "async def main() -> None:",
    "    headers = aiohttp.CIMultiDict(",
    `    ${pythonHeaderList(
      headers.map(
        ([name, value]) => [String(name), String(value)] as [string, string],
      ),
    )}`,
    "    )",
    "",
    "    timeout = aiohttp.ClientTimeout(total=30)",
    "",
    "    with ExitStack() as stack:",
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    "        try:",
    "            async with aiohttp.ClientSession(",
    "                headers=headers,",
    "                timeout=timeout,",
    "            ) as session:",
    "                async with session.request(",
    `                    ${escapePy(method)},`,
    `                    ${escapePy(compiled.url)},`,
    ...(bodyArgument ? [`                    ${bodyArgument}`] : []),
    "                ) as response:",
    "                    response_body = await response.text(errors='replace')",
    "",
    "                    if not 200 <= response.status < 300:",
    "                        raise RuntimeError(",
    '                            f"HTTP {response.status}: {response_body}"',
    "                        )",
    "",
    "                    print(response_body)",
    "        except (aiohttp.ClientError, asyncio.TimeoutError) as error:",
    '            raise RuntimeError(f"HTTP request failed: {error}") from error',
    "",
    "",
    'if __name__ == "__main__":',
    "    asyncio.run(main())",
  ].join("\n");
}
