import { defineConfig, devices } from "@playwright/test";

/**
 * Test end-to-end sulla build statica (GitHub Pages) servita da `out/`.
 * Esecuzione: `npm run build:pages` seguito da `npm run test:e2e`.
 * Non fanno parte della copertura unitaria (vedi vitest.config.mts).
 */
const PORTA = 8765;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORTA}/`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    command: `python3 -m http.server ${PORTA} --bind 127.0.0.1 --directory out`,
    url: `http://127.0.0.1:${PORTA}/`,
    reuseExistingServer: !process.env.CI,
    stdout: "ignore",
    stderr: "pipe",
  },
});
