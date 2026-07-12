/**
 * Helper centralizzato per i test di integrazione API.
 * Fornisce utility per mockare auth/db ed eseguire le route handler
 * con utenti diversi (admin, volontario, referente) e stati di sessione
 * differenti.
 */
import { vi } from "vitest";

export type MockUser = {
  id: string;
  email: string;
  nomeCognome: string;
  ruolo: "volontario" | "referente_provinciale" | "referente_regionale" | "admin";
  provinciaId: number | null;
  regioneId: number | null;
  inizialiProtocollo: string | null;
  pec: string | null;
  emailOrdinaria: string | null;
  indirizzo: string | null;
  firma: string | null;
};

export const ADMIN: MockUser = {
  id: "admin-1", email: "admin@test.it", nomeCognome: "Admin",
  ruolo: "admin", provinciaId: null, regioneId: null,
  inizialiProtocollo: "AD", pec: null, emailOrdinaria: null,
  indirizzo: null, firma: null,
};

export const VOLONTARIO: MockUser = {
  id: "vol-1", email: "vol@test.it", nomeCognome: "Volontario",
  ruolo: "volontario", provinciaId: null, regioneId: null,
  inizialiProtocollo: "VL", pec: null, emailOrdinaria: null,
  indirizzo: null, firma: null,
};

export const REF_PROV: MockUser = {
  id: "ref-1", email: "ref@test.it", nomeCognome: "Referente",
  ruolo: "referente_provinciale", provinciaId: 5, regioneId: null,
  inizialiProtocollo: "RF", pec: null, emailOrdinaria: null,
  indirizzo: null, firma: null,
};
