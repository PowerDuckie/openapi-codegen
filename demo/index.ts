import { generate, list } from "../src/index.js";
import { petstoreDocument } from "./petstore.js";

function printSection(title: string): void {
  const rule = "─".repeat(72);

  console.log(`\n${rule}`);
  console.log(title);
  console.log(rule);
}

function printGenerators(): void {
  const generators = list();

  printSection(`Available generators (${generators.length})`);

  const grouped = new Map<string, string[]>();

  for (const { language, client } of generators) {
    const clients = grouped.get(language) ?? [];
    clients.push(client);
    grouped.set(language, clients);
  }

  const rows = [...grouped.entries()].map(([language, clients]) => ({
    language,
    clients: clients.join(", "),
  }));

  console.table(rows);
}

function generateExample(
  title: string,
  options: {
    path: string;
    method: string;
    language: string;
    client: string;
  },
): void {
  printSection(title);

  const code = generate({
    document: petstoreDocument,
    ...options,
  });

  console.log(code);
}

function main(): void {
  printGenerators();

  generateExample("Shell / curl — Get a pet by ID", {
    path: "/pets/{id}",
    method: "get",
    language: "shell",
    client: "curl",
  });

  generateExample("JavaScript / fetch — List pets", {
    path: "/pets",
    method: "get",
    language: "javascript",
    client: "fetch",
  });

  generateExample("Python / requests — Create a pet", {
    path: "/pets",
    method: "post",
    language: "python",
    client: "requests",
  });
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  console.error(`\nDemo failed: ${message}`);
}
