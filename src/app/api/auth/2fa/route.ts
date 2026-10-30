/**
 * API: POST /api/auth/2fa
 *
 * Setup, verifica e disabilitazione del 2FA TOTP (RFC 6238).
 *
 * Al primo setup il secret viene salvato, ma il login non richiede ancora
 * il codice: la verifica attiva il fattore senza bloccare chi non termina
 * la configurazione. Durante una rotazione il vecchio secret verificato
 * resta attivo e il nuovo resta separato fino alla conferma. Chiudere la
 * pagina prima della verifica non disattiva mai un 2FA già attivo.
 *
 * setup con 2FA attivo richiede currentToken del vecchio dispositivo.
 * verify accetta il codice del secret nuovo e attiva il primo fattore o
 * sostituisce atomicamente quello precedente. disable richiede il codice
 * corrente solo se il fattore era già attivo.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { generateTotpSecret, generateTotpUri, verifyTotpWithDelta, computeTotpTimestep } from "@/lib/totp";
import { registraTimestepTotp } from "@/lib/totp-replay";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";
import { leggiBodyOggetto } from "@/lib/http";

const MSG_GIA_USATO = "Codice TOTP già utilizzato o configurazione cambiata. Attendi un nuovo codice dalla tua app.";
const MSG_CONFIG_CAMBIATA = "La configurazione 2FA è cambiata nel frattempo. Ricarica la pagina e riprova.";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  // Rate limit per utente: limita anche i tentativi di indovinare un codice.
  const rl = checkRateLimit(`2fa:${user.id}`, 5, 60 * 60 * 1000, 60 * 60 * 1000, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Troppe richieste 2FA. Riprova tra ${Math.ceil(rl.retryAfterSeconds / 60)} minuti.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
    );
  }

  const body = (await leggiBodyOggetto(req)) ?? {};
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "setup") {
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { totpSecret: true, totpVerifiedAt: true },
    });
    const secretAttivo = dbUser?.totpVerifiedAt ? dbUser.totpSecret : null;
    if (secretAttivo) {
      const currentToken = typeof body.currentToken === "string" ? body.currentToken.trim() : "";
      if (!/^\d{6}$/.test(currentToken)) {
        return NextResponse.json(
          { error: "Per rigenerare il secret TOTP è richiesto il codice TOTP corrente (campo currentToken, 6 cifre)" },
          { status: 400 },
        );
      }
      // Dopo il check del codice, la registrazione deve verificare anche che
      // il secret già attivo non sia cambiato in una richiesta concorrente.
      const istanteVerifica = new Date();
      const result = verifyTotpWithDelta(currentToken, secretAttivo, istanteVerifica.getTime());
      if (!result.valid) {
        return NextResponse.json({ error: "Codice TOTP corrente non valido" }, { status: 400 });
      }
      const timestep = computeTotpTimestep(istanteVerifica, result.delta);
      if (!(await registraTimestepTotp(user.id, timestep, secretAttivo))) {
        return NextResponse.json({ error: MSG_GIA_USATO }, { status: 400 });
      }
    }

    const secret = generateTotpSecret(user.email);
    const uri = generateTotpUri(user.email, secret);
    // La clausola condizionale evita che un setup avviato prima di una
    // rotazione o disattivazione sovrascriva il nuovo stato. Il nuovo secret
    // non va mai restituito se il database non lo ha memorizzato.
    const salvato = secretAttivo
      ? await db.user.updateMany({
          where: { id: user.id, totpSecret: secretAttivo, totpVerifiedAt: { not: null } },
          data: { totpPendingSecret: secret },
        })
      : await db.user.updateMany({
          where: { id: user.id, totpVerifiedAt: null },
          data: {
            totpSecret: secret,
            totpPendingSecret: null,
            totpVerifiedAt: null,
            totpLastUsedTimestep: null,
          },
        });
    if (salvato.count === 1) {
      logger.info({ userId: user.id }, "Setup 2FA iniziato (in attesa della verifica)");
      return NextResponse.json(
        {
          secret,
          otpauthUri: uri,
          message:
            "Secret TOTP generato. Aggiungi l'account alla tua app TOTP usando otpauthUri. " +
            "Conferma il nuovo codice con l'azione 'verify'. Se il 2FA era già attivo, " +
            "il vecchio dispositivo resta valido fino alla conferma.",
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    } else {
      return NextResponse.json({ error: MSG_CONFIG_CAMBIATA }, { status: 409 });
    }
  }

  if (action === "verify") {
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!/^\d{6}$/.test(token)) {
      return NextResponse.json({ error: "Token non valido (deve essere 6 cifre)" }, { status: 400 });
    }

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { totpSecret: true, totpPendingSecret: true, totpVerifiedAt: true },
    });
    // Con il fattore attivo si verifica solo il nuovo secret in attesa.
    // Riutilizzare un codice del vecchio fattore non può confermare il setup.
    const inRotazione = Boolean(dbUser?.totpVerifiedAt);
    const secretAttivo = dbUser?.totpSecret;
    const secretDaVerificare = inRotazione ? dbUser?.totpPendingSecret : secretAttivo;
    if (!secretDaVerificare) {
      return NextResponse.json({ error: "Nessun secret TOTP da verificare. Esegui prima setup." }, { status: 400 });
    }
    if (inRotazione && !secretAttivo) {
      // Stato incongruente nel DB: non promuovere un secret pendente in
      // assenza di un fattore attivo verificabile.
      return NextResponse.json({ error: MSG_CONFIG_CAMBIATA }, { status: 409 });
    }

    const istanteVerifica = new Date();
    const result = verifyTotpWithDelta(token, secretDaVerificare, istanteVerifica.getTime());
    if (!result.valid) {
      return NextResponse.json({ error: "Token TOTP non valido" }, { status: 400 });
    }
    const timestep = computeTotpTimestep(istanteVerifica, result.delta);
    const verificato =
      inRotazione && secretAttivo
        ? await db.user.updateMany({
            where: {
              id: user.id,
              totpSecret: secretAttivo,
              totpPendingSecret: secretDaVerificare,
              totpVerifiedAt: { not: null },
            },
            data: {
              totpSecret: secretDaVerificare,
              totpPendingSecret: null,
              totpVerifiedAt: new Date(),
              totpLastUsedTimestep: timestep,
            },
          })
        : await db.user.updateMany({
            where: {
              id: user.id,
              totpSecret: secretDaVerificare,
              totpVerifiedAt: null,
              OR: [{ totpLastUsedTimestep: null }, { totpLastUsedTimestep: { lt: timestep } }],
            },
            data: { totpVerifiedAt: new Date(), totpLastUsedTimestep: timestep },
          });
    if (verificato.count !== 1) {
      return NextResponse.json({ error: MSG_GIA_USATO }, { status: 400 });
    }

    logger.info({ userId: user.id }, "2FA verificato e attivato");
    return NextResponse.json({ ok: true, message: "Token TOTP verificato. Il 2FA è ora attivo." });
  }

  if (action === "disable") {
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { totpSecret: true, totpVerifiedAt: true },
    });
    if (!dbUser?.totpSecret) {
      return NextResponse.json({ error: "2FA non è configurato su questo account" }, { status: 400 });
    }

    // Un primo setup non completato si può annullare senza conoscere un
    // codice che l'utente potrebbe non aver ancora configurato nell'app.
    if (dbUser.totpVerifiedAt) {
      const token = typeof body.token === "string" ? body.token.trim() : "";
      if (!/^\d{6}$/.test(token)) {
        return NextResponse.json({ error: "Token non valido (deve essere 6 cifre)" }, { status: 400 });
      }
      const istanteVerifica = new Date();
      const result = verifyTotpWithDelta(token, dbUser.totpSecret, istanteVerifica.getTime());
      if (!result.valid) {
        return NextResponse.json({ error: "Token TOTP non valido" }, { status: 400 });
      }
      const timestep = computeTotpTimestep(istanteVerifica, result.delta);
      if (!(await registraTimestepTotp(user.id, timestep, dbUser.totpSecret))) {
        return NextResponse.json({ error: MSG_GIA_USATO }, { status: 400 });
      }
    }

    const disattivato = await db.user.updateMany({
      where: {
        id: user.id,
        totpSecret: dbUser.totpSecret,
        totpVerifiedAt: dbUser.totpVerifiedAt ? { not: null } : null,
      },
      data: {
        totpSecret: null,
        totpPendingSecret: null,
        totpVerifiedAt: null,
        totpLastUsedTimestep: null,
      },
    });
    if (disattivato.count !== 1) {
      return NextResponse.json({ error: MSG_CONFIG_CAMBIATA }, { status: 409 });
    }

    logger.info({ userId: user.id }, "2FA disabilitato");
    return NextResponse.json({ ok: true, message: "2FA disabilitato." });
  }

  return NextResponse.json({ error: "Azione non valida. Valori ammessi: setup, verify, disable" }, { status: 400 });
}
