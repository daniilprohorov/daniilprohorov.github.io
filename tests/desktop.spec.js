// @ts-check
const { test, expect } = require("@playwright/test");

test("/ boots Tiny Core to a console without fetching packages from the network", async ({ page, baseURL }) => {
  const requests = [];
  page.on("request", (request) => requests.push(request.url()));

  await page.goto("/");

  await expect(page.locator("#screen_container")).toContainText("tc@box:~$");

  const foreign = requests.filter((url) => new URL(url).origin !== baseURL);
  expect(foreign).toEqual([]);
  expect(requests.filter((url) => url.endsWith(".tcz"))).toEqual([]);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });

  test("/ shows the web app links", async ({ page }) => {
    await page.goto("/");

    const link = page.getByRole("link", { name: "Bike Geometry" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", "./bikeGeometry/");
  });
});

test("/bikeGeometry/ opens directly without v86", async ({ page }) => {
  const requests = [];
  page.on("request", (request) => requests.push(new URL(request.url()).pathname));

  await page.goto("/bikeGeometry/");

  await expect(page.locator("#root")).not.toBeEmpty({ timeout: 15_000 });
  expect(requests.filter((path) => path.startsWith("/v86/") || path.startsWith("/images/"))).toEqual([]);
});
