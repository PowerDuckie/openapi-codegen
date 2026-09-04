import {
  compile,
  bodyText,
  form,
  hasFormBody,
  hasMultipartBody,
  hasJsonBody,
  isFileValue,
  toKeyValueBody,
} from "../common";
import type { FileValue, RequestIR } from "../../types";

function rString(value: string): string {
  let out = '"';

  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;

    switch (char) {
      case "\\":
        out += "\\\\";
        break;
      case '"':
        out += '\\"';
        break;
      case "\n":
        out += "\\n";
        break;
      case "\r":
        out += "\\r";
        break;
      case "\t":
        out += "\\t";
        break;
      default:
        if (code < 0x20 || code === 0x7f || code > 0x7e) {
          out += `\\u{${code.toString(16)}}`;
        } else {
          out += char;
        }
    }
  }

  return `${out}"`;
}

function rName(name: string): string {
  const escaped = name
    .replace(/\\/g, "\\\\")
    .replace(/`/g, "\\`")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");

  const isBareName =
    /^[A-Za-z.][A-Za-z0-9._]*$/.test(name) && !/^\.[0-9]/.test(name);

  return isBareName ? name : `\`${escaped}\``;
}

function indent(text: string, spaces = 2): string {
  const pad = " ".repeat(spaces);

  return text
    .split("\n")
    .map((line) => (line ? `${pad}${line}` : line))
    .join("\n");
}

function contentTypeOf(request: RequestIR, fallback: string): string {
  const headers: unknown = request.headers;

  if (!headers) {
    return fallback;
  }

  const pairs: Array<[unknown, unknown]> = Array.isArray(headers)
    ? (headers as Array<[unknown, unknown]>)
    : Object.entries(headers as Record<string, unknown>);

  for (const [key, rawValue] of pairs) {
    if (String(key).toLowerCase() !== "content-type") {
      continue;
    }

    const firstValue = Array.isArray(rawValue) ? rawValue[0] : rawValue;

    if (firstValue === null || firstValue === undefined) {
      continue;
    }

    const value = String(firstValue).trim();

    if (value) {
      return value;
    }
  }

  return fallback;
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const body = request.body;
  const isMultipart = Boolean(body) && hasMultipartBody(request);
  const comments: string[] = [];

  const lines: string[] = [
    "library(httr2)",
    "",
    `req <- request(${rString(compiled.url)}) |>`,
    `  req_method(${rString(request.method.toUpperCase())})`,
  ];

  const headers = compiled.headers.filter(
    ([key]) => !(isMultipart && key.toLowerCase() === "content-type"),
  );

  if (headers.length > 0) {
    const args = headers.map(
      ([key, value]) => `${rName(String(key))} = ${rString(String(value))}`,
    );

    lines.push("", "req <- req |> req_headers(", indent(args.join(",\n")), ")");
  }

  if (body) {
    lines.push("");

    if (isMultipart) {
      const fields = toKeyValueBody(body.value).map((entry) => {
        const name = String(entry.name);

        if (entry.file && isFileValue(entry.value)) {
          const fileValue: FileValue = entry.value;
          const filePath = fileValue.path || "/tmp/file.bin";

          if (!fileValue.path) {
            comments.push(
              `# TODO: replace ${rString(filePath)} with the real local file path for ${rString(name)}`,
            );
          }

          return `${rName(name)} = upload_file(${rString(filePath)})`;
        }

        return `${rName(name)} = ${rString(String(entry.value ?? ""))}`;
      });

      if (fields.length > 0) {
        lines.push(
          "req <- req |> req_body_multipart(",
          indent(fields.join(",\n")),
          ")",
        );
      }
    } else if (hasJsonBody(request)) {
      const contentType = contentTypeOf(request, "application/json");

      lines.push(
        `json_body <- ${rString(bodyText(request))}`,
        "req <- req |> req_body_raw(",
        "  json_body,",
        `  type = ${rString(contentType)}`,
        ")",
      );
    } else {
      const isForm = hasFormBody(request);
      const payload = isForm ? form(body.value) : bodyText(request);

      const contentType = contentTypeOf(
        request,
        isForm
          ? "application/x-www-form-urlencoded"
          : "application/octet-stream",
      );

      lines.push(
        "req <- req |> req_body_raw(",
        `  ${rString(payload)},`,
        `  type = ${rString(contentType)}`,
        ")",
      );
    }
  }

  lines.push(
    "",
    "response <- req |> req_perform()",
    "resp_body_string(response)",
  );

  return comments.length > 0
    ? `${comments.join("\n")}\n${lines.join("\n")}`
    : lines.join("\n");
}
