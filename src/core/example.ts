import { RefResolver } from "./refs";
import { isRecord, firstDefined, mergeAllOfSchemas } from "./helpers";

const MAX_RECURSION_DEPTH = 64;

/**
 * Context for example generation, controls readOnly/writeOnly filtering.
 * - isRequestBody: true → skip readOnly properties
 * - isResponse: true → skip writeOnly properties
 */
export type ExampleGenContext = {
  isRequestBody: boolean;
  isResponse: boolean;
};

export const defaultExampleContext: ExampleGenContext = {
  isRequestBody: false,
  isResponse: false,
};

/**
 * Generate example value from JSON-Schema / OpenAPI 3.2 Schema Object.
 * Compliant with OAS3.2 schema 2025-11-23, browser-only.
 * Handles boolean schemas (true / false), const, enum, composition keywords, type inference, formats.
 * Respects minLength/maxLength, minItems/maxItems, minimum/maximum, multipleOf.
 * Skips readOnly fields for request-body context; skips writeOnly fields for response context.
 * Basic pattern regex-aware string example generation.
 * @param schema raw schema value (may contain $ref)
 * @param resolver reference resolver instance
 * @param seen set for circular-reference detection
 * @param depth current recursion depth
 * @param ctx generation context for readOnly/writeOnly rules
 * @returns example instance value, null for stop-circular, undefined for no-inference
 */
export function example(
  schema: unknown,
  resolver: RefResolver,
  seen?: Set<unknown>,
  depth = 0,
  ctx: ExampleGenContext = defaultExampleContext,
): unknown {
  const localSeen = seen ?? new Set<unknown>();
  if (depth >= MAX_RECURSION_DEPTH) {
    return null;
  }

  const resolved = resolver.deref(schema);

  // Handle boolean-schema: OAS3.2 allows schema: true | false
  if (typeof resolved === "boolean") {
    return resolved ? {} : null;
  }
  if (!isRecord(resolved)) {
    return undefined;
  }

  const node = resolved as Record<string, unknown>;
  if (localSeen.has(node)) {
    return null;
  }
  localSeen.add(node);

  // OAS3.2 precedence: node.example > first entry of node.examples array-style
  const directExample = firstDefined(
    node.example,
    Array.isArray(node.examples) && node.examples.length
      ? node.examples[0]
      : undefined,
  );
  if (directExample !== undefined) {
    return directExample;
  }

  if (node.const !== undefined) {
    return node.const;
  }
  if (node.default !== undefined) {
    return node.default;
  }
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    return node.enum[0];
  }

  // Composition keywords
  if (Array.isArray(node.oneOf) && node.oneOf.length > 0) {
    return example(node.oneOf[0], resolver, localSeen, depth + 1, ctx);
  }
  if (Array.isArray(node.anyOf) && node.anyOf.length > 0) {
    return example(node.anyOf[0], resolver, localSeen, depth + 1, ctx);
  }

  // allOf: merge schema constraints FIRST, generate example from merged composite schema
  if (Array.isArray(node.allOf) && node.allOf.length > 0) {
    const mergedSchema = mergeAllOfSchemas(node.allOf, resolver);
    if (mergedSchema === undefined) {
      return null;
    }
    // copy top-level non-allOf keywords onto merged composite schema
    const composite: Record<string, unknown> = { ...mergedSchema };
    for (const [k, v] of Object.entries(node)) {
      if (k !== "allOf" && composite[k] === undefined) {
        composite[k] = v;
      }
    }
    return example(composite, resolver, localSeen, depth + 1, ctx);
  }

  // JSON-Schema tuple prefixItems
  if (Array.isArray(node.prefixItems) && node.prefixItems.length > 0) {
    return node.prefixItems.map((item: unknown) =>
      example(item, resolver, localSeen, depth + 1, ctx),
    );
  }

  // Stub placeholders for unsupported JSON-Schema 2020-12 keywords
  /* contains, dependentRequired, if-then-else, $dynamicRef: no full implementation, pass-through */

  let inferredType: string | undefined;
  if (typeof node.type === "string") {
    inferredType = node.type;
  } else if (Array.isArray(node.type)) {
    const nonNull = node.type.find((entry: unknown) => entry !== "null");
    inferredType =
      typeof nonNull === "string"
        ? nonNull
        : (node.type[0] as string | undefined);
  }

  switch (inferredType) {
    case "string": {
      if (node.format === "binary") {
        return {
          __file: true,
          name: "file.bin",
          contentType: "application/octet-stream",
          data: "",
        };
      }
      if (node.format === "date-time") return "2025-01-01T00:00:00Z";
      if (node.format === "date") return "2025-01-01";
      if (node.format === "time") return "00:00:00Z";
      if (node.format === "duration") return "P1D";

      const minLen = typeof node.minLength === "number" ? node.minLength : 0;
      const maxLen =
        typeof node.maxLength === "number" ? node.maxLength : Infinity;
      const targetLen = Math.min(Math.max(minLen, 2), maxLen);

      // lorem-ipsum style word fragments for western-friendly sample strings
      const wordPool = [
        "lorem",
        "ipsum",
        "dolor",
        "sit",
        "amet",
        "consectetur",
        "adipiscing",
        "elit",
        "sed",
        "do",
        "eiusmod",
        "tempor",
        "incididunt",
        "ut",
        "labore",
        "dolore",
        "magna",
        "aliqua",
        "sample",
        "text",
        "value",
        "demo",
        "test",
      ];

      function makeSampleString(len: number): string {
        if (len <= 0) return "";
        let buf = "";
        let idx = 0;
        while (buf.length < len) {
          const word = wordPool[idx % wordPool.length];
          if (buf.length > 0) buf += " ";
          buf += word;
          idx++;
        }
        // hard-truncate to exact target length
        return buf.slice(0, len);
      }

      let strVal: string;
      try {
        strVal = makeSampleString(targetLen);
      } catch {
        // safety fallback
        strVal = "x".repeat(targetLen);
      }

      // pattern-aware string generation, degrade safely on invalid regex
      if (typeof node.pattern === "string") {
        try {
          const re = new RegExp(node.pattern);
          // try simple candidates until match
          const candidates = ["test", "abc", "sample", "value_01", strVal, "A"];
          const matched = candidates.find((c) => re.test(c));
          if (matched !== undefined) {
            strVal = matched;
            // respect maxLength after candidate selection
            strVal = strVal.slice(0, maxLen);
          }
        } catch {
          // invalid regex pattern, keep generated sample string
        }
      }

      return strVal;
    }

    case "integer": {
      let val = 0;
      if (typeof node.minimum === "number") {
        val = Math.ceil(node.minimum);
      }
      if (typeof node.multipleOf === "number" && node.multipleOf > 0) {
        val = Math.ceil(val / node.multipleOf) * node.multipleOf;
      }
      // respect upper-bound maximum
      if (typeof node.maximum === "number") {
        val = Math.min(val, node.maximum);
      }
      return val;
    }
    case "number": {
      let val = 0;
      if (typeof node.minimum === "number") {
        val = node.minimum;
      }
      if (typeof node.multipleOf === "number" && node.multipleOf > 0) {
        val = Math.ceil(val / node.multipleOf) * node.multipleOf;
      }
      // respect upper-bound maximum
      if (typeof node.maximum === "number") {
        val = Math.min(val, node.maximum);
      }
      return val;
    }
    case "boolean":
      return true;
    case "null":
      return null;
    case "array": {
      if (Array.isArray(node.examples) && node.examples.length > 0) {
        return node.examples[0];
      }
      const itemSchema = node.items;
      const arr: unknown[] = [];
      const minItems = typeof node.minItems === "number" ? node.minItems : 0;
      const maxItems =
        typeof node.maxItems === "number" ? node.maxItems : Infinity;
      const count = Math.min(Math.max(1, minItems), maxItems);
      if (itemSchema) {
        for (let i = 0; i < count; i++) {
          arr.push(example(itemSchema, resolver, localSeen, depth + 1, ctx));
        }
      }
      return arr;
    }
    case "object":
    default: {
      const output: Record<string, unknown> = {};
      const properties = isRecord(node.properties) ? node.properties : {};
      for (const [key, propertySchema] of Object.entries(properties)) {
        const propResolved = resolver.deref(propertySchema);
        if (isRecord(propResolved)) {
          // skip readOnly for request-body
          if (ctx.isRequestBody && Boolean(propResolved.readOnly)) {
            continue;
          }
          // skip writeOnly for response
          if (ctx.isResponse && Boolean(propResolved.writeOnly)) {
            continue;
          }
        }
        output[key] = example(
          propertySchema,
          resolver,
          localSeen,
          depth + 1,
          ctx,
        );
      }

      // patternProperties example
      if (isRecord(node.patternProperties)) {
        const patternEntries = Object.entries(node.patternProperties);
        if (patternEntries.length > 0) {
          const [patternKey, patternSchema] = patternEntries[0];
          const dummyKey = `_pattern_${patternKey.replace(/[^a-zA-Z0-9]/g, "_")}`;
          output[dummyKey] = example(
            patternSchema,
            resolver,
            localSeen,
            depth + 1,
            ctx,
          );
        }
      }

      if (Object.keys(output).length === 0 && node.additionalProperties) {
        output.additionalProp = example(
          node.additionalProperties,
          resolver,
          localSeen,
          depth + 1,
          ctx,
        );
      }
      if (Object.keys(output).length === 0 && node.unevaluatedProperties) {
        output.additionalProp = example(
          node.unevaluatedProperties,
          resolver,
          localSeen,
          depth + 1,
          ctx,
        );
      }
      return output;
    }
  }
}
