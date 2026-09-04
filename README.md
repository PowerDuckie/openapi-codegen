# @powerduck/openapi-codegen

Generate runnable HTTP client examples from OpenAPI documents across multiple languages and libraries.

## Features

- Supports OpenAPI documents, including OpenAPI 3.2
- Generates examples for multiple languages and HTTP clients
- Handles path, query, header, and cookie parameters
- Supports API key, bearer token, and other security schemes
- Supports JSON, form URL-encoded, text, and multipart request bodies
- Handles multipart file uploads
- Preserves already serialized request bodies
- Generates request timeouts and non-2xx error handling where supported
- Provides a simple generator discovery API
- Includes TypeScript declarations
- Ships as an ECMAScript module

## Requirements

- Node.js 20 or later
- An OpenAPI document
- The runtime and dependencies required by the generated client

## Installation

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

## Generate an Authenticated Request

Provide security credentials through `securityValues`:

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

The keys in `securityValues` should match the security scheme names defined by the OpenAPI document.

Do not commit real credentials to source control.

## Generate a Multipart Upload

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

Generated multipart examples may include placeholder file paths such as:

```text
/tmp/file.bin
```

Replace placeholder paths before running the generated code.

Some HTTP clients cannot safely represent every OpenAPI request. For example, GNU Wget cannot reliably construct multipart form-data requests. In those cases, generation may fail with a descriptive error. Use another supported client such as curl or HTTPie.

## Discover Available Generators

Use `list()` to inspect the installed language and client combinations:

```ts
import { list } from "@powerduck/openapi-codegen";

for (const generator of list()) {
  console.log(`${generator.language}/${generator.client}`);
}
```

You can also select a generator programmatically:

```ts
import { generate, list } from "@powerduck/openapi-codegen";
import document from "./openapi.json" with { type: "json" };

const generator = list().find(
  (item) => item.language === "javascript" && item.client === "fetch",
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

## API

### `generate(options)`

Generates an HTTP client example.

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

| Option           | Type                     | Required | Description                       |
| ---------------- | ------------------------ | -------- | --------------------------------- |
| `document`       | `unknown`                | Yes      | Parsed OpenAPI document           |
| `path`           | `string`                 | Yes      | Exact OpenAPI path template       |
| `method`         | `string`                 | Yes      | HTTP operation method             |
| `language`       | `string`                 | Yes      | Target language identifier        |
| `client`         | `string`                 | Yes      | Target HTTP client identifier     |
| `securityValues` | `Record<string, string>` | No       | Values for named security schemes |

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

Returns the available generator descriptors.

```ts
const generators = list();
```

Each descriptor includes the values required to select its language and client:

```ts
for (const { language, client } of generators) {
  console.log(language, client);
}
```

## OpenAPI Document Input

Pass a parsed JavaScript object rather than a JSON string:

```ts
import { readFile } from "node:fs/promises";
import { generate } from "@powerduck/openapi-codegen";

const document = JSON.parse(await readFile("./openapi.json", "utf8"));

const code = generate({
  document,
  path: "/pets/{petId}",
  method: "get",
  language: "javascript",
  client: "fetch",
});

console.log(code);
```

For YAML documents, parse the file with a YAML library before passing it to `generate()`:

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

Install the optional YAML parser separately:

```bash
npm install yaml
```

## Generated Code

Generated examples are intended to be readable starting points. Depending on the selected language and client, they may include:

- A 30-second connection or request timeout
- HTTP status validation
- Response-body output
- Resource cleanup
- Dependency and runtime notes
- Placeholder multipart file paths
- Environment-specific proxy or TLS behavior

Review generated code before using it in production. You may need to:

- Install the target client's dependencies
- Replace placeholder parameter values
- Replace multipart file paths
- Supply authentication credentials securely
- Configure certificate trust
- Configure proxies
- Adjust timeout and redirect policies
- Add application-specific response parsing

## Development

Clone the repository:

```bash
git clone https://github.com/PowerDuckie/-powerduck-openapi-codegen.git
cd ./-powerduck-openapi-codegen
npm install
```

Run the test suite:

```bash
npm test
```

Run fuzz tests:

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

Update snapshots after intentionally changing generator output:

```bash
npx vitest run -u
```

Run only the fuzz test suite:

```bash
npm run fuzz
```

## Releasing

Before releasing, make sure:

- The working tree is clean
- You are on the intended branch
- You are authenticated with npm
- The package name is available or owned by your npm organization
- The Git remote points to the correct repository

Check the repository:

```bash
git status
git remote -v
```

Sign in to npm:

```bash
npm login
```

### Patch Release

For backward-compatible bug fixes:

```bash
npm run release:patch
```

Example:

```text
0.4.0 → 0.4.1
```

### Minor Release

For backward-compatible features:

```bash
npm run release:minor
```

Example:

```text
0.4.0 → 0.5.0
```

### Major Release

For breaking changes:

```bash
npm run release:major
```

Example:

```text
0.4.0 → 1.0.0
```

The release scripts run the configured checks, update the package version, create a Git commit and tag, and push the commit and tags.

Publish the package:

```bash
npm publish --access public
```

To inspect the package contents before publishing:

```bash
npm pack --dry-run
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

## Package Structure

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

Generated source code can contain request URLs, headers, parameter values, and security credentials supplied to the generator.

Avoid:

- Committing generated examples containing real credentials
- Logging secrets in CI output
- Using unreviewed generated commands in production
- Passing untrusted file paths directly to generated upload code

Report security issues privately to the repository owner instead of opening a public issue.

## Contributing

Contributions are welcome.

1. Fork the repository.
2. Create a feature branch.
3. Add or update tests.
4. Run the full validation suite.
5. Commit your changes.
6. Open a pull request.

```bash
git checkout -b feature/my-change
npm install
npm run check
git add .
git commit -m "feat: describe the change"
git push -u origin feature/my-change
```

When changing generator output, update and review the affected snapshots:

```bash
npx vitest run -u
git diff
```

## License

MIT
