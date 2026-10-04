import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges conditional and conflicting Tailwind classes", () => {
    expect(cn("px-2", true && "px-4", false && "py-2")).toBe("px-4");
  });
  it("preserves conditional object and nested array inputs", () => {
    expect(cn("px-2", ["py-1", { hidden: false, "px-4": true }])).toBe(
      "py-1 px-4",
    );
  });

  it("merges responsive and hover conflicts without mixing independent variants", () => {
    expect(
      cn("px-2 md:px-2 hover:bg-red-500", "md:px-4 hover:bg-blue-500"),
    ).toBe("px-2 md:px-4 hover:bg-blue-500");
  });
});
