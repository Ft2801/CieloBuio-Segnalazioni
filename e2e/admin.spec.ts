import { expect, test } from "@playwright/test";

/** Account dimostrativo amministratore della build statica (vedi src/lib/demo-mode.ts). */
const ADMIN = {
  email: "admin@demo.cielobuio-segnalazioni.local",
  password: "SoloLettura-Admin!1",
};

test("tutte le schede del pannello admin sono raggiungibili su ogni viewport", async ({ page }) => {
  await page.goto("./");
  await page.getByLabel("Email").fill(ADMIN.email);
  await page.getByLabel("Password").fill(ADMIN.password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.locator("#contenuto")).toBeVisible();

  await page.goto("./?v=admin");
  for (const nome of ["Regioni", "Province", "Comuni", "Utenti"]) {
    // Il clic fallisce se un altro elemento copre la scheda (es. su mobile, righe fuori dall'elenco).
    const scheda = page.getByRole("tab", { name: nome });
    await scheda.click();
    await expect(scheda).toHaveAttribute("aria-selected", "true");
  }
});
