import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeOCaml,
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

function safeOCamlComment(value: string): string {
  return value
    .replace(/\(\*/g, "( *")
    .replace(/\*\)/g, "* )")
    .replace(/[\r\n\u0000-\u001f\u007f\u2028\u2029]+/g, " ")
    .trim();
}

function textFieldValue(value: unknown): string {
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
    "Requires OCaml 5.1+, cohttp-lwt-unix 6.x, lwt 5.x, and uri 4.x.",
    "Install: opam install cohttp-lwt-unix lwt uri",
    "Compile: ocamlfind ocamlopt -thread -linkpkg -package cohttp-lwt-unix,lwt.unix,uri main.ml -o request",
    "Cohttp Header.add preserves repeated header fields.",
  ];

  const headers = compiled.headers.filter(([rawName]) => {
    const name = String(rawName);

    if (
      generatedBody &&
      (isContentLengthHeader(name) || isTransferEncodingHeader(name))
    ) {
      return false;
    }

    if (multipart && isContentTypeHeader(name)) {
      return false;
    }

    return true;
  });

  const bodyLines: string[] = [];

  if (body && canHaveBody && multipart) {
    const items = toKeyValueBody(body.value);

    bodyLines.push(
      `  let boundary =`,
      `    "Boundary-" ^ Uuidm.to_string (Uuidm.v \`V4)`,
      `  in`,
      `  let buffer = Buffer.create 4096 in`,
    );

    for (const [index, entry] of items.entries()) {
      const fieldName = String(entry.name);

      if (entry.file && isFileValue(entry.value)) {
        const fileValue: FileValue = entry.value;
        const actualPath = nonBlankString(fileValue.path);
        const filePath = actualPath ?? DEFAULT_FILE_PATH;
        const fileName = nonBlankString(fileValue.name) ?? DEFAULT_FILE_NAME;
        const contentType =
          nonBlankString(fileValue.contentType) ?? DEFAULT_BINARY_MEDIA_TYPE;

        if (actualPath === undefined) {
          comments.push(safeOCamlComment(fileComment(filePath, fieldName)));
        }

        bodyLines.push(
          `  Buffer.add_string buffer ("--" ^ boundary ^ "\\r\\n");`,
          `  Buffer.add_string buffer`,
          `    ("Content-Disposition: form-data; name=\\"" ^`,
          `     quote_multipart_value ${escapeOCaml(fieldName)} ^`,
          `     "\\"; filename=\\"" ^`,
          `     quote_multipart_value ${escapeOCaml(fileName)} ^`,
          `     "\\"\\r\\n");`,
          `  Buffer.add_string buffer`,
          `    ("Content-Type: " ^`,
          `     safe_media_type ${escapeOCaml(contentType)} ^`,
          `     "\\r\\n\\r\\n");`,
          `  let file_content_${index} =`,
          `    read_file ${escapeOCaml(filePath)}`,
          `  in`,
          `  Buffer.add_string buffer file_content_${index};`,
          `  Buffer.add_string buffer "\\r\\n";`,
        );
      } else {
        bodyLines.push(
          `  Buffer.add_string buffer ("--" ^ boundary ^ "\\r\\n");`,
          `  Buffer.add_string buffer`,
          `    ("Content-Disposition: form-data; name=\\"" ^`,
          `     quote_multipart_value ${escapeOCaml(fieldName)} ^`,
          `     "\\"\\r\\n\\r\\n");`,
          `  Buffer.add_string buffer ${escapeOCaml(
            textFieldValue(entry.value),
          )};`,
          `  Buffer.add_string buffer "\\r\\n";`,
        );
      }
    }

    bodyLines.push(
      `  Buffer.add_string buffer ("--" ^ boundary ^ "--\\r\\n");`,
      `  let request_body = Cohttp_lwt.Body.of_string (Buffer.contents buffer) in`,
      `  let headers =`,
      `    Header.add headers "Content-Type"`,
      `      ("multipart/form-data; boundary=" ^ boundary)`,
      `  in`,
    );
  } else if (body && canHaveBody) {
    const payload = hasFormBody(request) ? form(body.value) : bodyText(request);

    bodyLines.push(
      `  let request_body =`,
      `    Cohttp_lwt.Body.of_string ${escapeOCaml(payload)}`,
      `  in`,
    );
  } else {
    bodyLines.push(`  let request_body = Cohttp_lwt.Body.empty in`);
  }

  return [
    ...comments.map((comment) => `(* ${safeOCamlComment(comment)} *)`),
    ``,
    `open Lwt.Infix`,
    ``,
    `exception Http_error of int * string`,
    ``,
    `let read_file path =`,
    `  let channel = open_in_bin path in`,
    `  Fun.protect`,
    `    ~finally:(fun () -> close_in_noerr channel)`,
    `    (fun () ->`,
    `      let length = in_channel_length channel in`,
    `      really_input_string channel length)`,
    ``,
    `let quote_multipart_value value =`,
    `  let buffer = Buffer.create (String.length value) in`,
    `  String.iter`,
    `    (function`,
    `      | '\\r' | '\\n' -> Buffer.add_char buffer ' '`,
    `      | '"' -> Buffer.add_string buffer "\\\\\\""`,
    `      | '\\\\' -> Buffer.add_string buffer "\\\\\\\\"`,
    `      | character ->`,
    `          if Char.code character < 32 || Char.code character = 127 then`,
    `            Buffer.add_char buffer ' '`,
    `          else`,
    `            Buffer.add_char buffer character)`,
    `    value;`,
    `  Buffer.contents buffer`,
    ``,
    `let safe_media_type value =`,
    `  let buffer = Buffer.create (String.length value) in`,
    `  String.iter`,
    `    (fun character ->`,
    `      let code = Char.code character in`,
    `      if code >= 33 && code <= 126 then`,
    `        Buffer.add_char buffer character)`,
    `    value;`,
    `  let result = String.trim (Buffer.contents buffer) in`,
    `  if result = "" then "application/octet-stream" else result`,
    ``,
    `let method_of_string value =`,
    `  match String.uppercase_ascii value with`,
    `  | "GET" -> \`GET`,
    `  | "HEAD" -> \`HEAD`,
    `  | "POST" -> \`POST`,
    `  | "PUT" -> \`PUT`,
    `  | "DELETE" -> \`DELETE`,
    `  | "PATCH" -> \`PATCH`,
    `  | "OPTIONS" -> \`OPTIONS`,
    `  | "CONNECT" -> \`CONNECT`,
    `  | "TRACE" -> \`TRACE`,
    `  | other -> \`Other other`,
    ``,
    `let add_headers headers values =`,
    `  List.fold_left`,
    `    (fun result (name, value) ->`,
    `      Cohttp.Header.add result name value)`,
    `    headers`,
    `    values`,
    ``,
    `let run () =`,
    `  let uri = Uri.of_string ${escapeOCaml(compiled.url)} in`,
    `  let http_method = method_of_string ${escapeOCaml(method)} in`,
    `  let headers =`,
    `    add_headers (Cohttp.Header.init ())`,
    `      [`,
    ...headers.map(
      ([rawName, rawValue]) =>
        `        (${escapeOCaml(String(rawName))}, ${escapeOCaml(
          String(rawValue),
        )});`,
    ),
    `      ]`,
    `  in`,
    ...bodyLines,
    `  let request =`,
    `    Cohttp_lwt_unix.Client.call`,
    `      ~headers`,
    `      ~body:request_body`,
    `      http_method`,
    `      uri`,
    `  in`,
    `  Lwt_unix.with_timeout 30.0 (fun () -> request)`,
    `  >>= fun (response, response_body) ->`,
    `  Cohttp_lwt.Body.to_string response_body`,
    `  >>= fun response_text ->`,
    `  let status =`,
    `    Cohttp.Response.status response`,
    `  in`,
    `  let status_code = Cohttp.Code.code_of_status status in`,
    `  if status_code < 200 || status_code > 299 then`,
    `    Lwt.fail (Http_error (status_code, response_text))`,
    `  else`,
    `    Lwt_io.print response_text`,
    ``,
    `let report_error error =`,
    `  let message =`,
    `    match error with`,
    `    | Http_error (status, response_body) ->`,
    `        Printf.sprintf`,
    `          "HTTP status %d: %s"`,
    `          status`,
    `          response_body`,
    `    | Lwt_unix.Timeout ->`,
    `        "Request timed out after 30 seconds"`,
    `    | other -> Printexc.to_string other`,
    `  in`,
    `  Lwt_io.eprintlf "Request failed: %s" message`,
    ``,
    `let () =`,
    `  match Lwt_main.run (Lwt.catch run report_error) with`,
    `  | () -> ()`,
    `  | exception error ->`,
    `      prerr_endline ("Request failed: " ^ Printexc.to_string error);`,
    `      exit 1`,
  ].join("\n");
}
