import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { parameter } from "../src/core/serialize.js";

describe("parameter serialization fuzz tests", () => {
  it("does not throw for arbitrary JSON-compatible deepObject values", () => {
    fc.assert(
      fc.property(fc.jsonValue({ maxDepth: 5 }), (value) => {
        expect(() =>
          parameter({
            name: "x",
            in: "query",
            style: "deepObject",
            value,
          }),
        ).not.toThrow();
      }),
      {
        numRuns: 500,
        endOnFailure: true,
      },
    );
  });
});