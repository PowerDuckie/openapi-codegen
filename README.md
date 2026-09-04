# OpenAPI Request Code Generator

A browser-friendly TypeScript library that normalizes OpenAPI operations into a request IR and generates request code snippets.

## Goals

- Follow OpenAPI request serialization rules more strictly.
- Improve robustness around edge cases.
- Work in browsers without any Node.js dependency.
- Make escaping behavior consistent across multipart, urlencoded, headers, cookies, JSON payloads, and language string emitters.
- Reduce injection risks in generated code.

## What was improved

### Serialization and normalization
- Safer in-document `$ref` resolution with circular reference detection.
- Better parameter merging so operation-level parameters override path-level parameters by `in + name`.
- Better request body example extraction from `example`, `examples`, and schema-derived fallbacks.
- Better server selection fallback order.

### Consistency and escaping
- Header values are sanitized against CRLF injection.
- Cookie names and values are percent-encoded consistently.
- Query security injection is encoded consistently.
- JSON bodies are emitted with `JSON.stringify(...)` in generated JavaScript fetch code.
- Multipart generation removes manual `Content-Type` for browser `FormData` so the browser can set the boundary correctly.
- URL-encoded generation now appends repeated values consistently for arrays.
- Browser-safe multipart generation uses `Blob` instead of Node-only file APIs.

### Browser compatibility
- No Node-only runtime requirement.
- The browser `fetch` generator uses `FormData`, `Blob`, `URLSearchParams`, and `fetch`.

## Scope note

OpenAPI 3.2 evolves from the same serialization model used by OpenAPI 3.x. This library focuses on:
- parameter serialization
- request body example normalization
- security scheme materialization
- safer generated code output

It is not a full validator for the entire OpenAPI meta-schema. Instead, it is a practical request-generation library with stricter boundary handling.

## File overview

- `index.ts`: public exports and `generate(...)`
- `core/normalize.ts`: converts an OpenAPI operation into request IR
- `core/serialize.ts`: parameter and cookie serialization
- `core/request.ts`: compiled URL, headers, cookies, and security handling
- `core/example.ts`: example generation fallback
- `emitters/javascript/fetch.ts`: browser fetch emitter
- `demo.ts`: example usage

## Installation

Copy the files into your TypeScript project.

## Basic usage

```ts
import { generate } from "./index";

const code = generate({
  language: "javascript",
  client: "fetch",
  document: openapiDocument,
  path: "/pets/{petId}",
  method: "get",
  securityValues: {
    bearerAuth: "YOUR_TOKEN",
  },
});

console.log(code);
```

## Using a prebuilt IR

```ts
import { generate, normalize } from "./index";

const request = normalize({
  language: "javascript",
  client: "fetch",
  document: openapiDocument,
  path: "/pets/{petId}",
  method: "post",
});

const code = generate({
  language: "javascript",
  client: "fetch",
  request,
});
```

## Multipart behavior

For browser fetch output:
- The generator creates `FormData`.
- It removes `Content-Type` from headers before sending multipart data.
- The browser sets the proper multipart boundary automatically.
- File parts are represented with `Blob`.

Example generated pattern:

```ts
const formData = new FormData();
formData.append("file", new Blob([], { type: "application/octet-stream" }), "file.bin");
```

## URL-encoded behavior

For `application/x-www-form-urlencoded`:
- Scalar values are appended once.
- Array values are appended repeatedly.
- The body is created with `URLSearchParams`.

## Security handling

Supported normalization behavior includes:
- `apiKey` in query
- `apiKey` in header
- `apiKey` in cookie
- HTTP `bearer`
- HTTP `basic`

All injected values are normalized consistently before emission.

## Escaping model

- JavaScript string literals use `JSON.stringify`.
- Shell strings use single-quote escaping.
- PowerShell uses doubled single quotes.
- Header values strip CR and LF.
- Cookie values are percent-encoded.

## Demo

Run `demo.ts` in your TypeScript environment to inspect:
- normalized request IR
- generated browser `fetch` code

## Recommended next steps

If you want full OpenAPI 3.2 coverage beyond request generation, add:
- schema validation against the official OpenAPI schema
- more exact media type encoding object support
- explicit support for all parameter styles in all emitters
- test fixtures for pathological escaping inputs
