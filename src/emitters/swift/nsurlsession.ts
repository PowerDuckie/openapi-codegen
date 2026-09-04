import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeSwift,
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

function safeSwiftComment(value: string): string {
  return value.replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, " ").trim();
}

function swiftTextValue(value: unknown): string {
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
    "// Requires Swift 5.7+ on macOS 12+ or Linux with FoundationNetworking.",
    "// Compile on macOS: swiftc main.swift -o request",
    "// Compile on Linux: swiftc main.swift -o request",
    "// URLSession cannot preserve duplicate request headers reliably;",
    "// duplicate names are safely combined with commas.",
  ];

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      generatedBody &&
      (isContentLengthHeader(name) || isTransferEncodingHeader(name))
    ) {
      return false;
    }

    // URLSession must generate the multipart boundary used by this emitter.
    if (multipart && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  /*
   * URLRequest stores headers as a dictionary, so preserve all values by
   * combining duplicate names case-insensitively in insertion order.
   */
  const combinedHeaders: Array<[string, string[]]> = [];
  const headerIndexes = new Map<string, number>();

  for (const [rawName, rawValue] of headers) {
    const name = String(rawName);
    const value = String(rawValue);
    const normalizedName = name.toLowerCase();
    const existingIndex = headerIndexes.get(normalizedName);

    if (existingIndex === undefined) {
      headerIndexes.set(normalizedName, combinedHeaders.length);
      combinedHeaders.push([name, [value]]);
    } else {
      combinedHeaders[existingIndex][1].push(value);
    }
  }

  const bodyLines: string[] = [];

  if (body && canHaveBody && multipart) {
    bodyLines.push(
      `var bodyData = Data()`,
      ``,
      `func appendUtf8(_ value: String, to data: inout Data) throws {`,
      `    guard let encoded = value.data(using: .utf8) else {`,
      `        throw RequestError.utf8Encoding`,
      `    }`,
      `    data.append(encoded)`,
      `}`,
      ``,
    );

    for (const [index, entry] of toKeyValueBody(body.value).entries()) {
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
            `// ${safeSwiftComment(fileComment(filePath, fieldName))}`,
          );
        }

        bodyLines.push(
          `try appendUtf8("--\\(boundary)\\r\\n", to: &bodyData)`,
          `try appendUtf8("Content-Disposition: form-data; name=\\"\\(quotedMultipartValue(${escapeSwift(
            fieldName,
          )}))\\"; filename=\\"\\(quotedMultipartValue(${escapeSwift(
            fileName,
          )}))\\"\\r\\n", to: &bodyData)`,
          `try appendUtf8("Content-Type: \\(safeMediaType(${escapeSwift(
            contentType,
          )}))\\r\\n\\r\\n", to: &bodyData)`,
          `let fileURL${index} = URL(fileURLWithPath: ${escapeSwift(
            filePath,
          )})`,
          `bodyData.append(try Data(contentsOf: fileURL${index}, options: [.mappedIfSafe]))`,
          `try appendUtf8("\\r\\n", to: &bodyData)`,
          ``,
        );
      } else {
        bodyLines.push(
          `try appendUtf8("--\\(boundary)\\r\\n", to: &bodyData)`,
          `try appendUtf8("Content-Disposition: form-data; name=\\"\\(quotedMultipartValue(${escapeSwift(
            fieldName,
          )}))\\"\\r\\n\\r\\n", to: &bodyData)`,
          `try appendUtf8(${escapeSwift(
            swiftTextValue(entry.value),
          )}, to: &bodyData)`,
          `try appendUtf8("\\r\\n", to: &bodyData)`,
          ``,
        );
      }
    }

    bodyLines.push(
      `try appendUtf8("--\\(boundary)--\\r\\n", to: &bodyData)`,
      `urlRequest.httpBody = bodyData`,
      `urlRequest.setValue(`,
      `    "multipart/form-data; boundary=\\(boundary)",`,
      `    forHTTPHeaderField: "Content-Type"`,
      `)`,
    );
  } else if (body && canHaveBody) {
    const payload = hasFormBody(request) ? form(body.value) : bodyText(request);

    bodyLines.push(
      `guard let requestBody = ${escapeSwift(
        payload,
      )}.data(using: .utf8) else {`,
      `    throw RequestError.utf8Encoding`,
      `}`,
      `urlRequest.httpBody = requestBody`,
    );
  }

  const multipartHelpers = multipart
    ? [
        ``,
        `func quotedMultipartValue(_ value: String) -> String {`,
        `    value`,
        `        .replacingOccurrences(of: "\\r", with: " ")`,
        `        .replacingOccurrences(of: "\\n", with: " ")`,
        `        .replacingOccurrences(of: "\\\\", with: "\\\\\\\\")`,
        `        .replacingOccurrences(of: "\\"", with: "\\\\\\"")`,
        `}`,
        ``,
        `func safeMediaType(_ value: String) -> String {`,
        `    let sanitized = value`,
        `        .replacingOccurrences(of: "\\r", with: "")`,
        `        .replacingOccurrences(of: "\\n", with: "")`,
        `        .trimmingCharacters(in: .whitespacesAndNewlines)`,
        `    return sanitized.isEmpty`,
        `        ? "application/octet-stream"`,
        `        : sanitized`,
        `}`,
      ]
    : [];

  return [
    ...comments,
    ``,
    `import Foundation`,
    `#if canImport(FoundationNetworking)`,
    `import FoundationNetworking`,
    `#endif`,
    ``,
    `enum RequestError: Error, CustomStringConvertible {`,
    `    case invalidURL(String)`,
    `    case utf8Encoding`,
    `    case invalidResponse`,
    `    case httpStatus(Int, String)`,
    ``,
    `    var description: String {`,
    `        switch self {`,
    `        case .invalidURL(let value):`,
    `            return "Invalid URL: \\(value)"`,
    `        case .utf8Encoding:`,
    `            return "Failed to encode request data as UTF-8"`,
    `        case .invalidResponse:`,
    `            return "The server returned a non-HTTP response"`,
    `        case .httpStatus(let status, let body):`,
    `            return "HTTP status \\(status): \\(body)"`,
    `        }`,
    `    }`,
    `}`,
    ...multipartHelpers,
    ``,
    `@main`,
    `struct Main {`,
    `    static func main() async {`,
    `        do {`,
    `            try await run()`,
    `        } catch {`,
    `            FileHandle.standardError.write(`,
    `                Data("Request failed: \\(error)\\n".utf8)`,
    `            )`,
    `            Foundation.exit(EXIT_FAILURE)`,
    `        }`,
    `    }`,
    ``,
    `    static func run() async throws {`,
    `        let urlString = ${escapeSwift(compiled.url)}`,
    `        guard let url = URL(string: urlString) else {`,
    `            throw RequestError.invalidURL(urlString)`,
    `        }`,
    ``,
    `        var urlRequest = URLRequest(url: url)`,
    `        urlRequest.httpMethod = ${escapeSwift(method)}`,
    `        urlRequest.timeoutInterval = 30`,
    ...combinedHeaders.map(
      ([name, values]) =>
        `        urlRequest.setValue(${escapeSwift(
          values.join(", "),
        )}, forHTTPHeaderField: ${escapeSwift(name)})`,
    ),
    ...(multipart
      ? [
          `        let boundary = "Boundary-\\(UUID().uuidString)"`,
          ...bodyLines.map((line) => (line ? `        ${line}` : ``)),
        ]
      : bodyLines.map((line) => (line ? `        ${line}` : ``))),
    ``,
    `        let configuration = URLSessionConfiguration.ephemeral`,
    `        configuration.timeoutIntervalForRequest = 30`,
    `        configuration.timeoutIntervalForResource = 30`,
    `        let session = URLSession(configuration: configuration)`,
    `        defer {`,
    `            session.invalidateAndCancel()`,
    `        }`,
    ``,
    `        let (data, response) = try await session.data(for: urlRequest)`,
    `        guard let httpResponse = response as? HTTPURLResponse else {`,
    `            throw RequestError.invalidResponse`,
    `        }`,
    ``,
    `        let responseBody = String(decoding: data, as: UTF8.self)`,
    `        guard (200...299).contains(httpResponse.statusCode) else {`,
    `            throw RequestError.httpStatus(`,
    `                httpResponse.statusCode,`,
    `                responseBody`,
    `            )`,
    `        }`,
    ``,
    `        print(responseBody)`,
    `    }`,
    `}`,
  ].join("\n");
}
