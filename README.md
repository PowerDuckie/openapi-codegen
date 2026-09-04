# @powerduck/openapi-codegen

Generate runnable HTTP request examples from parsed OpenAPI documents for **21 language targets** and **41 language/client combinations**.

`@powerduck/openapi-codegen` is an ESM-first TypeScript library for API documentation systems, developer portals, API explorers, command-line tools, and build-time code generation.

## Features

- Supports parsed OpenAPI documents, including OpenAPI 3.2
- Generates readable HTTP request examples across 41 generators
- Resolves path, query, header, and cookie parameters
- Supports API key, HTTP bearer, and other security schemes
- Supports JSON, plain-text, URL-encoded form, and multipart bodies
- Generates multipart file-upload examples with placeholder paths
- Preserves request bodies that have already been serialized
- Adds timeouts, HTTP status checks, and resource cleanup where supported
- Exposes generator discovery through `list()`
- Includes TypeScript declarations
- Ships as an ECMAScript module

## Supported Languages and Clients

Use the exact `language` and `client` identifiers shown below when calling `generate()`. Identifiers are case-sensitive.

| Language          | `language`   | Supported `client` values                                         |
| ----------------- | ------------ | ----------------------------------------------------------------- |
| C                 | `c`          | `libcurl`                                                         |
| C#                | `csharp`     | `httpclient`, `restsharp`                                         |
| Clojure           | `clojure`    | `clj-http`                                                        |
| Dart              | `dart`       | `http`                                                            |
| F#                | `fsharp`     | `httpclient`                                                      |
| Go                | `go`         | `new-request`                                                     |
| HTTP request file | `http`       | `http1`                                                           |
| Java              | `java`       | `asynchttp`, `java-net-http`, `okhttp`, `unirest`                 |
| JavaScript        | `javascript` | `fetch`, `axios`, `ofetch`, `jquery`, `xhr`                       |
| Kotlin            | `kotlin`     | `okhttp`                                                          |
| Node.js           | `node`       | `fetch`, `axios`, `ofetch`, `undici`                              |
| Objective-C       | `objc`       | `nsurlsession`                                                    |
| OCaml             | `ocaml`      | `cohttp`                                                          |
| PHP               | `php`        | `curl`, `guzzle`, `laravel-http`                                  |
| PowerShell        | `powershell` | `invoke-webrequest`, `invoke-restmethod`                          |
| Python            | `python`     | `http-client`, `requests`, `aiohttp`, `httpx-sync`, `httpx-async` |
| R                 | `r`          | `httr2`                                                           |
| Ruby              | `ruby`       | `net-http`                                                        |
| Rust              | `rust`       | `reqwest`                                                         |
| Shell             | `shell`      | `curl`, `wget`, `httpie`                                          |
| Swift             | `swift`      | `nsurlsession`                                                    |

> Generator availability does not imply that every client can represent every OpenAPI operation. For example, GNU Wget cannot safely construct arbitrary `multipart/form-data` requests. Use `shell/curl` or `shell/httpie` for multipart uploads.

## Requirements

- Node.js 20 or later
- A parsed OpenAPI document
- The runtime and dependencies required by the selected generated client

## Installation

Using npm:

```bash
npm install @powerduck/openapi-codegen
```

Using pnpm:

```bash
pnpm add @powerduck/openapi-codegen
```

Using Yarn:

```bash
yarn add @powerduck/openapi-codegen
```

## Quick Start

```ts
import { generate } from "@powerduck/openapi-codegen";
import document from "./openapi.json" with { type: "json" };

const code = generate({
  document,
  path: "/users/{id}",
  method: "get",
  language: "javascript",
  client: "fetch",
});

console.log(code);
```

`generate()` returns the generated source code as a string.

## Authentication

Provide credentials through `securityValues`:

```ts
import { generate } from "@powerduck/openapi-codegen";
import document from "./openapi.json" with { type: "json" };

const code = generate({
  document,
  path: "/users/{id}",
  method: "get",
  language: "javascript",
  client: "fetch",
  securityValues: {
    bearer: "YOUR_ACCESS_TOKEN",
    apiKey: "YOUR_API_KEY",
  },
});

console.log(code);
```

The keys in `securityValues` must match the security scheme names defined in the OpenAPI document.

Do not commit real credentials to source control.

## Multipart Uploads

```ts
import { generate } from "@powerduck/openapi-codegen";
import document from "./openapi.json" with { type: "json" };

const code = generate({
  document,
  path: "/upload/{id}",
  method: "post",
  language: "shell",
  client: "curl",
  securityValues: {
    bearer: "YOUR_ACCESS_TOKEN",
  },
});

console.log(code);
```

Generated multipart examples may include placeholder file paths:

```text
/tmp/file.bin
```

Replace all placeholder paths before running the generated code.

Some clients cannot safely represent every OpenAPI request. Generation may throw a descriptive error when the selected client is incompatible with an operation.

For example, `shell/wget` does not support arbitrary multipart generation. Use `shell/curl` or `shell/httpie` instead.

## Discover Available Generators

Use `list()` to inspect every installed language/client combination:

```ts
import { list } from "@powerduck/openapi-codegen";

for (const { language, client } of list()) {
  console.log(`${language}/${client}`);
}
```

You can also select a generator programmatically:

```ts
import { generate, list } from "@powerduck/openapi-codegen";
import document from "./openapi.json" with { type: "json" };

const generator = list().find(
  ({ language, client }) => language === "javascript" && client === "fetch",
);

if (!generator) {
  throw new Error("The requested generator is not available");
}

const code = generate({
  document,
  path: "/users",
  method: "get",
  language: generator.language,
  client: generator.client,
});

console.log(code);
```

## API Reference

### `generate(options)`

Generates an HTTP request example for an OpenAPI operation.

```ts
const code = generate({
  document,
  path,
  method,
  language,
  client,
  securityValues,
});
```

#### Options

| Option           | Type                     | Required | Description                            |
| ---------------- | ------------------------ | -------: | -------------------------------------- |
| `document`       | `unknown`                |      Yes | Parsed OpenAPI document                |
| `path`           | `string`                 |      Yes | Exact OpenAPI path template            |
| `method`         | `string`                 |      Yes | HTTP operation method                  |
| `language`       | `string`                 |      Yes | Target language identifier             |
| `client`         | `string`                 |      Yes | Target HTTP client identifier          |
| `securityValues` | `Record<string, string>` |       No | Credentials for named security schemes |

#### Return Value

Returns the generated source code as a `string`.

#### Errors

Generation can throw when:

- The requested path or operation does not exist
- The language/client combination is unknown
- The OpenAPI document is invalid or unsupported
- Required generation data cannot be resolved
- The selected client cannot safely represent the request

Handle errors when processing untrusted documents or user-selected generators:

```ts
try {
  const code = generate({
    document,
    path: "/users/{id}",
    method: "get",
    language: "javascript",
    client: "fetch",
  });

  console.log(code);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`Generation failed: ${message}`);
  process.exitCode = 1;
}
```

### `list()`

Returns the available generator descriptors:

```ts
const generators = list();
```

Each descriptor contains the identifiers required by `generate()`:

```ts
for (const { language, client } of generators) {
  console.log(language, client);
}
```

## OpenAPI Document Input

Pass a parsed JavaScript object rather than a JSON or YAML source string.

### JSON

```ts
import { readFile } from "node:fs/promises";
import { generate } from "@powerduck/openapi-codegen";

const source = await readFile("./openapi.json", "utf8");
const document = JSON.parse(source);

const code = generate({
  document,
  path: "/pets/{petId}",
  method: "get",
  language: "javascript",
  client: "fetch",
});

console.log(code);
```

### YAML

Install a YAML parser separately:

```bash
npm install yaml
```

Parse the document before passing it to `generate()`:

```ts
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { generate } from "@powerduck/openapi-codegen";

const source = await readFile("./openapi.yaml", "utf8");
const document = YAML.parse(source);

const code = generate({
  document,
  path: "/pets/{petId}",
  method: "get",
  language: "javascript",
  client: "fetch",
});

console.log(code);
```

## Generated Code

Generated examples are intended to be readable, runnable starting points. Depending on the selected language and client, they may include:

- A 30-second connection or request timeout
- HTTP status validation
- Response body output
- Resource cleanup
- Runtime and dependency notes
- Placeholder multipart file paths
- Environment-specific proxy or TLS behavior

Review generated code before using it in production. You may need to:

- Install dependencies for the selected client
- Replace placeholder parameter values
- Replace multipart file paths
- Supply authentication credentials securely
- Configure certificate trust
- Configure proxies
- Adjust timeout and redirect policies
- Add application-specific response parsing

## Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/PowerDuckie/-powerduck-openapi-codegen.git
cd ./-powerduck-openapi-codegen
npm install
```

Run the test suite:

```bash
npm test
```

Run property-based fuzz tests:

```bash
npm run fuzz
```

Build the package:

```bash
npm run build
```

Run all release checks:

```bash
npm run check
```

Run the demo:

```bash
npm run demo
```

## Testing

The project uses:

- [Vitest](https://vitest.dev/) for unit and snapshot tests
- [fast-check](https://fast-check.dev/) for property-based fuzz testing

Run all tests:

```bash
npm test
```

Update snapshots after intentionally changing generated output:

```bash
npx vitest run -u
```

Run only the fuzz test suite:

```bash
npm run fuzz
```

Before committing snapshot changes, inspect the diff:

```bash
git diff
```

## Releasing

Before releasing, verify that:

- The working tree is clean
- You are on the intended branch
- The full validation suite passes
- You are authenticated with npm
- The package is owned by your npm account or organization
- The Git remote points to the intended repository

Check the repository state:

```bash
git status
git remote -v
```

Sign in to npm:

```bash
npm login
```

Inspect the package contents without publishing:

```bash
npm pack --dry-run
```

### Patch Release

Use a patch release for backward-compatible bug fixes:

```bash
npm run release:patch
```

Example:

```text
0.4.0 → 0.4.1
```

### Minor Release

Use a minor release for backward-compatible features:

```bash
npm run release:minor
```

Example:

```text
0.4.0 → 0.5.0
```

### Major Release

Use a major release for breaking changes:

```bash
npm run release:major
```

Example:

```text
0.4.0 → 1.0.0
```

The release scripts run the configured checks, update the package version, create a Git commit and tag, and push the commit and tags.

Publish the public scoped package:

```bash
npm publish --access public
```

## Initial GitHub Setup

Initialize the repository and push it to GitHub:

```bash
git init
git branch -M main
git remote add origin https://github.com/PowerDuckie/-powerduck-openapi-codegen.git
git add .
git commit -m "feat: initialize OpenAPI code generator"
git push -u origin main
```

If `origin` already exists, update it:

```bash
git remote set-url origin https://github.com/PowerDuckie/-powerduck-openapi-codegen.git
git push -u origin main
```

## Project Structure

A typical project layout is:

```text
.
├── demo/
├── src/
│   ├── core/
│   ├── emitters/
│   ├── generators/
│   ├── common.ts
│   ├── index.ts
│   └── types.ts
├── tests/
│   ├── fixtures/
│   ├── fuzz.test.ts
│   └── snapshot.test.ts
├── package.json
├── README.md
└── tsconfig.json
```

## Security

Generated source code can contain request URLs, headers, parameter values, and credentials supplied to the generator.

Avoid:

- Committing generated examples that contain real credentials
- Logging secrets in CI output
- Running unreviewed generated commands in production
- Passing untrusted file paths directly to generated upload code

Report security issues privately to the repository owner instead of opening a public issue.

## Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Add or update tests.
4. Run the full validation suite.
5. Commit the changes.
6. Open a pull request.

```bash
git checkout -b feature/my-change
npm install
npm run check
git add .
git commit -m "feat: describe the change"
git push -u origin feature/my-change
```

When changing generated output, update and review the affected snapshots:

```bash
npx vitest run -u
git diff
```

## License

[MIT](LICENSE)
