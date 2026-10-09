// @ts-check
const { defineConfig, devices } = require("@playwright/test");

const PORT = 8086;

module.exports = defineConfig({
  testDir: "tests",
  timeout: 180_000,
  expect: { timeout: 150_000 },
  workers: 1,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Desktop Chrome"],
  },
  webServer: {
    command: `npx http-server . -p ${PORT} -a 127.0.0.1 -c-1 --silent`,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env.CI,
  },
});
