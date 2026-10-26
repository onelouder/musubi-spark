import { expect, test } from "@playwright/test";

test("serves every server-rendered stylesheet as CSS", async ({ page }) => {
  const response = await page.goto("/login");
  expect(response?.ok()).toBe(true);
  const html = await response!.text();
  const stylesheets = await page.evaluate((documentHtml) => {
    const document = new DOMParser().parseFromString(documentHtml, "text/html");
    return Array.from(document.querySelectorAll('link[rel="stylesheet"]'),
      (link) => link.getAttribute("href")!);
  }, html);

  expect(stylesheets.length).toBeGreaterThan(0);
  for (const href of stylesheets) {
    const stylesheet = await page.request.get(href, { headers: { Accept: "text/css,*/*;q=0.1" } });
    expect(stylesheet.ok(), href).toBe(true);
    expect(stylesheet.headers()["content-type"], href).toMatch(/^text\/css\b/);
  }
});
