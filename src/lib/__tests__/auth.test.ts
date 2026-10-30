/**
 * Test completi per src/lib/auth.ts (funzioni pure, no DB/cookies)
 */
import { describe, it, expect } from "vitest";
import {
  canViewAllSegnalazioni,
  canReviewSegnalazioni,
  canSendPec,
  canManageConfiguration,
  hasTerritorialCompetence,
  canViewSegnalazione,
  getVisibilityFilter,
  setSessionCookie,
  clearSessionCookie,
  type SessionUser,
} from "@/lib/auth";

const adminUser: SessionUser = {
  id: "admin-1",
  email: "admin@test.it",
  nomeCognome: "Admin Test",
  ruolo: "admin",
  provinciaId: null,
  regioneId: null,
  inizialiProtocollo: "AT",
  pec: null,
  emailOrdinaria: null,
  indirizzo: null,
  firma: null,
};

const volontarioUser: SessionUser = {
  id: "vol-1",
  email: "vol@test.it",
  nomeCognome: "Volontario Test",
  ruolo: "volontario",
  provinciaId: null,
  regioneId: null,
  inizialiProtocollo: "VT",
  pec: null,
  emailOrdinaria: null,
  indirizzo: null,
  firma: null,
};

const refProvincialeUser: SessionUser = {
  id: "ref-1",
  email: "ref@test.it",
  nomeCognome: "Referente Test",
  ruolo: "referente_provinciale",
  provinciaId: 5,
  regioneId: null,
  inizialiProtocollo: "RT",
  pec: null,
  emailOrdinaria: null,
  indirizzo: null,
  firma: null,
};

const refRegionaleUser: SessionUser = {
  id: "ref-2",
  email: "refr@test.it",
  nomeCognome: "Referente Regionale",
  ruolo: "referente_regionale",
  provinciaId: null,
  regioneId: 3,
  inizialiProtocollo: "RR",
  pec: null,
  emailOrdinaria: null,
  indirizzo: null,
  firma: null,
};

const refSenzaTerritorio: SessionUser = {
  id: "ref-3",
  email: "refnull@test.it",
  nomeCognome: "Referente Null",
  ruolo: "referente_provinciale",
  provinciaId: null,
  regioneId: null,
  inizialiProtocollo: "RN",
  pec: null,
  emailOrdinaria: null,
  indirizzo: null,
  firma: null,
};

const refRegionaleSenzaTerritorio: SessionUser = {
  id: "ref-4",
  email: "refrnull@test.it",
  nomeCognome: "Referente Reg Null",
  ruolo: "referente_regionale",
  provinciaId: null,
  regioneId: null,
  inizialiProtocollo: "RN",
  pec: null,
  emailOrdinaria: null,
  indirizzo: null,
  firma: null,
};

describe("canViewAllSegnalazioni", () => {
  it("solo admin", () => {
    expect(canViewAllSegnalazioni(adminUser)).toBe(true);
    expect(canViewAllSegnalazioni(refProvincialeUser)).toBe(false);
    expect(canViewAllSegnalazioni(volontarioUser)).toBe(false);
  });
});

describe("canReviewSegnalazioni", () => {
  it("admin e referenti possono revisionare", () => {
    expect(canReviewSegnalazioni(adminUser)).toBe(true);
    expect(canReviewSegnalazioni(refProvincialeUser)).toBe(true);
    expect(canReviewSegnalazioni(refRegionaleUser)).toBe(true);
  });
  it("volontario non può revisionare", () => {
    expect(canReviewSegnalazioni(volontarioUser)).toBe(false);
  });
});

describe("canSendPec", () => {
  it("admin e referenti possono inviare PEC", () => {
    expect(canSendPec(adminUser)).toBe(true);
    expect(canSendPec(refProvincialeUser)).toBe(true);
  });
  it("volontario non può inviare PEC", () => {
    expect(canSendPec(volontarioUser)).toBe(false);
  });
});

describe("canManageConfiguration", () => {
  it("solo admin", () => {
    expect(canManageConfiguration(adminUser)).toBe(true);
    expect(canManageConfiguration(refProvincialeUser)).toBe(false);
    expect(canManageConfiguration(volontarioUser)).toBe(false);
  });
});

describe("hasTerritorialCompetence", () => {
  const segnalazione = { provinciaId: 5, regioneId: 3 };

  it("admin ha competenza su tutto", () => {
    expect(hasTerritorialCompetence(adminUser, segnalazione)).toBe(true);
    expect(hasTerritorialCompetence(adminUser, { provinciaId: 99, regioneId: 99 })).toBe(true);
    expect(hasTerritorialCompetence(adminUser, { provinciaId: null, regioneId: null })).toBe(true);
  });

  it("ref provinciale con provinciaId matching", () => {
    expect(hasTerritorialCompetence(refProvincialeUser, segnalazione)).toBe(true);
  });

  it("ref provinciale con provinciaId NON matching", () => {
    expect(hasTerritorialCompetence(refProvincialeUser, { provinciaId: 99, regioneId: 3 })).toBe(false);
  });

  it("ref provinciale con segnalazione senza provincia", () => {
    expect(hasTerritorialCompetence(refProvincialeUser, { provinciaId: null, regioneId: 3 })).toBe(false);
  });

  it("ref provinciale SENZA territorio = fail-closed", () => {
    expect(hasTerritorialCompetence(refSenzaTerritorio, segnalazione)).toBe(false);
  });

  it("ref provinciale SENZA territorio su segnalazione senza provincia = fail-closed", () => {
    expect(hasTerritorialCompetence(refSenzaTerritorio, { provinciaId: null, regioneId: null })).toBe(false);
  });

  it("ref regionale con regioneId matching", () => {
    expect(hasTerritorialCompetence(refRegionaleUser, segnalazione)).toBe(true);
  });

  it("ref regionale con regioneId NON matching", () => {
    expect(hasTerritorialCompetence(refRegionaleUser, { provinciaId: 5, regioneId: 99 })).toBe(false);
  });

  it("ref regionale SENZA territorio = fail-closed", () => {
    expect(hasTerritorialCompetence(refRegionaleSenzaTerritorio, segnalazione)).toBe(false);
  });

  it("volontario non ha competenza territoriale", () => {
    expect(hasTerritorialCompetence(volontarioUser, segnalazione)).toBe(false);
  });
});

describe("canViewSegnalazione", () => {
  const segnalazione = {
    volontarioId: "vol-1",
    provinciaId: 5,
    regioneId: 3,
  };

  it("admin vede tutto", () => {
    expect(canViewSegnalazione(adminUser, segnalazione)).toBe(true);
    expect(canViewSegnalazione(adminUser, { ...segnalazione, volontarioId: "other" })).toBe(true);
  });

  it("volontario vede le proprie", () => {
    expect(canViewSegnalazione(volontarioUser, segnalazione)).toBe(true);
  });

  it("volontario NON vede quelle di altri", () => {
    expect(canViewSegnalazione(volontarioUser, { ...segnalazione, volontarioId: "other" })).toBe(false);
  });

  it("ref provinciale con provincia matching", () => {
    expect(canViewSegnalazione(refProvincialeUser, segnalazione)).toBe(true);
  });

  it("ref provinciale con provincia NON matching", () => {
    expect(canViewSegnalazione(refProvincialeUser, { ...segnalazione, provinciaId: 99 })).toBe(false);
  });

  it("ref provinciale SENZA territorio = fail-closed", () => {
    expect(canViewSegnalazione(refSenzaTerritorio, segnalazione)).toBe(false);
  });

  it("ref regionale con regione matching", () => {
    expect(canViewSegnalazione(refRegionaleUser, segnalazione)).toBe(true);
  });

  it("ref regionale con regione NON matching", () => {
    expect(canViewSegnalazione(refRegionaleUser, { ...segnalazione, regioneId: 99 })).toBe(false);
  });

  it("ref regionale SENZA territorio = fail-closed", () => {
    expect(canViewSegnalazione(refRegionaleSenzaTerritorio, segnalazione)).toBe(false);
  });
});

describe("getVisibilityFilter", () => {
  it("admin: filtro vuoto (vede tutto)", () => {
    expect(getVisibilityFilter(adminUser)).toEqual({});
  });

  it("volontario: filtro per proprio id", () => {
    expect(getVisibilityFilter(volontarioUser)).toEqual({ volontarioId: "vol-1" });
  });

  it("ref provinciale con territorio: filtro per provinciaId", () => {
    expect(getVisibilityFilter(refProvincialeUser)).toEqual({ provinciaId: 5 });
  });

  it("ref provinciale SENZA territorio: filtro sentinella", () => {
    const filter = getVisibilityFilter(refSenzaTerritorio);
    expect(filter).toEqual({ id: "__NEVER_MATCH__" });
  });

  it("ref regionale con territorio: filtro per regioneId", () => {
    expect(getVisibilityFilter(refRegionaleUser)).toEqual({ regioneId: 3 });
  });

  it("ref regionale SENZA territorio: filtro sentinella", () => {
    const filter = getVisibilityFilter(refRegionaleSenzaTerritorio);
    expect(filter).toEqual({ id: "__NEVER_MATCH__" });
  });
});

describe("Session cookie helpers", () => {
  it("setSessionCookie contiene HttpOnly e SameSite=Strict", () => {
    const cookie = setSessionCookie("test-token");
    expect(cookie).toContain("cb_session=test-token");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Expires=");
    expect(cookie).toContain("Max-Age=");
  });

  it("clearSessionCookie contiene Max-Age=0", () => {
    const cookie = clearSessionCookie();
    expect(cookie).toContain("cb_session=");
    expect(cookie).toContain("Max-Age=0");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
  });
});
