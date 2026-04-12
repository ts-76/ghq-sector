import { describe, expect, it } from "vitest";
import {
  parseInputValue,
  stripWrappingQuotes,
} from "../ui/src/visual-json-internal.js";

describe("visual json input parsing", () => {
  it("strips matching wrapping quotes from string input", () => {
    expect(stripWrappingQuotes('"/tmp/workspace"')).toBe("/tmp/workspace");
    expect(stripWrappingQuotes("'projects'")).toBe("projects");
    expect(stripWrappingQuotes('echo "hi"')).toBe('echo "hi"');
  });

  it("normalizes quoted scalar input before type coercion", () => {
    expect(parseInputValue('"42"', "number", "number")).toBe(42);
    expect(parseInputValue('"oops"', "number", "number")).toBeUndefined();
    expect(parseInputValue("'true'", "boolean", "boolean")).toBe(true);
    expect(parseInputValue('"null"', "null", "null")).toBeNull();
    expect(parseInputValue('"tools"', "string", "string")).toBe("tools");
  });
});
