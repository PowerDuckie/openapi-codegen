import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeRust,
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

function indentLines(lines: string[], prefix: string): string[] {
  return lines.map((line) => (line ? `${prefix}${line}` : line));
}

export function emit(request: RequestIR): string {
  const compiled = compile(request);
  const method = normalizeMethod(request.method);
  const body = request.body;
  const canHaveBody = supportsRequestBody(method);
  const generatedBody = Boolean(body && canHaveBody);
  const multipart = Boolean(body && canHaveBody && hasMultipartBody(request));

  const comments: string[] = [];
  const bodySetup: string[] = [];
  let bodyBuilder: string | undefined;

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
      bodySetup.push(
        "let mut multipart_form = reqwest::blocking::multipart::Form::new();",
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

          bodySetup.push(
            "{",
            `    let file = File::open(${escapeRust(filePath)})?;`,
            "    let part = reqwest::blocking::multipart::Part::reader(file)",
            `        .file_name(${escapeRust(fileName)})`,
            `        .mime_str(${escapeRust(contentType)})?;`,
            "    multipart_form = multipart_form.part(",
            `        ${escapeRust(fieldName)},`,
            "        part,",
            "    );",
            "}",
          );
        } else {
          bodySetup.push(
            "multipart_form = multipart_form.text(",
            `    ${escapeRust(fieldName)},`,
            `    ${escapeRust(formFieldValue(entry.value))}.to_owned(),`,
            ");",
          );
        }
      }

      bodyBuilder = ".multipart(multipart_form)";
    } else {
      const bodyValue = hasFormBody(request)
        ? form(body.value)
        : bodyText(request);

      bodySetup.push(`let request_body = ${escapeRust(bodyValue)}.to_owned();`);
      bodyBuilder = ".body(request_body)";
    }
  }

  const headerSetup: string[] = ["let mut headers = HeaderMap::new();"];

  for (const [rawName, rawValue] of headers) {
    const name = String(rawName);
    const value = String(rawValue);

    headerSetup.push(
      "{",
      `    let name = HeaderName::from_bytes(${escapeRust(name)}.as_bytes())?;`,
      `    let value = HeaderValue::from_str(${escapeRust(value)})?;`,
      "    headers.append(name, value);",
      "}",
    );
  }

  return [
    "// Requires Rust 1.74 or later.",
    "// Requires reqwest 0.12 or later.",
    "//",
    "// Cargo.toml:",
    '// reqwest = { version = "0.12", features = ["blocking", "multipart"] }',
    "//",
    "// Repeated request headers and multipart fields are preserved in order.",
    ...comments.map((comment) => `// ${comment}`),
    "",
    "use reqwest::blocking::Client;",
    "use reqwest::header::{HeaderMap, HeaderName, HeaderValue};",
    "use reqwest::Method;",
    ...(multipart ? ["use std::fs::File;"] : []),
    "use std::error::Error;",
    "use std::io;",
    "use std::time::Duration;",
    "",
    "",
    "fn main() -> Result<(), Box<dyn Error>> {",
    "    let client = Client::builder()",
    "        .connect_timeout(Duration::from_secs(30))",
    "        .timeout(Duration::from_secs(30))",
    "        .build()?;",
    "",
    ...indentLines(headerSetup, "    "),
    "",
    `    let method = Method::from_bytes(${escapeRust(method)}.as_bytes())?;`,
    ...(bodySetup.length > 0 ? ["", ...indentLines(bodySetup, "    ")] : []),
    "",
    "    let request = client",
    `        .request(method, ${escapeRust(compiled.url)})`,
    "        .headers(headers)",
    ...(bodyBuilder ? [`        ${bodyBuilder}`] : []),
    "        .build()?;",
    "",
    "    let response = client.execute(request)?;",
    "    let status = response.status();",
    "    let response_body = response.text()?;",
    "",
    "    if !status.is_success() {",
    "        return Err(io::Error::other(format!(",
    '            "HTTP {}: {}",',
    "            status,",
    "            response_body,",
    "        ))",
    "        .into());",
    "    }",
    "",
    '    println!("{}", response_body);',
    "    Ok(())",
    "}",
  ].join("\n");
}
