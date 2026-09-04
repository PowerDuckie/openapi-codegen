import {
  DEFAULT_BINARY_MEDIA_TYPE,
  DEFAULT_FILE_NAME,
  DEFAULT_FILE_PATH,
  bodyText,
  compile,
  escapeObjC,
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

function safeObjCComment(value: string): string {
  return value
    .replace(/\*\//g, "* /")
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
    "Requires Apple Clang with Objective-C ARC and Foundation on macOS 12+.",
    "Compile: clang -fobjc-arc -framework Foundation main.m -o request",
    "NSURLRequest stores headers as a dictionary; duplicate names are combined with commas.",
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

  /*
   * NSMutableURLRequest cannot represent duplicate header names reliably.
   * Combine values case-insensitively, preserving their input order.
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
      `    NSString *boundary = [NSString stringWithFormat:@"Boundary-%@", NSUUID.UUID.UUIDString];`,
      `    NSMutableData *bodyData = [NSMutableData data];`,
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
          comments.push(safeObjCComment(fileComment(filePath, fieldName)));
        }

        bodyLines.push(
          `    AppendUTF8(bodyData, [NSString stringWithFormat:@"--%@\\r\\n", boundary]);`,
          `    AppendUTF8(bodyData, [NSString stringWithFormat:`,
          `      @"Content-Disposition: form-data; name=\\"%@\\"; filename=\\"%@\\"\\r\\n",`,
          `      QuoteMultipartValue(${escapeObjC(fieldName)}),`,
          `      QuoteMultipartValue(${escapeObjC(fileName)})]);`,
          `    AppendUTF8(bodyData, [NSString stringWithFormat:`,
          `      @"Content-Type: %@\\r\\n\\r\\n",`,
          `      SafeMediaType(${escapeObjC(contentType)})]);`,
          `    NSURL *fileURL${index} = [NSURL fileURLWithPath:${escapeObjC(filePath)}];`,
          `    NSError *fileError${index} = nil;`,
          `    NSData *fileData${index} = [NSData dataWithContentsOfURL:fileURL${index}`,
          `      options:NSDataReadingMappedIfSafe`,
          `      error:&fileError${index}];`,
          `    if (fileData${index} == nil) {`,
          `      fprintf(stderr, "Failed to read multipart file: %s\\n",`,
          `        fileError${index}.localizedDescription.UTF8String ?: "unknown error");`,
          `      return EXIT_FAILURE;`,
          `    }`,
          `    [bodyData appendData:fileData${index}];`,
          `    AppendUTF8(bodyData, @"\\r\\n");`,
        );
      } else {
        bodyLines.push(
          `    AppendUTF8(bodyData, [NSString stringWithFormat:@"--%@\\r\\n", boundary]);`,
          `    AppendUTF8(bodyData, [NSString stringWithFormat:`,
          `      @"Content-Disposition: form-data; name=\\"%@\\"\\r\\n\\r\\n",`,
          `      QuoteMultipartValue(${escapeObjC(fieldName)})]);`,
          `    AppendUTF8(bodyData, ${escapeObjC(
            textFieldValue(entry.value),
          )});`,
          `    AppendUTF8(bodyData, @"\\r\\n");`,
        );
      }
    }

    bodyLines.push(
      `    AppendUTF8(bodyData, [NSString stringWithFormat:@"--%@--\\r\\n", boundary]);`,
      `    urlRequest.HTTPBody = bodyData;`,
      `    [urlRequest setValue:`,
      `      [NSString stringWithFormat:@"multipart/form-data; boundary=%@", boundary]`,
      `      forHTTPHeaderField:@"Content-Type"];`,
    );
  } else if (body && canHaveBody) {
    const payload = hasFormBody(request) ? form(body.value) : bodyText(request);

    bodyLines.push(
      `    NSData *requestBody = [${escapeObjC(payload)}`,
      `      dataUsingEncoding:NSUTF8StringEncoding];`,
      `    if (requestBody == nil) {`,
      `      fprintf(stderr, "Failed to encode request body as UTF-8\\n");`,
      `      return EXIT_FAILURE;`,
      `    }`,
      `    urlRequest.HTTPBody = requestBody;`,
    );
  }

  return [
    ...comments.map((comment) => `/* ${safeObjCComment(comment)} */`),
    ``,
    `@import Foundation;`,
    `#include <stdio.h>`,
    `#include <stdlib.h>`,
    ``,
    `static void AppendUTF8(NSMutableData *data, NSString *value) {`,
    `  NSData *encoded = [value dataUsingEncoding:NSUTF8StringEncoding];`,
    `  if (encoded != nil) {`,
    `    [data appendData:encoded];`,
    `  }`,
    `}`,
    ``,
    `static NSString *QuoteMultipartValue(NSString *value) {`,
    `  NSMutableString *result = [NSMutableString stringWithCapacity:value.length];`,
    ``,
    `  for (NSUInteger index = 0; index < value.length; index++) {`,
    `    unichar character = [value characterAtIndex:index];`,
    ``,
    `    switch (character) {`,
    `      case '\\r':`,
    `      case '\\n':`,
    `        [result appendString:@" "];`,
    `        break;`,
    `      case '"':`,
    `        [result appendString:@"\\\\\\""];`,
    `        break;`,
    `      case '\\\\':`,
    `        [result appendString:@"\\\\\\\\"];`,
    `        break;`,
    `      default:`,
    `        if (character < 0x20 || character == 0x7F) {`,
    `          [result appendString:@" "];`,
    `        } else {`,
    `          [result appendFormat:@"%C", character];`,
    `        }`,
    `        break;`,
    `    }`,
    `  }`,
    ``,
    `  return result;`,
    `}`,
    ``,
    `static NSString *SafeMediaType(NSString *value) {`,
    `  NSMutableString *result = [NSMutableString stringWithCapacity:value.length];`,
    ``,
    `  for (NSUInteger index = 0; index < value.length; index++) {`,
    `    unichar character = [value characterAtIndex:index];`,
    `    if (character >= 0x21 && character <= 0x7E) {`,
    `      [result appendFormat:@"%C", character];`,
    `    }`,
    `  }`,
    ``,
    `  NSString *trimmed = [result stringByTrimmingCharactersInSet:`,
    `    NSCharacterSet.whitespaceAndNewlineCharacterSet];`,
    `  return trimmed.length > 0 ? trimmed : @"application/octet-stream";`,
    `}`,
    ``,
    `int main(void) {`,
    `  @autoreleasepool {`,
    `    NSString *urlString = ${escapeObjC(compiled.url)};`,
    `    NSURL *url = [NSURL URLWithString:urlString];`,
    `    if (url == nil) {`,
    `      fprintf(stderr, "Invalid URL: %s\\n", urlString.UTF8String);`,
    `      return EXIT_FAILURE;`,
    `    }`,
    ``,
    `    NSMutableURLRequest *urlRequest =`,
    `      [NSMutableURLRequest requestWithURL:url];`,
    `    urlRequest.HTTPMethod = ${escapeObjC(method)};`,
    `    urlRequest.timeoutInterval = 30.0;`,
    ...combinedHeaders.map(
      ([name, values]) =>
        `    [urlRequest setValue:${escapeObjC(
          values.join(", "),
        )} forHTTPHeaderField:${escapeObjC(name)}];`,
    ),
    ...bodyLines,
    ``,
    `    NSURLSessionConfiguration *configuration =`,
    `      [NSURLSessionConfiguration ephemeralSessionConfiguration];`,
    `    configuration.timeoutIntervalForRequest = 30.0;`,
    `    configuration.timeoutIntervalForResource = 30.0;`,
    ``,
    `    NSURLSession *session =`,
    `      [NSURLSession sessionWithConfiguration:configuration];`,
    `    dispatch_semaphore_t semaphore = dispatch_semaphore_create(0);`,
    `    __block int exitCode = EXIT_FAILURE;`,
    ``,
    `    NSURLSessionDataTask *task = [session`,
    `      dataTaskWithRequest:urlRequest`,
    `      completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {`,
    `        @autoreleasepool {`,
    `          if (error != nil) {`,
    `            fprintf(stderr, "Request failed: %s\\n",`,
    `              error.localizedDescription.UTF8String ?: "unknown error");`,
    `            dispatch_semaphore_signal(semaphore);`,
    `            return;`,
    `          }`,
    ``,
    `          if (![response isKindOfClass:NSHTTPURLResponse.class]) {`,
    `            fprintf(stderr, "The server returned a non-HTTP response\\n");`,
    `            dispatch_semaphore_signal(semaphore);`,
    `            return;`,
    `          }`,
    ``,
    `          NSHTTPURLResponse *httpResponse = (NSHTTPURLResponse *)response;`,
    `          NSString *responseText = [[NSString alloc]`,
    `            initWithData:(data ?: [NSData data])`,
    `            encoding:NSUTF8StringEncoding];`,
    `          if (responseText == nil) {`,
    `            responseText = [[NSString alloc]`,
    `              initWithData:(data ?: [NSData data])`,
    `              encoding:NSISOLatin1StringEncoding] ?: @"";`,
    `          }`,
    ``,
    `          if (httpResponse.statusCode < 200 ||`,
    `              httpResponse.statusCode >= 300) {`,
    `            fprintf(stderr, "HTTP status %ld: %s\\n",`,
    `              (long)httpResponse.statusCode,`,
    `              responseText.UTF8String ?: "");`,
    `            dispatch_semaphore_signal(semaphore);`,
    `            return;`,
    `          }`,
    ``,
    `          printf("%s\\n", responseText.UTF8String ?: "");`,
    `          exitCode = EXIT_SUCCESS;`,
    `          dispatch_semaphore_signal(semaphore);`,
    `        }`,
    `      }];`,
    ``,
    `    [task resume];`,
    `    dispatch_time_t deadline = dispatch_time(`,
    `      DISPATCH_TIME_NOW,`,
    `      (int64_t)(30.0 * NSEC_PER_SEC)`,
    `    );`,
    `    if (dispatch_semaphore_wait(semaphore, deadline) != 0) {`,
    `      [task cancel];`,
    `      fprintf(stderr, "Request timed out after 30 seconds\\n");`,
    `      exitCode = EXIT_FAILURE;`,
    `    }`,
    ``,
    `    [session finishTasksAndInvalidate];`,
    `    return exitCode;`,
    `  }`,
    `}`,
  ].join("\n");
}
