/**
 * RefResolver for OpenAPI 3.2, browser-compatible, only supports in-document JSON-Pointer references starting with #/
 * Compliant: https://spec.openapis.org/oas/3.2/schema/2025-11-23.html
 */
export class RefResolver {
  private readonly root: unknown;
  private readonly cache = new Map<string, unknown>();
  private readonly stack = new Set<string>();
  /** When softMode=true: do NOT throw on broken/circular refs; return partial/original value instead */
  public softMode: boolean;

  public constructor(root: unknown, softMode = false) {
    this.root = root;
    this.softMode = softMode;
  }

  /**
   * Dereference value, if it contains $ref, resolve it; otherwise return original value.
   * Does NOT validate type of resolved result, only resolves pointer.
   */
  public deref<T = unknown>(value: T): T {
    if (!value || typeof value !== "object") {
      return value;
    }
    const target = value as { $ref?: unknown };
    if (typeof target.$ref !== "string") {
      return value;
    }
    try {
      return this.resolveRef<T>(target.$ref);
    } catch (err) {
      if (this.softMode) {
        return value;
      }
      throw err;
    }
  }

  /**
   * Resolve JSON Pointer $ref starting with #/.
   * Throws for external refs, circular refs, broken pointers unless softMode is enabled.
   */
  public resolveRef<T = unknown>(ref: string): T {
    if (!ref.startsWith("#/")) {
      const err = new Error(
        `Only in-document references are supported: ${ref}`,
      );
      if (this.softMode) {
        return { $ref: ref } as T;
      }
      throw err;
    }
    if (this.cache.has(ref)) {
      return this.cache.get(ref) as T;
    }
    if (this.stack.has(ref)) {
      const err = new Error(
        `Circular reference detected while resolving: ${ref}`,
      );
      if (this.softMode) {
        return { $ref: ref } as T;
      }
      throw err;
    }
    this.stack.add(ref);
    try {
      const pointerSegments = ref
        .slice(2)
        .split("/")
        .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));

      let current: unknown = this.root;
      for (const part of pointerSegments) {
        if (current === null || typeof current !== "object") {
          const err = new Error(`Broken reference: ${ref}`);
          if (this.softMode) return { $ref: ref } as T;
          throw err;
        }
        current = (current as Record<string, unknown>)[part];
        if (current === undefined) {
          const err = new Error(`Broken reference: ${ref}`);
          if (this.softMode) return { $ref: ref } as T;
          throw err;
        }
      }

      // Follow chained $ref
      if (
        current &&
        typeof current === "object" &&
        typeof (current as { $ref?: unknown }).$ref === "string"
      ) {
        const chained = this.resolveRef((current as { $ref: string }).$ref);
        this.cache.set(ref, chained);
        return chained as T;
      }

      this.cache.set(ref, current);
      return current as T;
    } finally {
      this.stack.delete(ref);
    }
  }

  /** Clear internal cache, for reuse with different documents. */
  public clearCache(): void {
    this.cache.clear();
  }
}
