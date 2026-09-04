import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeRuby,
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

function rubyHeaderLines(headers: Array<[string, string]>): string[] {
  return headers.map(
    ([name, value]) =>
      `  [${escapeRuby(String(name))}, ${escapeRuby(String(value))}],`,
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
  const multipartEntries: string[] = [];

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

  if (body && multipart) {
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

        multipartEntries.push(
          "  {",
          `    name: ${escapeRuby(fieldName)},`,
          `    path: ${escapeRuby(filePath)},`,
          `    filename: ${escapeRuby(fileName)},`,
          `    content_type: ${escapeRuby(contentType)},`,
          "  },",
        );
      } else {
        multipartEntries.push(
          "  {",
          `    name: ${escapeRuby(fieldName)},`,
          `    value: ${escapeRuby(formFieldValue(entry.value))},`,
          "  },",
        );
      }
    }
  }

  let bodyLines: string[] = [];

  if (body && canHaveBody) {
    if (multipart) {
      bodyLines = [
        "boundary = generate_boundary",
        "request.body = encode_multipart(",
        "  multipart_entries,",
        "  boundary,",
        ")",
        "request['Content-Type'] = (",
        '  "multipart/form-data; boundary=#{boundary}"',
        ")",
      ];
    } else if (hasFormBody(request)) {
      bodyLines = [`request.body = ${escapeRuby(form(body.value))}`];
    } else {
      bodyLines = [`request.body = ${escapeRuby(bodyText(request))}`];
    }
  }

  const multipartHelpers = multipart
    ? [
        "",
        "def generate_boundary",
        '  "----ruby-net-http-#{SecureRandom.hex(24)}"',
        "end",
        "",
        "def escape_disposition(value)",
        "  value",
        '    .gsub("\\\\", "\\\\\\\\")',
        "    .gsub('\"', '\\\\\"')",
        '    .gsub(/[\\r\\n]/, "")',
        "end",
        "",
        "def encode_multipart(entries, boundary)",
        '  body = +"".b',
        "",
        "  entries.each do |entry|",
        '    body << "--#{boundary}\\r\\n".b',
        "    disposition = (",
        "      'Content-Disposition: form-data; name=\"' +",
        "      escape_disposition(entry.fetch(:name)) +",
        "      '\"'",
        "    )",
        "",
        "    if entry.key?(:path)",
        "      disposition << (",
        "        '; filename=\"' +",
        "        escape_disposition(entry.fetch(:filename)) +",
        "        '\"'",
        "      )",
        "    end",
        "",
        '    body << "#{disposition}\\r\\n".b',
        "",
        "    if entry.key?(:content_type)",
        "      content_type = entry.fetch(:content_type)",
        '      body << "Content-Type: #{content_type}\\r\\n".b',
        "    end",
        "",
        '    body << "\\r\\n".b',
        "",
        "    if entry.key?(:path)",
        "      File.open(entry.fetch(:path), 'rb') do |file|",
        "        IO.copy_stream(file, StringIO.new(body))",
        "      end",
        "    else",
        "      body << entry.fetch(:value).encode(",
        "        Encoding::UTF_8,",
        "        invalid: :replace,",
        "        undef: :replace,",
        "      )",
        "    end",
        "",
        '    body << "\\r\\n".b',
        "  end",
        "",
        '  body << "--#{boundary}--\\r\\n".b',
        "  body",
        "end",
      ]
    : [];

  return [
    "# Requires Ruby 3.1 or later.",
    "# Uses only the Ruby standard library; no gem installation is required.",
    "# Repeated request-header values are preserved in their original order.",
    ...comments.map((comment) => `# ${comment}`),
    "",
    'require "net/http"',
    'require "uri"',
    ...(multipart ? ['require "securerandom"', 'require "stringio"'] : []),
    ...multipartHelpers,
    "",
    "def main",
    `  uri = URI.parse(${escapeRuby(compiled.url)})`,
    "",
    "  unless %w[http https].include?(uri.scheme)",
    "    raise ArgumentError, (",
    "      \"unsupported URL scheme: #{uri.scheme || 'missing'}\"",
    "    )",
    "  end",
    "",
    '  raise ArgumentError, "URL must include a host" unless uri.host',
    "",
    "  request = Net::HTTPGenericRequest.new(",
    `    ${escapeRuby(method)},`,
    `    ${canHaveBody ? "true" : "false"},`,
    "    true,",
    "    uri.request_uri.empty? ? '/' : uri.request_uri,",
    "  )",
    "",
    "  header_items = [",
    ...rubyHeaderLines(
      headers.map(
        ([name, value]) => [String(name), String(value)] as [string, string],
      ),
    ),
    "  ]",
    "",
    "  header_items.each do |name, value|",
    "    request.add_field(name, value)",
    "  end",
    ...(multipart
      ? [
          "",
          "  multipart_entries = [",
          ...multipartEntries.map((line) => `  ${line}`),
          "  ]",
        ]
      : []),
    ...(bodyLines.length ? ["", ...bodyLines.map((line) => `  ${line}`)] : []),
    "",
    "  http = Net::HTTP.new(uri.host, uri.port)",
    "  http.use_ssl = uri.scheme == 'https'",
    "  http.open_timeout = 30",
    "  http.read_timeout = 30",
    "  http.write_timeout = 30",
    "",
    "  response = http.start do |connection|",
    "    connection.request(request)",
    "  end",
    "",
    "  unless response.is_a?(Net::HTTPSuccess)",
    "    raise RuntimeError, (",
    '      "HTTP #{response.code} #{response.message}: #{response.body}"',
    "    )",
    "  end",
    "",
    "  puts response.body",
    "rescue URI::InvalidURIError,",
    "       SocketError,",
    "       SystemCallError,",
    "       IOError,",
    "       Timeout::Error,",
    "       Net::HTTPBadResponse,",
    "       Net::HTTPHeaderSyntaxError,",
    "       Net::ProtocolError => error",
    '  raise RuntimeError, "HTTP request failed: #{error.message}"',
    "end",
    "",
    "main if $PROGRAM_NAME == __FILE__",
  ].join("\n");
}
