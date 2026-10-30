/**
 * Test completi per src/lib/validation.ts
 */
import { describe, it, expect } from "vitest";
import {
  emailSchema,
  strongPasswordSchema,
  ruoloSchema,
  nuovoUtenteSchema,
  nuovoComuneSchema,
  nuovaRegioneSchema,
  nuovaProvinciaSchema,
  segnalazionePecSchema,
  validaPecCcAggiuntive,
  validate,
} from "@/lib/validation";

describe("emailSchema", () => {
  it("accetta email valide", () => {
    expect(emailSchema.safeParse("test@example.com").success).toBe(true);
    expect(emailSchema.safeParse("a.b@c.it").success).toBe(true);
    expect(emailSchema.safeParse("user+tag@domain.org").success).toBe(true);
  });

  it("rifiuta email non valide", () => {
    expect(emailSchema.safeParse("non-email").success).toBe(false);
    expect(emailSchema.safeParse("").success).toBe(false);
    expect(emailSchema.safeParse("a@").success).toBe(false);
    expect(emailSchema.safeParse("@b.it").success).toBe(false);
    expect(emailSchema.safeParse("a @b.it").success).toBe(false);
  });

  it("normalizza in minuscolo e trim", () => {
    const result = emailSchema.safeParse("Test@Example.com");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("test@example.com");
  });

  it("rifiuta email troppo lunghe", () => {
    const lunga = "a".repeat(256) + "@b.it";
    expect(emailSchema.safeParse(lunga).success).toBe(false);
  });
});

describe("strongPasswordSchema", () => {
  it("accetta password valide", () => {
    expect(strongPasswordSchema.safeParse("Abcdefg1!xyz").success).toBe(true);
    expect(strongPasswordSchema.safeParse("Password2026!").success).toBe(true);
  });
  it("rifiuta password troppo corte (< 12)", () => {
    expect(strongPasswordSchema.safeParse("Ab1!xxxx").success).toBe(false);
  });
  it("rifiuta senza maiuscola", () => {
    expect(strongPasswordSchema.safeParse("abcdefg1!xyz").success).toBe(false);
  });
  it("rifiuta senza minuscola", () => {
    expect(strongPasswordSchema.safeParse("ABCDEFG1!XYZ").success).toBe(false);
  });
  it("rifiuta senza cifra", () => {
    expect(strongPasswordSchema.safeParse("Abcdefgh!xyz").success).toBe(false);
  });
  it("rifiuta senza carattere speciale", () => {
    expect(strongPasswordSchema.safeParse("Abcdefg1xyz").success).toBe(false);
  });
  it("rifiuta 3 caratteri consecutivi uguali", () => {
    expect(strongPasswordSchema.safeParse("AAAbcdef1!xyz").success).toBe(false);
    expect(strongPasswordSchema.safeParse("Abc111def!xyz").success).toBe(false);
    expect(strongPasswordSchema.safeParse("Abcdef1!!!xyz").success).toBe(false);
  });
  it("accetta 2 caratteri consecutivi uguali", () => {
    expect(strongPasswordSchema.safeParse("AAbcdef1!xyz").success).toBe(true);
  });
  it("rifiuta password che superano 72 byte (limite bcrypt), anche con meno di 128 caratteri", () => {
    // Caratteri alternati "è" e "ö" (2 byte ciascuno) evitano la regola dei tre caratteri uguali.
    // 8 + 33 caratteri = 41 caratteri ma 74 byte; 8 + 32 caratteri = 40 caratteri e 72 byte.
    expect(strongPasswordSchema.safeParse("Abcdef1!" + "èö".repeat(16) + "è").success).toBe(false);
    expect(strongPasswordSchema.safeParse("Abcdef1!" + "èö".repeat(16)).success).toBe(true);
  });
  it("rifiuta password troppo lunghe (> 128)", () => {
    const lunga = "Abcdef1!" + "x".repeat(121);
    expect(strongPasswordSchema.safeParse(lunga).success).toBe(false);
  });
});

describe("ruoloSchema", () => {
  it("accetta ruoli validi", () => {
    expect(ruoloSchema.safeParse("volontario").success).toBe(true);
    expect(ruoloSchema.safeParse("referente_provinciale").success).toBe(true);
    expect(ruoloSchema.safeParse("referente_regionale").success).toBe(true);
    expect(ruoloSchema.safeParse("admin").success).toBe(true);
  });
  it("rifiuta ruoli non validi", () => {
    expect(ruoloSchema.safeParse("superadmin").success).toBe(false);
    expect(ruoloSchema.safeParse("").success).toBe(false);
    expect(ruoloSchema.safeParse("guest").success).toBe(false);
  });
});

describe("nuovoUtenteSchema", () => {
  const valido = {
    email: "test@example.com",
    nomeCognome: "Mario Rossi",
    password: "Abcdefg1!xyz",
  };
  it("accetta utente valido con valori minimi", () => {
    const result = nuovoUtenteSchema.safeParse(valido);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ruolo).toBe("volontario");
      expect(result.data.attivo).toBe(true);
    }
  });
  it("accetta utente completo con tutti i campi", () => {
    const result = nuovoUtenteSchema.safeParse({
      ...valido,
      ruolo: "referente_provinciale",
      provinciaId: 1,
      pec: "test@pec.it",
      emailOrdinaria: "test@ord.it",
      indirizzo: "Via Roma 1",
      firma: "Mario Rossi",
      inizialiProtocollo: "MR",
      attivo: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ruolo).toBe("referente_provinciale");
      expect(result.data.attivo).toBe(false);
      expect(result.data.inizialiProtocollo).toBe("MR");
    }
  });
  it("rifiuta nome con CRLF", () => {
    expect(nuovoUtenteSchema.safeParse({ ...valido, nomeCognome: "Mario\r\nRossi" }).success).toBe(false);
  });
  it("rifiuta iniziali protocollo non a 2 caratteri", () => {
    expect(nuovoUtenteSchema.safeParse({ ...valido, inizialiProtocollo: "A" }).success).toBe(false);
    expect(nuovoUtenteSchema.safeParse({ ...valido, inizialiProtocollo: "ABC" }).success).toBe(false);
  });
  it("rifiuta iniziali protocollo con numeri", () => {
    expect(nuovoUtenteSchema.safeParse({ ...valido, inizialiProtocollo: "A1" }).success).toBe(false);
  });
  it("rifiuta PEC non valida", () => {
    expect(nuovoUtenteSchema.safeParse({ ...valido, pec: "non-email" }).success).toBe(false);
  });
});

describe("nuovaRegioneSchema", () => {
  const valido = {
    regione: "LOMBARDIA",
    riferimentoLegge: "L.R. 31/15",
    pecArpaRegionale: "arpa@pec.it",
  };
  it("accetta regione valida", () => {
    const result = nuovaRegioneSchema.safeParse(valido);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.titoloLegge).toBe("");
      expect(result.data.testoProgettoIlluminotecnico).toBe("");
    }
  });
  it("rifiuta senza regione", () => {
    expect(nuovaRegioneSchema.safeParse({ ...valido, regione: "" }).success).toBe(false);
  });
  it("rifiuta senza riferimentoLegge", () => {
    expect(nuovaRegioneSchema.safeParse({ ...valido, riferimentoLegge: "" }).success).toBe(false);
  });
  it("rifiuta PEC ARPA non valida", () => {
    expect(nuovaRegioneSchema.safeParse({ ...valido, pecArpaRegionale: "not-email" }).success).toBe(false);
  });
  it("accetta PEC ARPA vuota", () => {
    expect(nuovaRegioneSchema.safeParse({ ...valido, pecArpaRegionale: "" }).success).toBe(true);
  });
});

describe("nuovaProvinciaSchema", () => {
  const valido = {
    sigla: "BG",
    nome: "Bergamo",
    regioneId: 1,
  };
  it("accetta provincia valida", () => {
    expect(nuovaProvinciaSchema.safeParse(valido).success).toBe(true);
  });
  it("rifiuta sigla non a 2 caratteri", () => {
    expect(nuovaProvinciaSchema.safeParse({ ...valido, sigla: "B" }).success).toBe(false);
    expect(nuovaProvinciaSchema.safeParse({ ...valido, sigla: "BERG" }).success).toBe(false);
  });
  it("rifiuta sigla con numeri", () => {
    expect(nuovaProvinciaSchema.safeParse({ ...valido, sigla: "B1" }).success).toBe(false);
  });
  it("rifiuta regioneId non positivo", () => {
    expect(nuovaProvinciaSchema.safeParse({ ...valido, regioneId: 0 }).success).toBe(false);
    expect(nuovaProvinciaSchema.safeParse({ ...valido, regioneId: -1 }).success).toBe(false);
  });
  it("accetta PEC ARPA provinciale opzionale", () => {
    expect(nuovaProvinciaSchema.safeParse({ ...valido, pecArpaProvinciale: "arpa@pec.it" }).success).toBe(true);
    expect(nuovaProvinciaSchema.safeParse({ ...valido, pecArpaProvinciale: "" }).success).toBe(true);
    expect(nuovaProvinciaSchema.safeParse({ ...valido, pecArpaProvinciale: null }).success).toBe(true);
  });
});

describe("nuovoComuneSchema", () => {
  const valido = {
    nome: "Verdello",
    provinciaId: 1,
    cap: "24049",
    pecComune: "protocollo@pec.it",
  };
  it("accetta comune valido", () => {
    expect(nuovoComuneSchema.safeParse(valido).success).toBe(true);
  });
  it("rifiuta CAP non a 5 cifre", () => {
    expect(nuovoComuneSchema.safeParse({ ...valido, cap: "123" }).success).toBe(false);
    expect(nuovoComuneSchema.safeParse({ ...valido, cap: "1234567" }).success).toBe(false);
    expect(nuovoComuneSchema.safeParse({ ...valido, cap: "abcde" }).success).toBe(false);
  });
  it("rifiuta nome con CRLF", () => {
    expect(nuovoComuneSchema.safeParse({ ...valido, nome: "Verdello\r\n" }).success).toBe(false);
  });
  it("rifiuta PEC non valida", () => {
    expect(nuovoComuneSchema.safeParse({ ...valido, pecComune: "not-email" }).success).toBe(false);
  });
  it("rifiuta provinciaId non positivo", () => {
    expect(nuovoComuneSchema.safeParse({ ...valido, provinciaId: 0 }).success).toBe(false);
  });
  it("accetta nomeSindaco e noteAggiornamento opzionali", () => {
    expect(
      nuovoComuneSchema.safeParse({ ...valido, nomeSindaco: "Mario Rossi", noteAggiornamento: "2026-01-15" }).success,
    ).toBe(true);
    expect(nuovoComuneSchema.safeParse({ ...valido, nomeSindaco: null, noteAggiornamento: null }).success).toBe(true);
  });
  it("rifiuta nomeSindaco con CRLF", () => {
    expect(nuovoComuneSchema.safeParse({ ...valido, nomeSindaco: "Mario\r\nRossi" }).success).toBe(false);
  });
});

describe("segnalazionePecSchema", () => {
  it("rifiuta oggetto con CRLF", () => {
    expect(segnalazionePecSchema.safeParse({ oggettoPec: "test\r\nBcc: evil@hacker.it" }).success).toBe(false);
  });
  it("rifiuta destinatario con CRLF", () => {
    expect(segnalazionePecSchema.safeParse({ destinatarioNome: "Sindaco\r\nX-Header: injected" }).success).toBe(false);
  });
  it("accetta campi validi", () => {
    expect(
      segnalazionePecSchema.safeParse({
        oggettoPec: "Segnalazione impianto non conforme",
        destinatarioNome: "Sindaco Mario Rossi",
        testoIntroduttivoPec: "Si segnala...",
      }).success,
    ).toBe(true);
  });
  it("accetta tutti i campi null/undefined", () => {
    expect(segnalazionePecSchema.safeParse({}).success).toBe(true);
    expect(
      segnalazionePecSchema.safeParse({
        oggettoPec: null,
        testoIntroduttivoPec: null,
        pecCcAggiuntive: null,
        destinatarioNome: null,
      }).success,
    ).toBe(true);
  });
  it("rifiuta oggetto troppo lungo (> 200)", () => {
    expect(segnalazionePecSchema.safeParse({ oggettoPec: "a".repeat(201) }).success).toBe(false);
  });
  it("rifiuta testo introduttivo troppo lungo (> 2000)", () => {
    expect(segnalazionePecSchema.safeParse({ testoIntroduttivoPec: "a".repeat(2001) }).success).toBe(false);
  });
});

describe("validaPecCcAggiuntive", () => {
  it("accetta stringa vuota", () => {
    const result = validaPecCcAggiuntive("");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.emails).toEqual([]);
  });
  it("accetta null/undefined", () => {
    expect(validaPecCcAggiuntive(null).ok).toBe(true);
    expect(validaPecCcAggiuntive(undefined).ok).toBe(true);
  });
  it("accetta tre email valide", () => {
    const result = validaPecCcAggiuntive("a@b.it; c@d.it; e@f.it");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.emails).toHaveLength(3);
  });
  it("accetta esattamente 5 email", () => {
    const result = validaPecCcAggiuntive("a@b.it; c@d.it; e@f.it; g@h.it; i@l.it");
    expect(result.ok).toBe(true);
  });
  it("rifiuta più di 5 email", () => {
    const input = "a@b.it; c@d.it; e@f.it; g@h.it; i@l.it; m@n.it";
    const result = validaPecCcAggiuntive(input);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Massimo 5");
  });
  it("rifiuta email non valida tra i CC", () => {
    const result = validaPecCcAggiuntive("a@b.it; non-email; c@d.it");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("non-email");
  });
  it("gestisce spazi e punti e virgola trailing", () => {
    const result = validaPecCcAggiuntive("  a@b.it ;  c@d.it ;  ");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.emails).toEqual(["a@b.it", "c@d.it"]);
  });
});

describe("validate (helper generico)", () => {
  it("ritorna success con dati validi", () => {
    const result = validate(emailSchema, "test@example.com");
    expect(result.success).toBe(true);
  });
  it("ritorna error con dati non validi", () => {
    const result = validate(emailSchema, "not-email");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("Formato email non valido");
  });
  it("ritorna error con messaggio della prima issue", () => {
    const result = validate(strongPasswordSchema, "weak");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("La password deve avere almeno 12 caratteri");
  });
});
