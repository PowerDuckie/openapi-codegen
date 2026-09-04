import { describe, expect, it } from "vitest";

import { generate, list } from "../src/index.js";
import document from "./fixtures/openapi-3.2.json";

describe("all generators", () => {
  const generators = list();

  it("registers at least one generator", () => {
    expect(generators.length).toBeGreaterThan(0);
  });

  for (const generator of generators) {
    const testName = `${generator.language}/${generator.client}`;
    const unsupportedMultipart =
      generator.language === "shell" && generator.client === "wget";

    it.skipIf(unsupportedMultipart)(testName, () => {
      const output = generate({
        document,
        path: "/upload/{id}",
        method: "post",
        language: generator.language,
        client: generator.client,
        securityValues: {
          bearer: "TOKEN",
          key: "KEY",
        },
      });

      expect(output).toMatchSnapshot();
    });
  }
});