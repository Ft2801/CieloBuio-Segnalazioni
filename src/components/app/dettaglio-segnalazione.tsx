"use client";

/**
 * Dettaglio di una segnalazione con:
 * - Visualizzazione completa dei dati
 * - Storico degli stati (audit trail)
 * - Azioni in base allo stato e al ruolo:
 *   * Volontario: invia in revisione, modifica bozza, elimina bozza
 *   * Referente: approva, rifiuta con nota, simula spedizione, invia PEC
 *   * Admin e referenti: cambia stato, limitatamente alle transizioni lecite
 *     dallo stato corrente
 * - Anteprima della lettera PEC in una nuova scheda
 * - Generazione di una nuova segnalazione collegata (recidiva)
 *
 * Le azioni irreversibili (invio PEC, eliminazione bozza) richiedono una
 * conferma esplicita in una finestra di dialogo dell'interfaccia.
 *
 * Autore: Fabio Tempera (2026)
 */

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  MapPin,
  User,
  FileText,
  Eye,
  Check,
  Minus,
  X,
  Send,
  FlaskConical,
  Trash2,
  History,
  AlertTriangle,
  Paperclip,
  RotateCcw,
} from "lucide-react";
import type { Segnalazione, SessionUser, StatoSegnalazione } from "@/lib/types";
import { STATI_SEGNALAZIONE, labelStato, coloreStato, puntoStato, labelRuolo, TRANSIZIONI_LECITE } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { StripaStato } from "./stripa-stato";
import { guardDemoReadOnly, isDemoSession } from "@/lib/demo-mode";
import { getDemoSegnalazione } from "@/lib/demo-data";
import { formatDataOra, nomeTerritorio, plurale } from "@/lib/format";

/** Messaggio unico per gli errori senza dettaglio dal server. */
const ERRORE_GENERICO = "Operazione non riuscita. Riprova tra qualche istante.";

type AzioneConferma = "invia-pec" | "elimina-bozza";

/** Riga di una checklist: il testo è letto per intero dagli screen reader (non "[X]"). */
function VoceChecklist({ attiva, children }: { attiva: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2">
      {attiva ? (
        <Check className="w-4 h-4 text-emerald-700 dark:text-emerald-300 flex-shrink-0" aria-hidden="true" />
      ) : (
        <Minus className="w-4 h-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
      )}
      <span>{children}</span>
      <span className="sr-only">{attiva ? "(selezionato)" : "(non selezionato)"}</span>
    </li>
  );
}

/** Coppia etichetta/valore delle schede informative. */
function Campo({ etichetta, children }: { etichetta: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-muted-foreground">{etichetta}</span> <span className="font-medium">{children}</span>
    </div>
  );
}

export function DettaglioSegnalazione({
  id,
  user,
  onBack,
  onApriModifica,
  onNuovaRecidiva,
  onAggiornata,
}: {
  id: string;
  user: SessionUser;
  onBack: () => void;
  onApriModifica: (id: string) => void;
  onNuovaRecidiva: (idPrecedente: string) => void;
  onAggiornata: () => void;
}) {
  const { toast } = useToast();
  const [segnalazione, setSegnalazione] = useState<Segnalazione | null>(null);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(false);
  const [dialogRifiuto, setDialogRifiuto] = useState(false);
  const [notaRifiuto, setNotaRifiuto] = useState("");
  const [dialogCambioStato, setDialogCambioStato] = useState(false);
  const [nuovoStato, setNuovoStato] = useState<StatoSegnalazione>("in_attesa");
  const [notaCambio, setNotaCambio] = useState("");
  const [azioneInCorso, setAzioneInCorso] = useState(false);
  const [conferma, setConferma] = useState<AzioneConferma | null>(null);

  const carica = useCallback(async () => {
    setCaricamento(true);
    setErrore(false);
    if (isDemoSession(user)) {
      setSegnalazione(getDemoSegnalazione(id));
      setCaricamento(false);
      return;
    }
    try {
      const res = await fetch(`/api/segnalazioni/${id}`);
      if (res.status === 404) {
        setSegnalazione(null);
      } else if (!res.ok) {
        setSegnalazione(null);
        setErrore(true);
      } else {
        const data = await res.json().catch(() => ({}));
        setSegnalazione(data.segnalazione ?? null);
      }
    } catch {
      setSegnalazione(null);
      setErrore(true);
    } finally {
      setCaricamento(false);
    }
  }, [id, user]);

  useEffect(() => {
    carica();
  }, [carica]);

  function mostraErrore(e: unknown) {
    toast({
      title: "Operazione non riuscita",
      description: e instanceof Error && e.message ? e.message : ERRORE_GENERICO,
      variant: "destructive",
    });
  }

  async function inviaInRevisione() {
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      await eseguiAzione(`/api/segnalazioni/${id}/cambia-stato`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stato: "in_revisione" }),
      });
      toast({ title: "Inviata in revisione", description: "Il referente territoriale riceverà la notifica." });
      await carica();
      onAggiornata();
    } catch (e) {
      mostraErrore(e);
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function approva() {
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      await eseguiAzione(`/api/segnalazioni/${id}/approva`, { method: "POST" });
      toast({
        title: "Segnalazione approvata",
        description: "Ora è possibile simulare la spedizione o inviare la PEC.",
      });
      await carica();
      onAggiornata();
    } catch (e) {
      mostraErrore(e);
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function confermaRifiuto() {
    if (!notaRifiuto.trim()) {
      toast({
        title: "Nota obbligatoria",
        description: "Scrivi il motivo del rifiuto per il volontario.",
        variant: "destructive",
      });
      return;
    }
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      await eseguiAzione(`/api/segnalazioni/${id}/rifiuta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nota: notaRifiuto }),
      });
      toast({
        title: "Segnalazione rifiutata",
        description: "La nota è disponibile nella pratica. La consegna dell'eventuale email non è garantita.",
      });
      setDialogRifiuto(false);
      setNotaRifiuto("");
      await carica();
      onAggiornata();
    } catch (e) {
      mostraErrore(e);
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function simulaSpedizione() {
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      const data = await eseguiAzione(`/api/segnalazioni/${id}/simula-pec`, { method: "POST" });
      const messaggio = typeof data.messaggio === "string" ? data.messaggio : "Simulazione completata";
      const protocollo =
        typeof data.numeroProtocollo === "string" ? `Protocollo previsionale: ${data.numeroProtocollo}` : null;
      toast({
        title: data.emailInviata ? "Anteprima inviata" : "Simulazione registrata",
        description: [messaggio, protocollo].filter(Boolean).join(". "),
      });
    } catch (e) {
      mostraErrore(e);
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function inviaPec() {
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      const data = await eseguiAzione(`/api/segnalazioni/${id}/invia-pec`, { method: "POST" });
      const destinatari = Array.isArray(data.destinatari) ? data.destinatari.join(", ") : "n/d";
      toast({
        title: "PEC inviata",
        description: `Protocollo ${typeof data.numeroProtocollo === "string" ? data.numeroProtocollo : "n/d"}. Destinatari: ${destinatari}.`,
      });
      await carica();
      onAggiornata();
    } catch (e) {
      mostraErrore(e);
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function cambiaStato() {
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      await eseguiAzione(`/api/segnalazioni/${id}/cambia-stato`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stato: nuovoStato, nota: notaCambio || null }),
      });
      toast({ title: "Stato aggiornato", description: `Nuovo stato: ${labelStato(nuovoStato)}.` });
      setDialogCambioStato(false);
      setNotaCambio("");
      await carica();
      onAggiornata();
    } catch (e) {
      mostraErrore(e);
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function eliminaBozza() {
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      await eseguiAzione(`/api/segnalazioni/${id}`, { method: "DELETE" });
      toast({ title: "Bozza eliminata" });
      onBack();
    } catch (e) {
      mostraErrore(e);
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function eseguiConferma() {
    const azione = conferma;
    setConferma(null);
    if (azione === "invia-pec") await inviaPec();
    if (azione === "elimina-bozza") await eliminaBozza();
  }

  if (caricamento) {
    return (
      <div className="flex items-center justify-center py-20" role="status">
        <div className="text-muted-foreground">Caricamento in corso…</div>
      </div>
    );
  }

  if (errore) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-start gap-1">
          <Button variant="ghost" size="sm" className="-ml-3" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Indietro
          </Button>
        </div>
        <Card className="border-rose-500/50 bg-rose-50 dark:bg-rose-950/50">
          <CardContent className="text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-rose-700 dark:text-rose-300 mb-3" aria-hidden="true" />
            <p className="font-medium text-rose-900 dark:text-rose-100 mb-1">Impossibile caricare la segnalazione</p>
            <p className="text-sm text-muted-foreground mb-4">Verifica la connessione e riprova.</p>
            <Button variant="outline" onClick={carica} className="gap-2">
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Riprova
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!segnalazione) {
    return (
      <div className="space-y-4">
        <div className="flex flex-col items-start gap-1">
          <Button variant="ghost" size="sm" className="-ml-3" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Indietro
          </Button>
        </div>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">Segnalazione non trovata.</CardContent>
        </Card>
      </div>
    );
  }

  const versioneVisualizzata = segnalazione.updatedAt;

  /** Esegue una richiesta di azione e mostra l'esito; lancia errore se il server rifiuta. */
  async function eseguiAzione(url: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
    const headers = new Headers(init.headers);
    headers.set("If-Match", JSON.stringify(versioneVisualizzata));
    const res = await fetch(url, { ...init, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : ERRORE_GENERICO);
    return data;
  }

  const isOwner = segnalazione.volontarioId === user.id;
  // Verifica competenza territoriale con check fail-closed (coerente con
  // hasTerritorialCompetence lato server): un referente senza territorio
  // assegnato non vede pulsanti di azione su segnalazioni.
  const isReviewer =
    user.ruolo === "admin" ||
    (user.ruolo === "referente_provinciale" &&
      user.provinciaId !== null &&
      segnalazione.provinciaId !== null &&
      segnalazione.provinciaId === user.provinciaId) ||
    (user.ruolo === "referente_regionale" &&
      user.regioneId !== null &&
      segnalazione.regioneId !== null &&
      segnalazione.regioneId === user.regioneId);
  const isReviewerOrAdmin = user.ruolo === "admin" || isReviewer;

  // In revisione le decisioni passano esclusivamente dai pulsanti Approva
  // e Rifiuta con nota: il cambio generico non deve eludere la nota
  // obbligatoria, la notifica e l'attribuzione del referente.
  const transizioniDisponibili =
    segnalazione.stato === "in_revisione" ? [] : (TRANSIZIONI_LECITE[segnalazione.stato] ?? []);
  // Il titolo è il luogo della pratica; il protocollo, o la condizione di bozza, sta sotto.
  const titolo = segnalazione.nomeEsercizio ?? segnalazione.indirizzoVia;
  const sottotitolo = [
    segnalazione.numeroProtocollo ? `Protocollo ${segnalazione.numeroProtocollo}` : "Bozza, non ancora inviata",
    segnalazione.nomeEsercizio ? segnalazione.indirizzoVia : null,
    segnalazione.comune?.nome ?? null,
  ]
    .filter(Boolean)
    .join(" · ");
  const isRecidiva = segnalazione.livelloRecidiva > 1;
  const allegati = segnalazione.allegati ?? [];
  const coordinate =
    segnalazione.latitudine != null && segnalazione.longitudine != null
      ? { lat: segnalazione.latitudine.toFixed(6), lon: segnalazione.longitudine.toFixed(6) }
      : null;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-start gap-3 justify-between">
        <div className="flex flex-col items-start gap-1 min-w-0">
          <Button variant="ghost" size="sm" className="-ml-3" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" aria-hidden="true" /> Indietro
          </Button>
          <h1 className="text-2xl font-bold tracking-tight break-words">{titolo}</h1>
          <p className="text-sm text-muted-foreground break-words">{sottotitolo}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-md text-sm font-medium ring-1 ring-inset ${coloreStato(segnalazione.stato)}`}
          >
            {labelStato(segnalazione.stato)}
          </span>
          {isRecidiva && <Badge variant="destructive">Recidiva livello {segnalazione.livelloRecidiva}</Badge>}
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <StripaStato stato={segnalazione.stato} />
        </CardContent>
      </Card>

      {segnalazione.notaRifiuto && (
        <Card className="border-rose-500/50 bg-rose-50 dark:bg-rose-950/50">
          <CardContent>
            <div className="flex items-start gap-2">
              <AlertTriangle
                className="w-5 h-5 text-rose-700 dark:text-rose-300 flex-shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div>
                <p className="font-medium text-rose-900 dark:text-rose-100">Rifiutata dal referente</p>
                <p className="text-sm mt-1 whitespace-pre-wrap">{segnalazione.notaRifiuto}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Azioni contestuali */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Azioni</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {/* Volontario su bozza */}
          {isOwner && segnalazione.stato === "bozza" && (
            <>
              <Button variant="outline" onClick={() => onApriModifica(segnalazione.id)}>
                <FileText className="w-4 h-4" aria-hidden="true" /> Modifica
              </Button>
              <Button onClick={inviaInRevisione} disabled={azioneInCorso}>
                <Send className="w-4 h-4" aria-hidden="true" /> Invia in revisione
              </Button>
              <Button variant="destructive" onClick={() => setConferma("elimina-bozza")} disabled={azioneInCorso}>
                <Trash2 className="w-4 h-4" aria-hidden="true" /> Elimina bozza
              </Button>
            </>
          )}

          {/* Referente su in_revisione */}
          {isReviewer && segnalazione.stato === "in_revisione" && (
            <>
              <Button variant="outline" onClick={() => onApriModifica(segnalazione.id)}>
                <FileText className="w-4 h-4" aria-hidden="true" /> Modifica
              </Button>
              <Button onClick={approva} disabled={azioneInCorso}>
                <Check className="w-4 h-4" aria-hidden="true" /> Approva
              </Button>
              <Button variant="destructive" onClick={() => setDialogRifiuto(true)} disabled={azioneInCorso}>
                <X className="w-4 h-4" aria-hidden="true" /> Rifiuta con nota
              </Button>
            </>
          )}

          {/* Approvata: simulazione + invio PEC (solo referenti/admin) */}
          {isReviewerOrAdmin && segnalazione.stato === "approvata" && (
            <>
              <Button variant="secondary" onClick={simulaSpedizione} disabled={azioneInCorso}>
                <FlaskConical className="w-4 h-4" aria-hidden="true" /> Simula spedizione
              </Button>
              <Button onClick={() => setConferma("invia-pec")} disabled={azioneInCorso}>
                <Send className="w-4 h-4" aria-hidden="true" /> Invia PEC
              </Button>
              <p className="text-xs text-muted-foreground w-full">
                La simulazione non contatta il Comune: verifica il testo e, se il servizio email è attivo, invia una
                copia al tuo indirizzo.
              </p>
            </>
          )}

          {/* Cambio stato manuale (admin/referente).
              Il pulsante compare solo se per lo stato corrente esistono transizioni
              lecite: gli stati terminali non mostrano l'azione. */}
          {isReviewerOrAdmin && transizioniDisponibili.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setNuovoStato(transizioniDisponibili[0] as StatoSegnalazione);
                setDialogCambioStato(true);
              }}
            >
              <History className="w-4 h-4" aria-hidden="true" /> Cambia stato
            </Button>
          )}

          {/* La POST della recidiva richiede il proprietario della pratica
              precedente e accetta anche una pratica chiusa positivamente. */}
          {isOwner && ["inviata", "in_attesa", "chiusa_positiva", "chiusa_negativa"].includes(segnalazione.stato) && (
            <Button variant="outline" onClick={() => onNuovaRecidiva(segnalazione.id)}>
              <AlertTriangle className="w-4 h-4" aria-hidden="true" /> Crea segnalazione collegata
            </Button>
          )}

          {/* Anteprima lettera (sempre disponibile dopo la bozza) */}
          {segnalazione.stato !== "bozza" && (
            <>
              <Button variant="outline" asChild>
                <a href={`/api/segnalazioni/${segnalazione.id}/lettera`} target="_blank" rel="noopener noreferrer">
                  <Eye className="w-4 h-4" aria-hidden="true" /> Anteprima lettera
                  <span className="sr-only">(si apre in una nuova scheda)</span>
                </a>
              </Button>
              {allegati.some((a) => a.tipo === "foto") && (
                <Button variant="outline" asChild>
                  <a
                    href={`/api/segnalazioni/${segnalazione.id}/lettera?with_attachments=1`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Eye className="w-4 h-4" aria-hidden="true" /> Lettera con allegati
                    <span className="sr-only">(si apre in una nuova scheda)</span>
                  </a>
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <MapPin className="w-4 h-4" aria-hidden="true" /> Luogo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Campo etichetta="Indirizzo:">{segnalazione.indirizzoVia}</Campo>
            <Campo etichetta="Comune:">
              {segnalazione.comune?.nome ?? "n/d"}
              {segnalazione.provincia ? ` (${segnalazione.provincia.sigla})` : ""}
            </Campo>
            <Campo etichetta="CAP:">{segnalazione.cap || "n/d"}</Campo>
            <Campo etichetta="Regione:">
              {segnalazione.regione ? nomeTerritorio(segnalazione.regione.regione) : "n/d"}
            </Campo>
            {segnalazione.nomeEsercizio && <Campo etichetta="Esercizio:">{segnalazione.nomeEsercizio}</Campo>}
            {coordinate && (
              <div>
                <span className="text-muted-foreground">Coordinate:</span>{" "}
                <a
                  href={`https://www.openstreetmap.org/?mlat=${coordinate.lat}&mlon=${coordinate.lon}#map=17/${coordinate.lat}/${coordinate.lon}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline underline-offset-2 hover:no-underline"
                >
                  {coordinate.lat}, {coordinate.lon}
                  <span className="sr-only"> (mappa in una nuova scheda)</span>
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-4 h-4" aria-hidden="true" /> Persone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Campo etichetta="Volontario segnalatore:">{segnalazione.volontario?.nomeCognome ?? "n/d"}</Campo>
            {segnalazione.referenteApprovatore && (
              <Campo etichetta="Approvata da:">{segnalazione.referenteApprovatore.nomeCognome}</Campo>
            )}
            <Campo etichetta="Destinatario:">
              {segnalazione.destinatarioNome ?? (
                <span className="font-medium text-amber-800 dark:text-amber-200">Da completare</span>
              )}
            </Campo>
            <Campo etichetta="Mittente visibile:">
              {segnalazione.mittenteVisibile ? "Sì, volontario" : "No, referente"}
            </Campo>
            {segnalazione.dataInvio && <Campo etichetta="Data invio:">{formatDataOra(segnalazione.dataInvio)}</Campo>}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tipologia non conformità</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="space-y-1">
              <VoceChecklist attiva={segnalazione.chkVetroPianoInclinato}>Vetro piano inclinato</VoceChecklist>
              <VoceChecklist attiva={segnalazione.chkVetroCurvo}>Vetro curvo o dispersione libera</VoceChecklist>
              {segnalazione.chkAltroTipologia && (
                <li>
                  <span className="text-muted-foreground">Altro:</span> {segnalazione.notaAltroTipologia}
                </li>
              )}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Problemi riscontrati</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <ul className="space-y-1">
              <VoceChecklist attiva={segnalazione.chkLuceVersoAlto}>Emissione di luce verso l&apos;alto</VoceChecklist>
              <VoceChecklist attiva={segnalazione.chkAbbagliamento}>Abbagliamento</VoceChecklist>
              <VoceChecklist attiva={segnalazione.chkLuceIntrusiva}>Luce intrusiva</VoceChecklist>
              {segnalazione.chkAltroProblema && (
                <li>
                  <span className="text-muted-foreground">Altro:</span> {segnalazione.notaAltroProblema}
                </li>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>

      {segnalazione.descrizioneLibera && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Descrizione</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{segnalazione.descrizioneLibera}</p>
          </CardContent>
        </Card>
      )}

      {allegati.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="w-4 h-4" aria-hidden="true" /> {plurale(allegati.length, "allegato", "allegati")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {allegati.map((a) => (
                <li key={a.id}>
                  <a
                    href={`/api/allegati/${a.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block p-3 border rounded-md hover:bg-accent/30 text-sm"
                  >
                    {a.tipo === "foto" ? (
                      <Image
                        src={`/api/allegati/${a.id}/preview`}
                        alt={`Anteprima di ${a.nomeOriginale}`}
                        width={320}
                        height={96}
                        unoptimized
                        className="w-full h-24 object-cover rounded mb-2"
                      />
                    ) : (
                      <FileText className="w-8 h-8 mx-auto mb-2" aria-hidden="true" />
                    )}
                    <div className="truncate text-xs">{a.nomeOriginale}</div>
                    <span className="sr-only">(si apre in una nuova scheda)</span>
                  </a>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Storico stati */}
      {segnalazione.storicoStati && segnalazione.storicoStati.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" aria-hidden="true" /> Storico degli stati
            </CardTitle>
            <CardDescription>Cronologia di tutte le variazioni di stato</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {segnalazione.storicoStati.map((st, idx, arr) => {
                const isLast = idx === arr.length - 1;
                return (
                  <li key={st.id} className="flex gap-3 text-sm">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-3 h-3 rounded-full mt-1 ${st.statoNuovo ? puntoStato(st.statoNuovo) : "bg-slate-500"}`}
                        aria-hidden="true"
                      />
                      {!isLast && <div className="w-px flex-1 bg-border my-1" aria-hidden="true" />}
                    </div>
                    <div className="pb-3">
                      <div className="font-medium">
                        {st.statoPrecedente ? `${labelStato(st.statoPrecedente)} → ` : ""}
                        {st.statoNuovo ? labelStato(st.statoNuovo) : "Evento di sistema"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {formatDataOra(st.timestamp)}, {st.user?.nomeCognome ?? "n/d"}
                        {st.user ? ` (${labelRuolo(st.user.ruolo)})` : ""}
                      </div>
                      {st.nota && <div className="text-xs mt-1 italic">{st.nota}</div>}
                    </div>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>
      )}

      {/* Conferma delle azioni irreversibili */}
      <Dialog open={conferma !== null} onOpenChange={(aperto) => !aperto && setConferma(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{conferma === "invia-pec" ? "Inviare la PEC al Comune?" : "Eliminare la bozza?"}</DialogTitle>
            <DialogDescription>
              {conferma === "invia-pec"
                ? "La PEC verrà inviata all'indirizzo del Comune e non potrà essere annullata."
                : "La bozza verrà eliminata definitivamente. L'operazione non può essere annullata."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConferma(null)}>
              Annulla
            </Button>
            <Button variant={conferma === "elimina-bozza" ? "destructive" : "default"} onClick={eseguiConferma}>
              {conferma === "invia-pec" ? "Invia PEC" : "Elimina bozza"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog rifiuto */}
      <Dialog open={dialogRifiuto} onOpenChange={setDialogRifiuto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rifiuta la segnalazione</DialogTitle>
            <DialogDescription>
              La segnalazione torna in bozza e il volontario riceve la tua nota. La nota è obbligatoria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="nota-rifiuto">Nota per il volontario</Label>
            <Textarea
              id="nota-rifiuto"
              rows={4}
              value={notaRifiuto}
              onChange={(e) => setNotaRifiuto(e.target.value)}
              placeholder="Esempio: mancano le foto dell'impianto. Caricarle e reinviare."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogRifiuto(false)}>
              Annulla
            </Button>
            <Button variant="destructive" onClick={confermaRifiuto} disabled={azioneInCorso}>
              Conferma rifiuto
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog cambio stato manuale */}
      <Dialog open={dialogCambioStato} onOpenChange={setDialogCambioStato}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cambia stato della segnalazione</DialogTitle>
            <DialogDescription>
              Operazione riservata a referenti e amministratori. Usala per registrare l&apos;esito dopo l&apos;invio
              della PEC: <strong>In attesa</strong> se non è ancora arrivata risposta,{" "}
              <strong>Chiusa con esito positivo</strong> se l&apos;impianto è stato adeguato,{" "}
              <strong>Chiusa con esito negativo</strong> se non c&apos;è stato adeguamento. In questo ultimo caso puoi
              creare una segnalazione collegata per recidiva.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="nuovo-stato">Nuovo stato</Label>
              <Select value={nuovoStato} onValueChange={(v) => setNuovoStato(v as StatoSegnalazione)}>
                <SelectTrigger id="nuovo-stato">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Solo le transizioni lecite per lo stato corrente: il server
                      le rifiuterebbe comunque con 400. */}
                  {STATI_SEGNALAZIONE.filter((s) => transizioniDisponibili.includes(s.value)).map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nota-cambio">Nota (facoltativa)</Label>
              <Textarea id="nota-cambio" rows={3} value={notaCambio} onChange={(e) => setNotaCambio(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogCambioStato(false)}>
              Annulla
            </Button>
            <Button onClick={cambiaStato} disabled={azioneInCorso}>
              Conferma
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
