/**
 * Politiche di repository verificate come test: pin delle dipendenze esterne
 * (action GitHub, immagini Docker), file di governance e configurazione
 * coerente di Node.js. Ogni regola fallisce con un messaggio esplicito se
 * una modifica la viola, così la CI non può regredire in silenzio.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

function leggi(relativo: string): string {
  return readFileSync(path.join(ROOT, relativo), "utf8");
}

function fileWorkflow(): string[] {
  const dir = path.join(ROOT, ".github", "workflows");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".yml"))
    .map((f) => path.join(".github", "workflows", f));
}

describe("politiche di repository - pin delle dipendenze esterne", () => {
  it("ogni action GitHub nei workflow è fissata a un SHA di commit completo", () => {
    for (const file of fileWorkflow()) {
      const usi = leggi(file)
        .split("\n")
        .map((riga) => riga.trim().replace(/^- /, ""))
        .filter((riga) => riga.startsWith("uses:"))
        .map((riga) => riga.slice("uses:".length).trim().split(/\s+/)[0]);
      expect(usi.length, `${file} deve contenere action`).toBeGreaterThan(0);
      for (const uso of usi) {
        expect(uso, `${file}: ${uso} non è fissata a un SHA`).toMatch(/@[0-9a-f]{40}$/);
      }
    }
  });

  it("le immagini Docker dei workflow sono fissate a un digest sha256", () => {
    for (const file of fileWorkflow()) {
      const contenuto = leggi(file);
      const immagini = [...contenuto.matchAll(/image:\s*(\S+)/g)].map((m) => m[1]);
      for (const img of immagini) {
        expect(img, `${file}: ${img}`).toMatch(/@sha256:[0-9a-f]{64}$/);
      }
      const eseguite = [...contenuto.matchAll(/^\s*(ghcr\.io\/\S+|caddy:\S+|rhysd\/actionlint:\S+)\s*\\?$/gm)].map(
        (m) => m[1],
      );
      for (const img of eseguite) {
        expect(img, `${file}: ${img}`).toMatch(/@sha256:[0-9a-f]{64}$/);
      }
    }
  });

  it("il Dockerfile aggiorna npm e undici dell'immagine e verifica le versioni minime", () => {
    const dockerfile = leggi("Dockerfile");
    expect(dockerfile).toContain("npm install -g npm@11.21.1");
    expect(dockerfile).toContain("undici@6.29.1");
    expect(dockerfile).toContain('"5.0.11"');
  });

  it("ogni workflow dichiara permessi minimi a livello di workflow", () => {
    for (const file of fileWorkflow()) {
      expect(leggi(file), `${file} senza blocco permissions`).toMatch(/^permissions:\s*$/m);
      expect(leggi(file), `${file} senza concurrency`).toMatch(/^concurrency:\s*$/m);
    }
  });

  it("ogni immagine base del Dockerfile è fissata a un digest sha256", () => {
    const froms = [...leggi("Dockerfile").matchAll(/^FROM\s+(\S+)/gm)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(0);
    for (const img of froms) {
      expect(img, `FROM ${img}`).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
  });

  it("i servizi di docker-compose sono fissati a un digest sha256", () => {
    const immagini = [...leggi("docker-compose.yml").matchAll(/image:\s*(\S+)/g)].map((m) => m[1]);
    expect(immagini.length).toBeGreaterThan(0);
    for (const img of immagini) {
      expect(img, img).toMatch(/@sha256:[0-9a-f]{64}$/);
    }
  });
});

describe("politiche di repository - Node.js coerente", () => {
  it(".nvmrc, engines e .npmrc indicano la stessa major di Node.js (24)", () => {
    expect(leggi(".nvmrc").trim()).toBe("24");
    const pkg = JSON.parse(leggi("package.json")) as { engines?: { node?: string } };
    expect(pkg.engines?.node).toBe(">=24.0.0");
    expect(leggi(".npmrc")).toMatch(/^engine-strict=true$/m);
  });
});

describe("politiche di repository - file di governance", () => {
  it.each([
    "LICENSE",
    "README.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "CODE_OF_CONDUCT.md",
    "CHANGELOG.md",
    ".github/CODEOWNERS",
    ".github/dependabot.yml",
    ".github/PULL_REQUEST_TEMPLATE.md",
    ".github/ISSUE_TEMPLATE/config.yml",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    ".editorconfig",
    ".gitattributes",
    ".prettierrc.json",
    ".husky/pre-commit",
    ".husky/commit-msg",
    ".vscode/settings.json",
    ".vscode/extensions.json",
    ".github/workflows/scorecard.yml",
    "public/.well-known/security.txt",
    "knip.json",
  ])("il file %s esiste", (file) => {
    expect(existsSync(path.join(ROOT, file)), `${file} mancante`).toBe(true);
  });

  it("Dependabot copre npm, GitHub Actions, Dockerfile e docker-compose", () => {
    const contenuto = leggi(".github/dependabot.yml");
    for (const ecosistema of ["npm", "github-actions", "docker", "docker-compose"]) {
      expect(contenuto).toContain(`package-ecosystem: "${ecosistema}"`);
    }
  });

  it("security.txt contiene un contatto e una scadenza futura (RFC 9116)", () => {
    const contenuto = leggi("public/.well-known/security.txt");
    expect(contenuto).toMatch(/^Contact: mailto:/m);
    const scadenza = contenuto.match(/^Expires: (\S+)$/m)?.[1];
    expect(scadenza, "campo Expires assente").toBeDefined();
    expect(Date.parse(scadenza ?? "")).toBeGreaterThan(Date.now());
  });

  it("il workflow CodeQL analizza JavaScript e TypeScript", () => {
    expect(leggi(".github/workflows/codeql.yml")).toContain("languages: javascript-typescript");
  });

  it("lint-staged è agganciato al pre-commit", () => {
    expect(leggi(".husky/pre-commit")).toContain("lint-staged");
  });

  it("il titolo dei commit è limitato a 72 caratteri dall'hook commit-msg", () => {
    expect(leggi(".husky/commit-msg")).toContain("-gt 72");
  });

  it("Scorecard analizza il repository e pubblica i risultati", () => {
    const contenuto = leggi(".github/workflows/scorecard.yml");
    expect(contenuto).toContain("ossf/scorecard-action@");
    expect(contenuto).toContain("publish_results: true");
    expect(contenuto).toContain("security-events: write");
  });

  it("la CI esegue actionlint sui workflow", () => {
    expect(leggi(".github/workflows/ci.yml")).toContain("rhysd/actionlint:1.7.7@sha256:");
  });
});
