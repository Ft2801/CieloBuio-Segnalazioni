/**
 * API: POST /api/auth/2fa
 *
 * Setup, verifica e disabilitazione del 2FA TOTP (RFC 6238) per gli
 * utenti che vogliono abilitare l'autenticazione a due fattori sul
 * proprio account.
 *
 * Flusso:
 *  1. { action: "setup" } -> genera un nuovo secret TOTP, lo salva in
 *     DB (User.totpSecret) MA NON lo attiva ancora. totpVerifiedAt resta
 *     null finché l'utente non completa verify. Ritorna secret Base32 e
 *     URL otpauth:// per il QR code.
 *
 *     IMPORTANTE: il 2FA NON è attivo dopo setup. Se l'utente chiude
 *     la pagina senza completare verify, al prossimo login NON gli
 *     verrà richiesto il codice TOTP (perché totpVerifiedAt è null).
 *     Questo previene il lockout accidentale dell'account.
 *
 *     Sicurezza: se l'utente ha GIÀ un 2FA attivo (totpVerifiedAt non
 *     null), setup richiede il codice TOTP corrente nel body
 *     ({ currentToken: "123456" }) per confermare l'identità, prima
 *     di sovrascrivere il secret. Questo previene che un attaccante
 *     con sessione rubata possa "silenziosamente disarmare" il 2FA
 *     rigenerando il secret senza conoscere il vecchio codice.
 *
 *  2. { action: "verify", token: "123456" } -> verifica un codice TOTP
 *     per confermare che l'utente abbia configurato correttamente
 *     l'app TOTP. Se valido, imposta totpVerifiedAt = now() e il 2FA
 *     diventa effettivamente attivo dal prossimo login.
 *
 *  3. { action: "disable", token: "123456" } -> disabilita il 2FA
 *     (richiede codice TOTP valido come anti-abuse, per prevenire che
 *     un attaccante con sessione temporanea rimuova il 2FA senza
 *     possedere il dispositivo dell'utente). Azzera sia totpSecret
 *     che totpVerifiedAt.
 *
 * Autore: Fabio Tempera (2026)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotpWithDelta,
  computeTotpTimestep,
} from "@/lib/totp";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autenticato" }, { status: 401 });
  }

  // Rate limit: 5 operazioni 2FA/ora per utente (prevenire abuso di
  // generazione secret o brute force sul token di verifica).
  const rl = checkRateLimit(`2fa:${user.id}`, 5, 60 * 60 * 1000, 60 * 60 * 1000, 60 * 60 * 1000);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Troppe richieste 2FA. Riprova tra ${Math.ceil(rl.retryAfterSeconds / 60)} minuti.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const action = typeof body.action === "string" ? body.action : "";

  if (action === "setup") {
    // Verifica se l'utente ha GIÀ un 2FA attivo (totpVerifiedAt non null).
    // In tal caso, per rigenerare il secret richiediamo il codice TOTP
    // corrente (anti-abuse: previene che un attaccante con sessione rubata
    // possa disarmare il 2FA senza conoscere il vecchio codice).
    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { totpSecret: true, totpVerifiedAt: true, totpLastUsedTimestep: true },
    });
    if (dbUser?.totpVerifiedAt && dbUser.totpSecret) {
      const currentToken = typeof body.currentToken === "string" ? body.currentToken.trim() : "";
      if (!/^\d{6}$/.test(currentToken)) {
        return NextResponse.json(
          { error: "Per rigenerare il secret TOTP è richiesto il codice TOTP corrente (campo currentToken, 6 cifre)" },
          { status: 400 }
        );
      }
      // Anti-replay: usa verifyTotpWithDelta + timestep check, coerente
      // con il login. Previene riuso di un codice già utilizzato per il
      // login entro la finestra di validità di 30 secondi.
      const result = verifyTotpWithDelta(currentToken, dbUser.totpSecret);
      if (!result.valid) {
        return NextResponse.json(
          { error: "Codice TOTP corrente non valido" },
          { status: 400 }
        );
      }
      const timestep = computeTotpTimestep(new Date(), result.delta);
      if (
        dbUser.totpLastUsedTimestep !== null &&
        timestep <= dbUser.totpLastUsedTimestep
      ) {
        return NextResponse.json(
          { error: "Codice TOTP già utilizzato. Attendi un nuovo codice dalla tua app." },
          { status: 400 }
        );
      }
      // Aggiorna totpLastUsedTimestep per marcare questo codice come usato.
      await db.user.update({
        where: { id: user.id },
        data: { totpLastUsedTimestep: timestep },
      });
    }

    // Genera nuovo secret. Il parametro email NON è usato dal generatore
    // (vedi commento in totp.ts), ma è richiesto per generare l'URL
    // otpauth:// che include l'email come label (utile nel display della
    // app TOTP dell'utente).
    const secret = generateTotpSecret(user.email);
    const uri = generateTotpUri(user.email, secret);

    // Salva il secret MA NON totpVerifiedAt: il 2FA non è ancora attivo.
    // Sarà attivato solo dopo che l'utente completerà verify con successo.
    await db.user.update({
      where: { id: user.id },
      data: {
        totpSecret: secret,
        totpVerifiedAt: null,
      },
    });

    logger.info({ userId: user.id }, "Setup 2FA iniziato (secret generato, non ancora verificato)");
    return NextResponse.json({
      secret,
      otpauthUri: uri,
      message:
        "Secret TOTP generato. Aggiungi l'account alla tua app TOTP " +
        "(Google Authenticator, Authy, 1Password) scansionando il QR code " +
        "dall'URL otpauthUri. Il 2FA sarà attivo solo dopo aver verificato " +
        "un codice con l'azione 'verify'.",
    });
  }

  if (action === "verify") {
    // Verifica un codice TOTP. Se valido, il 2FA è considerato attivo
    // (totpVerifiedAt impostato a now()).
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!/^\d{6}$/.test(token)) {
      return NextResponse.json(
        { error: "Token non valido (deve essere 6 cifre)" },
        { status: 400 }
      );
    }

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { totpSecret: true, totpVerifiedAt: true, totpLastUsedTimestep: true },
    });
    if (!dbUser || !dbUser.totpSecret) {
      return NextResponse.json(
        { error: "Nessun secret TOTP configurato. Esegui prima setup." },
        { status: 400 }
      );
    }

    // Verifica anti-replay coerente con il login e con i rami setup/disable:
    // usa verifyTotpWithDelta + check sul timestep, così un codice già usato
    // per il login non può essere riutilizzato per confermare la verify.
    const result = verifyTotpWithDelta(token, dbUser.totpSecret);
    if (!result.valid) {
      return NextResponse.json(
        { error: "Token TOTP non valido" },
        { status: 400 }
      );
    }
    const timestep = computeTotpTimestep(new Date(), result.delta);
    if (
      dbUser.totpLastUsedTimestep !== null &&
      timestep <= dbUser.totpLastUsedTimestep
    ) {
      return NextResponse.json(
        { error: "Codice TOTP già utilizzato. Attendi un nuovo codice dalla tua app." },
        { status: 400 }
      );
    }

    // Marca il 2FA come verificato: da ora il login richiederà il codice.
    // Aggiorna anche totpLastUsedTimestep per marcare questo codice come usato.
    await db.user.update({
      where: { id: user.id },
      data: { totpVerifiedAt: new Date(), totpLastUsedTimestep: timestep },
    });

    logger.info({ userId: user.id }, "2FA verificato e attivato (totpVerifiedAt impostato)");
    return NextResponse.json({
      ok: true,
      message: "Token TOTP verificato. Il 2FA è ora attivo e sarà richiesto al prossimo login.",
    });
  }

  if (action === "disable") {
    // Disabilita il 2FA. Richiede codice TOTP valido come anti-abuse
    // (previene che un attaccante con sessione temporanea rimuova il 2FA).
    const token = typeof body.token === "string" ? body.token.trim() : "";
    if (!/^\d{6}$/.test(token)) {
      return NextResponse.json(
        { error: "Token non valido (deve essere 6 cifre)" },
        { status: 400 }
      );
    }

    const dbUser = await db.user.findUnique({
      where: { id: user.id },
      select: { totpSecret: true, totpVerifiedAt: true, totpLastUsedTimestep: true },
    });
    if (!dbUser || !dbUser.totpSecret) {
      return NextResponse.json(
        { error: "2FA non è configurato su questo account" },
        { status: 400 }
      );
    }

    // Se il 2FA è attivo (verifiedAt), richiedi il token valido.
    // Se è in stato "setup ma non verificato", permetti la disabilitazione
    // senza token (permette all'utente di annullare un setup incompleto).
    if (dbUser.totpVerifiedAt) {
      // Anti-replay: usa verifyTotpWithDelta + timestep check, coerente
      // con il login e il setup. Previene che un attaccante con sessione
      // rubata e un codice TOTP intercettato riesca a disarmare il 2FA.
      const result = verifyTotpWithDelta(token, dbUser.totpSecret);
      if (!result.valid) {
        return NextResponse.json(
          { error: "Token TOTP non valido" },
          { status: 400 }
        );
      }
      const timestep = computeTotpTimestep(new Date(), result.delta);
      if (
        dbUser.totpLastUsedTimestep !== null &&
        timestep <= dbUser.totpLastUsedTimestep
      ) {
        return NextResponse.json(
          { error: "Codice TOTP già utilizzato. Attendi un nuovo codice dalla tua app." },
          { status: 400 }
        );
      }
      // Aggiorna totpLastUsedTimestep PRIMA di azzerare il secret: così,
      // se l'update dell'azzeramento fallisce, il codice resta marcato
      // come usato e un eventuale retry non può riutilizzarlo.
      await db.user.update({
        where: { id: user.id },
        data: { totpLastUsedTimestep: timestep },
      });
    }

    await db.user.update({
      where: { id: user.id },
      data: {
        totpSecret: null,
        totpVerifiedAt: null,
        totpLastUsedTimestep: null,
      },
    });

    logger.info({ userId: user.id }, "2FA disabilitato (totpSecret e totpVerifiedAt azzerati)");
    return NextResponse.json({
      ok: true,
      message: "2FA disabilitato.",
    });
  }

  return NextResponse.json(
    { error: "Azione non valida. Valori ammessi: setup, verify, disable" },
    { status: 400 }
  );
}
