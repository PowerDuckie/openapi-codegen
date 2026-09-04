import {
  bodyText,
  compile,
  form,
  hasFormBody,
  isContentLengthHeader,
  isTransferEncodingHeader,
  normalizeMethod,
  supportsRequestBody,
} from "../common";
import type { RequestIR } from "../../types";

function sanitizeHeaderPart(value: unknown): string {
  return String(value)
    .replace(/[\r\n\u2028\u2029]+/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const generatedBody = Boolean(body) && supportsRequestBody(method);

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    return (
      !generatedBody ||
      (!isContentLengthHeader(name) && !isTransferEncodingHeader(name))
    );
  });

  const lines = [
    `${sanitizeHeaderPart(method)} ${sanitizeHeaderPart(compiled.url)} HTTP/1.1`,
    ...headers.map(
      ([name, value]) =>
        `${sanitizeHeaderPart(name)}: ${sanitizeHeaderPart(value)}`,
    ),
  ];

  if (generatedBody && body) {
    const payload = hasFormBody(request) ? form(body.value) : bodyText(request);

    lines.push("", payload);
  } else {
    lines.push("");
  }

  return lines.join("\r\n");
}
