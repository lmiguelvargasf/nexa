import { expect, test } from "@playwright/test";

test("renders the template home page", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: /pragmatic base/i }),
  ).toBeVisible();
});

test("exposes a health endpoint", async ({ request }) => {
  const response = await request.get("/api/health");

  await expect(response).toBeOK();
  await expect(response.json()).resolves.toEqual({
    ok: true,
    service: "nexa",
  });
});
