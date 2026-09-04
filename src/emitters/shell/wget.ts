import {
  bodyText,
  compile,
  escapeSh,
  form,
  hasFormBody,
  hasMultipartBody,
  isContentLengthHeader,
  isTransferEncodingHeader,
  normalizeMethod,
  supportsRequestBody,
} from "../common";
import type { RequestIR } from "../../types";

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const generatedBody = Boolean(body && canHaveBody);

  if (generatedBody && hasMultipartBody(request)) {
    throw new Error(
      "GNU Wget cannot safely construct multipart/form-data requests; use curl or HTTPie instead",
    );
  }

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      generatedBody &&
      (isContentLengthHeader(name) || isTransferEncodingHeader(name))
    ) {
      return false;
    }

    return true;
  });

  const parts: string[] = [
    "wget",
    `  --method=${escapeSh(method)}`,
    "  --timeout=30",
    "  --tries=1",
    "  --server-response",
    "  --content-on-error",
    "  --output-document=-",
  ];

  for (const [rawName, rawValue] of headers) {
    /*
     * Each header is emitted separately, so repeated headers are preserved.
     * Quoting the entire value prevents shell metacharacter injection.
     */
    parts.push(
      `  --header=${escapeSh(`${String(rawName)}: ${String(rawValue)}`)}`,
    );
  }

  if (body && canHaveBody) {
    const payload = hasFormBody(request) ? form(body.value) : bodyText(request);

    /*
     * --body-data sends the generated value directly. Shell quoting protects
     * whitespace and metacharacters, but command-line arguments cannot
     * represent embedded NUL bytes.
     */
    parts.push(`  --body-data=${escapeSh(payload)}`);
  }

  parts.push(`  ${escapeSh(compiled.url)}`);

  const comments = [
    "# Requires GNU Wget 1.20+.",
    "# Install (Debian/Ubuntu): sudo apt-get install wget",
    "# --timeout=30 applies separately to DNS, connection, and read operations;",
    "# GNU Wget does not provide a strict 30-second total-transfer timeout.",
    "# --tries=1 disables retries after the initial request.",
    "# Response bodies, including HTTP error bodies, are written to standard output.",
    "# GNU Wget reports HTTP failures through its process exit status.",
    "# Repeated request headers are emitted as separate --header options.",
  ];

  return `${comments.join("\n")}\n${parts.join(" \\\n")}`;
}
