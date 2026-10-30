import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/** Account dimostrativi della build statica (vedi src/lib/demo-mode.ts). */
const VOLONTARIO = {
  email: "volontario@demo.cielobuio-segnalazioni.local",
  password: "SoloLettura-Volontario!1",
};

const TEMI = ["chiaro", "scuro"] as const;

async function impostaTema(page: Page, tema: (typeof TEMI)[number]) {
  await page.addInitScript((valore) => {
    window.localStorage.setItem("cielobuio-tema", valore);
  }, tema);
}

async function accedi(page: Page) {
  await page.goto("./");
  await page.getByLabel("Email").fill(VOLONTARIO.email);
  await page.getByLabel("Password").fill(VOLONTARIO.password);
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.locator("#contenuto")).toBeVisible();
}

async function violazioniWcag(page: Page) {
  const risultato = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
  return risultato.violations.map((v) => `${v.id} (${v.nodes.length} nodi): ${v.help}`);
}

for (const tema of TEMI) {
  test.describe(`tema ${tema}`, () => {
    test.beforeEach(async ({ page }) => {
      await impostaTema(page, tema);
    });

    test("schermata di accesso senza violazioni WCAG 2.2 AA", async ({ page }) => {
      await page.goto("./");
      await expect(page.getByRole("button", { name: "Accedi" })).toBeVisible();
      expect(await violazioniWcag(page)).toEqual([]);
    });

    for (const vista of ["dashboard", "lista", "nuova-segnalazione", "guida"]) {
      test(`vista ${vista} senza violazioni WCAG 2.2 AA`, async ({ page }) => {
        await accedi(page);
        await page.goto(`./?v=${vista}`);
        await expect(page.locator("#contenuto")).toBeVisible();
        expect(await violazioniWcag(page)).toEqual([]);
      });
    }
  });
}

test("la demo statica non invia credenziali non dimostrative ad alcuna API", async ({ page }) => {
  const richiesteLogin: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/auth/login")) richiesteLogin.push(req.url());
  });
  await page.goto("./");
  await page.getByLabel("Email").fill("persona@example.com");
  await page.getByLabel("Password").fill("PasswordPrivata123!");
  await page.getByRole("button", { name: "Accedi" }).click();
  await expect(page.locator("#errore-login")).toContainText("solo gli account dimostrativi");
  expect(richiesteLogin).toEqual([]);
});

// Su mobile la navigazione sta nel drawer: il percorso è coperto dal progetto desktop.
test("l'indirizzo della vista si ripristina con il tasto indietro", async ({ page, isMobile }) => {
  test.skip(isMobile, "La navigazione mobile passa dal drawer, verificato nel progetto desktop");
  await accedi(page);
  await page
    .getByRole("link", { name: /Segnalazioni/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\?v=lista/);
  await page.goBack();
  await expect(page).not.toHaveURL(/\?v=lista/);
});
