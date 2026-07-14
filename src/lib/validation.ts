/**
 * Schema di validazione per gli input lato server, usando zod.
 * Tutti gli endpoint API dovrebbero validare l'input con questi schema.
 *
 * Autore: Fabio Tempera (2026)
 */

import { z } from "zod";

export const emailSchema = z
  .string()
  .min(1, "Email obbligatoria")
  .email("Formato email non valido")
  .max(255, "Email troppo lunga")
  .transform((v) => v.toLowerCase().trim());

/**
 * Password policy rafforzata:
 * - almeno 12 caratteri
 * - almeno una maiuscola, una minuscola, un numero, un carattere speciale
 * - non più di 2 caratteri consecutivi uguali
 * - lunghezza massima in byte compatibile con bcrypt (72 byte)
 *
 * Nota su bcrypt: bcryptjs tronca silenziosamente le password oltre
 * i 72 byte, quindi due password che condividono i primi 72 byte
 * produrrebbero lo stesso hash. Il limite è calcolato in byte UTF-8
 * (non in caratteri) per gestire correttamente le password multibyte.
 */
export const strongPasswordSchema = z
  .string()
  .min(12, "La password deve avere almeno 12 caratteri")
  .max(128, "Password troppo lunga")
  .refine(
    (s) => Buffer.byteLength(s, "utf8") <= 72,
    "La password supera i 72 byte (limite bcrypt)"
  )
  .regex(/[A-Z]/, "Deve contenere almeno una lettera maiuscola")
  .regex(/[a-z]/, "Deve contenere almeno una lettera minuscola")
  .regex(/[0-9]/, "Deve contenere almeno una cifra")
  .regex(/[^A-Za-z0-9]/, "Deve contenere almeno un carattere speciale")
  // Il regex blocca 3 caratteri consecutivi uguali (es. "aaa"), quindi
  // il massimo permesso sono 2 caratteri consecutivi uguali.
  .refine((pwd) => !/(.)\1\1/.test(pwd), "Non più di 2 caratteri consecutivi uguali");

export const ruoloSchema = z.enum([
  "volontario",
  "referente_provinciale",
  "referente_regionale",
  "admin",
]);

/**
 * Schema per la creazione di un utente, con validazione incrociata
 * ruolo/territorio: referente_provinciale richiede provinciaId,
 * referente_regionale richiede regioneId. Volontario e admin non
 * devono avere territorio assegnato (verrà ignorato, ma è meglio
 * rifiutarlo esplicitamente per evitare configurazioni fuorvianti).
 */
export const nuovoUtenteSchema = z
  .object({
    email: emailSchema,
    nomeCognome: z.string().min(1, "Nome e cognome obbligatori").max(200).regex(/^[^\r\n]*$/, "Il nome non può contenere a capo"),
    password: strongPasswordSchema,
    ruolo: ruoloSchema.default("volontario"),
    provinciaId: z.number().int().min(1).optional().nullable(),
    regioneId: z.number().int().min(1).optional().nullable(),
    indirizzo: z.string().max(500).optional().nullable(),
    pec: z.string().email("PEC non valida").optional().nullable().or(z.literal("")),
    emailOrdinaria: z.string().email("Email ordinaria non valida").optional().nullable().or(z.literal("")),
    firma: z.string().max(2000).optional().nullable(),
    inizialiProtocollo: z
      .string()
      .min(2, "Iniziali protocollo devono avere 2 caratteri")
      .max(2, "Iniziali protocollo devono avere 2 caratteri")
      .regex(/^[A-Za-z]+$/, "Solo lettere ammesse")
      .optional()
      .nullable(),
    attivo: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (data.ruolo === "referente_provinciale" && data.provinciaId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Il ruolo referente_provinciale richiede provinciaId assegnato",
        path: ["provinciaId"],
      });
    }
    if (data.ruolo === "referente_regionale" && data.regioneId == null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Il ruolo referente_regionale richiede regioneId assegnato",
        path: ["regioneId"],
      });
    }
    if (
      (data.ruolo === "volontario" || data.ruolo === "admin") &&
      (data.provinciaId != null || data.regioneId != null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "I ruoli volontario e admin non devono avere territorio assegnato",
        path: ["ruolo"],
      });
    }
  });

export const nuovaRegioneSchema = z.object({
  regione: z.string().min(1, "Regione obbligatoria").max(100).regex(/^[^\r\n]*$/, "Il nome regione non può contenere a capo"),
  riferimentoLegge: z.string().min(1, "Riferimento legge obbligatorio").max(500).regex(/^[^\r\n]*$/, "Il riferimento legge non può contenere a capo"),
  titoloLegge: z.string().max(2000).default(""),
  testoProgettoIlluminotecnico: z.string().max(500).default(""),
  testoDeroghe: z.string().max(500).default(""),
  testoDatiFotometrici: z.string().max(500).default(""),
  testoApprovazione: z.string().max(500).default(""),
  testoInstallazione: z.string().max(500).default(""),
  testoControllo: z.string().max(500).default(""),
  testoSanzioni: z.string().max(500).default(""),
  pecArpaRegionale: z.string().email("PEC ARPA non valida").or(z.literal("")),
});

export const nuovaProvinciaSchema = z.object({
  sigla: z
    .string()
    .min(2, "Sigla deve avere 2 caratteri")
    .max(2, "Sigla deve avere 2 caratteri")
    .regex(/^[A-Za-z]+$/, "Solo lettere ammesse"),
  nome: z.string().min(1, "Nome obbligatorio").max(100).regex(/^[^\r\n]*$/, "Il nome non può contenere a capo"),
  regioneId: z.number().int().min(1, "Regione obbligatoria"),
  pecArpaProvinciale: z
    .string()
    .email("PEC ARPA provinciale non valida")
    .optional()
    .nullable()
    .or(z.literal("")),
});

export const nuovoComuneSchema = z.object({
  nome: z.string().min(1, "Nome obbligatorio").max(200).regex(/^[^\r\n]*$/, "Il nome non può contenere a capo"),
  provinciaId: z.number().int().min(1, "Provincia obbligatoria"),
  // CAP italiano: esattamente 5 cifre
  cap: z
    .string()
    .length(5, "Il CAP italiano deve avere esattamente 5 cifre")
    .regex(/^[0-9]{5}$/, "CAP deve contenere solo cifre"),
  pecComune: z.string().email("PEC Comune non valida"),
  nomeSindaco: z.string().max(200).regex(/^[^\r\n]*$/, "Il nome del sindaco non può contenere a capo").optional().nullable(),
  noteAggiornamento: z.string().max(500).regex(/^[^\r\n]*$/, "La nota non può contenere a capo").optional().nullable(),
});

/**
 * Schema per i campi PEC della segnalazione.
 * Previene email header injection vietando CRLF.
 */
export const segnalazionePecSchema = z.object({
  oggettoPec: z
    .string()
    .max(200, "Oggetto troppo lungo (max 200 caratteri)")
    .regex(/^[^\r\n]*$/, "L'oggetto non può contenere a capo")
    .optional()
    .nullable(),
  testoIntroduttivoPec: z
    .string()
    .max(2000, "Testo introduttivo troppo lungo (max 2000 caratteri)")
    .optional()
    .nullable(),
  pecCcAggiuntive: z
    .string()
    .max(500, "PEC CC troppo lunga")
    .optional()
    .nullable(),
  destinatarioNome: z
    .string()
    .max(200)
    .regex(/^[^\r\n]*$/, "Il destinatario non può contenere a capo")
    .optional()
    .nullable(),
});

/**
 * Schema per la validazione del CAP italiano (5 cifre).
 * Condiviso tra la validazione dei comuni (admin) e la validazione
 * del CAP fornito dal volontario nel form segnalazione.
 */
export const capSchema = z
  .string()
  .length(5, "Il CAP italiano deve avere esattamente 5 cifre")
  .regex(/^[0-9]{5}$/, "CAP deve contenere solo cifre");

/**
 * Valida una lista di indirizzi PEC in copia (separati da ;).
 * Ritorna la lista normalizzata (lowercase, deduplicata) o un errore.
 *
 * Normalizzazione:
 * - trimming di ogni indirizzo
 * - lowercase per coerenza con emailSchema
 * - deduplicazione case-insensitive (lo stesso indirizzo ripetuto
 *   non genera email multiple)
 */
export function validaPecCcAggiuntive(
  input: string | null | undefined
): { ok: true; emails: string[] } | { ok: false; error: string } {
  if (!input || !input.trim()) return { ok: true, emails: [] };
  const parts = input
    .split(";")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const localEmailSchema = z.string().email();
  const seen = new Set<string>();
  const emails: string[] = [];
  // Validazione e deduplicazione in un singolo passaggio: il conteggio
  // per il limite massimo di 5 indirizzi viene calcolato sugli indirizzi
  // unici, non sulle raw entry. Così 6 ripetizioni dello stesso indirizzo
  // non generano un falso positivo sul limite (verrebbero deduplicate a 1
  // ed è ciò che effettivamente partirebbe come email).
  for (const p of parts) {
    if (!localEmailSchema.safeParse(p).success) {
      return { ok: false, error: `Indirizzo PEC non valido: ${p}` };
    }
    if (seen.has(p)) continue;
    seen.add(p);
    emails.push(p);
  }
  if (emails.length > 5) {
    return { ok: false, error: "Massimo 5 indirizzi PEC in copia" };
  }
  return { ok: true, emails };
}

/**
 * Valida un input contro uno schema zod.
 * Ritorna { success: true, data } o { success: false, error }.
 *
 * Restituisce il primo messaggio di errore (per compatibilità con la
 * UI che mostra un singolo toast). I test e i caller avanzati possono
 * usare `schema.safeParse` direttamente per ottenere tutti gli issue.
 */
export function validate<T>(
  schema: z.ZodSchema<T>,
  input: unknown
):
  | { success: true; data: T }
  | { success: false; error: string } {
  const result = schema.safeParse(input);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const firstError = result.error.issues[0];
  return {
    success: false,
    error: firstError?.message ?? "Validazione fallita",
  };
}
