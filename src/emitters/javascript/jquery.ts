import {
  bodyText,
  browserHeaders,
  compile,
  escapeJs,
  form,
  hasFormBody,
  hasMultipartBody,
  isContentLengthHeader,
  isContentTypeHeader,
  isFileValue,
  isTransferEncodingHeader,
  normalizeMethod,
  supportsRequestBody,
  toKeyValueBody,
  formFieldValue,
} from "../common";
import type { RequestIR } from "../../types";

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const multipart = Boolean(body && canHaveBody && hasMultipartBody(request));
  const generatedBody = Boolean(body && canHaveBody);

  const entries = body && multipart ? toKeyValueBody(body.value) : [];

  const parameters: string[] = [];
  const setupLines: string[] = [];
  let dataExpression: string | undefined;

  if (multipart) {
    setupLines.push("  const formData = new FormData();");

    let fileIndex = 0;

    for (const entry of entries) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        fileIndex += 1;
        const parameterName = `file${fileIndex}`;

        parameters.push(parameterName);
        setupLines.push(
          `  formData.append(${escapeJs(fieldName)}, ${parameterName});`,
        );
      } else {
        setupLines.push(
          `  formData.append(${escapeJs(fieldName)}, ${escapeJs(
            formFieldValue(entry.value),
          )});`,
        );
      }
    }

    dataExpression = "formData";
  } else if (body && canHaveBody) {
    dataExpression = escapeJs(
      hasFormBody(request) ? form(body.value) : bodyText(request),
    );
  }

  /*
   * Browsers prohibit or control some request headers. Repeated values cannot
   * be represented reliably by jQuery's plain headers object, so values are
   * safely combined according to the browser header model.
   */
  const headers = browserHeaders(compiled.headers, multipart).filter(
    ([rawName]) => {
      const name = String(rawName);

      if (
        generatedBody &&
        (isContentLengthHeader(name) || isTransferEncodingHeader(name))
      ) {
        return false;
      }

      // FormData must generate Content-Type together with its boundary.
      if (multipart && isContentTypeHeader(name)) {
        return false;
      }

      return true;
    },
  );

  const headerSetupLines = headers.map(
    ([name, value]) =>
      `  headers.append(${escapeJs(String(name))}, ${escapeJs(
        String(value),
      )});`,
  );

  return [
    "// Requires a modern browser with FormData, File, and Headers.",
    "// Requires jQuery 3.7.1+.",
    "// Install: npm install jquery@^3.7.1",
    "// Browser and jQuery header handling may combine repeated header values.",
    "// Multipart files must be supplied as File arguments; browser code cannot read local paths.",
    "",
    `function sendRequest(${parameters.join(", ")}) {`,
    ...setupLines,
    ...(setupLines.length > 0 ? [""] : []),
    "  const headers = new Headers();",
    ...headerSetupLines,
    "",
    "  return $.ajax({",
    `    url: ${escapeJs(compiled.url)},`,
    `    method: ${escapeJs(method)},`,
    "    headers: Object.fromEntries(headers.entries()),",
    "    timeout: 30_000,",
    ...(dataExpression ? [`    data: ${dataExpression},`] : []),
    ...(multipart
      ? ["    processData: false,", "    contentType: false,"]
      : dataExpression
        ? ["    processData: false,"]
        : []),
    '    dataType: "text",',
    "  })",
    "    .then(function (responseText, _textStatus, jqXHR) {",
    "      if (jqXHR.status < 200 || jqXHR.status >= 300) {",
    "        throw new Error(",
    "          `HTTP ${jqXHR.status} ${jqXHR.statusText}: ${responseText}`,",
    "        );",
    "      }",
    "",
    "      console.log(responseText);",
    "      return responseText;",
    "    })",
    "    .catch(function (jqXHR) {",
    '      if (jqXHR && typeof jqXHR.status === "number") {',
    "        const responseText =",
    '          typeof jqXHR.responseText === "string"',
    "            ? jqXHR.responseText",
    '            : "";',
    "        const statusText =",
    '          typeof jqXHR.statusText === "string"',
    "            ? jqXHR.statusText",
    '            : "";',
    "",
    "        throw new Error(",
    "          `HTTP ${jqXHR.status} ${statusText}: ${responseText}`,",
    "        );",
    "      }",
    "",
    "      throw jqXHR;",
    "    });",
    "}",
  ].join("\n");
}
