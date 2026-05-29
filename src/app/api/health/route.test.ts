import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("returns a stable health payload", async () => {
    const response = GET();

    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: "nexa",
    });
    expect(response.status).toBe(200);
  });
});
