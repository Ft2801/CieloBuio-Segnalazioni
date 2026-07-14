"use client";

/**
 * Dettaglio di una segnalazione con:
 * - Visualizzazione completa dei dati
 * - Storico degli stati (audit trail)
 * - Azioni in base allo stato e al ruolo:
 *   * Volontario: invia in revisione, modifica bozza, elimina bozza
 *   * Referente: approva, rifiuta con nota, simula invio, invia PEC
 *   * Admin: cambia stato in qualsiasi momento
 * - Anteprima lettera PEC in una nuova scheda
 * - Generazione nuova segnalazione collegata (recidiva)
 *
 * Autore: Fabio Tempera (2026)
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Calendar,
  User,
  FileText,
  Eye,
  Check,
  X,
  Send,
  FlaskConical,
  Trash2,
  History,
  AlertTriangle,
  Paperclip,
} from "lucide-react";
import type { Segnalazione, SessionUser, StatoSegnalazione } from "@/lib/types";
import { STATI_SEGNALAZIONE, labelStato, coloreStato, labelRuolo, TRANSIZIONI_LECITE } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { guardDemoReadOnly, isDemoSession } from "@/lib/demo-mode";
import { getDemoSegnalazione } from "@/lib/demo-data";

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
  const [dialogRifiuto, setDialogRifiuto] = useState(false);
  const [notaRifiuto, setNotaRifiuto] = useState("");
  const [dialogCambioStato, setDialogCambioStato] = useState(false);
  const [nuovoStato, setNuovoStato] = useState<StatoSegnalazione>("in_attesa");
  const [notaCambio, setNotaCambio] = useState("");
  const [azioneInCorso, setAzioneInCorso] = useState(false);

  async function carica() {
    setCaricamento(true);
    if (isDemoSession(user)) {
      setSegnalazione(getDemoSegnalazione(id));
      setCaricamento(false);
      return;
    }
    try {
      const res = await fetch(`/api/segnalazioni/${id}`);
      const data = await res.json().catch(() => ({}));
      setSegnalazione(data.segnalazione ?? null);
    } catch {
      setSegnalazione(null);
    } finally {
      setCaricamento(false);
    }
  }

  useEffect(() => {
    carica();
    // Dipendenza solo su id: carica cattura user dal closure ma user.id
    // è stabile nella sessione. Se user cambia ruolo (es. aggiornamento
    // dei permessi), è sufficiente navigare via e tornare per rieseguire
    // il caricamento. eslint-disable per evitare warning.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function inviaInRevisione() {
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      const res = await fetch(`/api/segnalazioni/${id}/cambia-stato`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stato: "in_revisione" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Errore sconosciuto");
      toast({ title: "Inviata in revisione", description: "Il referente territoriale riceverà la notifica" });
      await carica();
      onAggiornata();
    } catch (e) {
      toast({ title: "Errore", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function approva() {
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      const res = await fetch(`/api/segnalazioni/${id}/approva`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Errore sconosciuto");
      toast({ title: "Approvata", description: "Ora puoi procedere con simulazione e invio PEC" });
      await carica();
      onAggiornata();
    } catch (e) {
      toast({ title: "Errore", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function confermaRifiuto() {
    if (!notaRifiuto.trim()) {
      toast({ title: "Nota obbligatoria", variant: "destructive" });
      return;
    }
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      const res = await fetch(`/api/segnalazioni/${id}/rifiuta`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nota: notaRifiuto }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Errore sconosciuto");
      toast({ title: "Rifiutata", description: "La segnalazione è tornata al volontario con la tua nota" });
      setDialogRifiuto(false);
      setNotaRifiuto("");
      await carica();
      onAggiornata();
    } catch (e) {
      toast({ title: "Errore", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function simulaPec() {
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      const res = await fetch(`/api/segnalazioni/${id}/simula-pec`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Errore sconosciuto");
      toast({
        title: data.emailInviata ? "Simulazione inviata" : "Simulazione registrata",
        description: `${data.messaggio}. Protocollo: ${data.numeroProtocollo}`,
        duration: 6000,
      });
    } catch (e) {
      toast({ title: "Errore", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function inviaPecReale() {
    if (!confirm("Confermi l'invio reale della PEC al Comune? L'azione non è reversibile.")) return;
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      const res = await fetch(`/api/segnalazioni/${id}/invia-pec`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Errore sconosciuto");
      const destinatari = Array.isArray(data.destinatari) ? data.destinatari.join(", ") : "n/d";
      toast({
        title: "PEC inviata",
        description: `Protocollo ${data.numeroProtocollo ?? "n/d"}. Destinatari: ${destinatari}`,
      });
      await carica();
      onAggiornata();
    } catch (e) {
      toast({ title: "Errore", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function cambiaStato() {
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      const res = await fetch(`/api/segnalazioni/${id}/cambia-stato`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stato: nuovoStato, nota: notaCambio || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Errore sconosciuto");
      toast({ title: "Stato aggiornato", description: `Nuovo stato: ${labelStato(nuovoStato)}` });
      setDialogCambioStato(false);
      setNotaCambio("");
      await carica();
      onAggiornata();
    } catch (e) {
      toast({ title: "Errore", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setAzioneInCorso(false);
    }
  }

  async function eliminaBozza() {
    if (!confirm("Eliminare definitivamente questa bozza?")) return;
    setAzioneInCorso(true);
    try {
      guardDemoReadOnly(user);
      const res = await fetch(`/api/segnalazioni/${id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Errore sconosciuto");
      toast({ title: "Bozza eliminata" });
      onBack();
    } catch (e) {
      toast({ title: "Errore", description: e instanceof Error ? e.message : "", variant: "destructive" });
    } finally {
      setAzioneInCorso(false);
    }
  }

  if (caricamento) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-muted-foreground">Caricamento…</div>
      </div>
    );
  }

  if (!segnalazione) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Indietro
        </Button>
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Segnalazione non trovata
          </CardContent>
        </Card>
      </div>
    );
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

  const puoModificare =
    (isOwner && segnalazione.stato === "bozza") ||
    (isReviewer && ["bozza", "in_revisione"].includes(segnalazione.stato));

  // Transizioni di stato lecite per lo stato corrente. Calcolate una
  // sola volta per render (invece di duplicare la lookup sia nel
  // controllo di visibilità sia nell'onClick): il ramo difensivo `?? []`
  // viene valutato una sola volta ed è coperto dai test che renderizzano
  // il componente con stati non standard.
  const transizioniDisponibili = TRANSIZIONI_LECITE[segnalazione.stato] ?? [];

  // Estratto in variabile per garantire tracciabilità del branch di
  // coverage `?? "Bozza senza protocollo"` da parte di v8 (le
  // espressioni JSX inline a volte non vengono rilevate correttamente
  // dallo strumento di coverage).
  const titoloProtocollo = segnalazione.numeroProtocollo ?? "Bozza senza protocollo";
  const classeStato = coloreStato(segnalazione.stato);
  const etichettaStato = labelStato(segnalazione.stato);
  const isRecidiva = segnalazione.livelloRecidiva > 1;

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Indietro
          </Button>
          <h1 className="text-2xl font-bold">
            {titoloProtocollo}
          </h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={`inline-flex items-center px-3 py-1 rounded text-sm font-medium text-white ${classeStato}`}
          >
            {etichettaStato}
          </span>
          {isRecidiva && (
            <Badge variant="destructive">
              Recidiva livello {segnalazione.livelloRecidiva}
            </Badge>
          )}
        </div>
      </div>

      {segnalazione.notaRifiuto && (
        <Card className="border-rose-500/40 bg-rose-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-5 h-5 text-rose-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-rose-200">Rifiutata dal referente</p>
                <p className="text-sm mt-1">{segnalazione.notaRifiuto}</p>
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
              <Button onClick={() => onApriModifica(segnalazione.id)}>
                <FileText className="w-4 h-4 mr-1" /> Modifica
              </Button>
              <Button onClick={inviaInRevisione} disabled={azioneInCorso}>
                <Send className="w-4 h-4 mr-1" /> Invia in revisione
              </Button>
              <Button variant="destructive" onClick={eliminaBozza} disabled={azioneInCorso}>
                <Trash2 className="w-4 h-4 mr-1" /> Elimina bozza
              </Button>
            </>
          )}

          {/* Referente su in_revisione */}
          {isReviewer && segnalazione.stato === "in_revisione" && (
            <>
              <Button onClick={() => onApriModifica(segnalazione.id)}>
                <FileText className="w-4 h-4 mr-1" /> Modifica
              </Button>
              <Button onClick={approva} disabled={azioneInCorso}>
                <Check className="w-4 h-4 mr-1" /> Approva
              </Button>
              <Button variant="destructive" onClick={() => setDialogRifiuto(true)}>
                <X className="w-4 h-4 mr-1" /> Rifiuta con nota
              </Button>
            </>
          )}

          {/* Approvata: simula + invia PEC (solo referenti/admin) */}
          {isReviewerOrAdmin && segnalazione.stato === "approvata" && (
            <>
              <Button variant="secondary" onClick={simulaPec} disabled={azioneInCorso}>
                <FlaskConical className="w-4 h-4 mr-1" /> Simula spedizione
              </Button>
              <Button onClick={inviaPecReale} disabled={azioneInCorso}>
                <Send className="w-4 h-4 mr-1" /> Invia PEC
              </Button>
              <p className="text-xs text-muted-foreground w-full mt-1">
                La simulazione invia una PEC di prova solo al mittente. In modalità demo (SMTP non configurato) viene registrata senza inviare email.
              </p>
            </>
          )}

          {/* Cambio stato manuale (admin/referente).
              Il pulsante è visibile solo se ci sono transizioni lecite
              disponibili per lo stato corrente (vedi TRANSIZIONI_LECITE).
              Gli stati terminali (es. chiusa_positiva) non mostrano il
              pulsante perché nessuna transizione è permessa. */}
          {isReviewerOrAdmin &&
            transizioniDisponibili.length > 0 && (
              <Button
                variant="outline"
                onClick={() => {
                  setNuovoStato(transizioniDisponibili[0] as StatoSegnalazione);
                  setDialogCambioStato(true);
                }}
              >
                <History className="w-4 h-4 mr-1" /> Cambia stato
              </Button>
            )}

          {/* Recidiva */}
          {isReviewerOrAdmin &&
            ["inviata", "in_attesa", "chiusa_negativa"].includes(segnalazione.stato) && (
              <Button
                variant="outline"
                onClick={() => onNuovaRecidiva(segnalazione.id)}
              >
                <AlertTriangle className="w-4 h-4 mr-1" /> Genera segnalazione collegata (recidiva)
              </Button>
            )}

          {/* Anteprima lettera (sempre disponibile) */}
          {segnalazione.stato !== "bozza" && (
            <>
              <Button
                variant="outline"
                onClick={() => window.open(`/api/segnalazioni/${segnalazione.id}/lettera`, "_blank")}
              >
                <Eye className="w-4 h-4 mr-1" /> Anteprima lettera
              </Button>
              {segnalazione.allegati && segnalazione.allegati.some((a) => a.tipo === "foto") && (
                <Button
                  variant="outline"
                  onClick={() => window.open(`/api/segnalazioni/${segnalazione.id}/lettera?with_attachments=1`, "_blank")}
                >
                  <Eye className="w-4 h-4 mr-1" /> Lettera con allegati
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
              <MapPin className="w-4 h-4" /> Luogo
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Indirizzo:</span>{" "}
              <span className="font-medium">{segnalazione.indirizzoVia}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Comune:</span>{" "}
              <span className="font-medium">
                {segnalazione.comune?.nome ?? "n/d"}
                {segnalazione.provincia ? ` (${segnalazione.provincia.sigla})` : ""}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">CAP:</span>{" "}
              <span className="font-medium">{segnalazione.cap || "n/d"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Regione:</span>{" "}
              <span className="font-medium">{segnalazione.regione?.regione ?? "n/d"}</span>
            </div>
            {segnalazione.nomeEsercizio && (
              <div>
                <span className="text-muted-foreground">Esercizio:</span>{" "}
                <span className="font-medium">{segnalazione.nomeEsercizio}</span>
              </div>
            )}
            {segnalazione.latitudine != null && segnalazione.longitudine != null && (
              <div>
                <span className="text-muted-foreground">Coordinate:</span>{" "}
                <a
                  href={`https://www.google.com/maps?q=${segnalazione.latitudine},${segnalazione.longitudine}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {segnalazione.latitudine.toFixed(6)}, {segnalazione.longitudine.toFixed(6)}
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <User className="w-4 h-4" /> Persone
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">Volontario segnalatore:</span>{" "}
              <span className="font-medium">{segnalazione.volontario?.nomeCognome ?? "n/d"}</span>
            </div>
            {segnalazione.referenteApprovatore && (
              <div>
                <span className="text-muted-foreground">Approvata da:</span>{" "}
                <span className="font-medium">{segnalazione.referenteApprovatore.nomeCognome}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">Destinatario:</span>{" "}
              <span className="font-medium">{segnalazione.destinatarioNome ?? "n/d"}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Mittente visibile:</span>{" "}
              <span className="font-medium">{segnalazione.mittenteVisibile ? "Sì, volontario" : "No, referente"}</span>
            </div>
            {segnalazione.dataInvio && (
              <div>
                <span className="text-muted-foreground">Data invio:</span>{" "}
                <span className="font-medium">
                  {new Date(segnalazione.dataInvio).toLocaleString("it-IT")}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Tipologia non conformità</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>{segnalazione.chkVetroPianoInclinato ? "[X]" : "[ ]"} Vetro piano inclinato</div>
            <div>{segnalazione.chkVetroCurvo ? "[X]" : "[ ]"} Vetro curvo / dispersione libera</div>
            {segnalazione.chkAltroTipologia && (
              <div>
                <span className="text-muted-foreground">Altro:</span> {segnalazione.notaAltroTipologia}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Problemi riscontrati</CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            <div>{segnalazione.chkLuceVersoAlto ? "[X]" : "[ ]"} Emissione luce verso l&apos;alto</div>
            <div>{segnalazione.chkAbbagliamento ? "[X]" : "[ ]"} Abbagliamento</div>
            <div>{segnalazione.chkLuceIntrusiva ? "[X]" : "[ ]"} Luce intrusiva</div>
            {segnalazione.chkAltroProblema && (
              <div>
                <span className="text-muted-foreground">Altro:</span> {segnalazione.notaAltroProblema}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {segnalazione.descrizioneLibera && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Descrizione libera</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm whitespace-pre-wrap">{segnalazione.descrizioneLibera}</p>
          </CardContent>
        </Card>
      )}

      {segnalazione.allegati && segnalazione.allegati.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Paperclip className="w-4 h-4" /> Allegati ({segnalazione.allegati.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {segnalazione.allegati.map((a) => (
                <a
                  key={a.id}
                  href={`/api/allegati/${a.id}/download`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block p-3 border rounded-md hover:bg-accent/30 text-sm"
                >
                  {a.tipo === "foto" ? (
                     
                    <img
                      src={`/api/allegati/${a.id}/preview`}
                      alt={a.nomeOriginale}
                      className="w-full h-24 object-cover rounded mb-2"
                    />
                  ) : (
                    <FileText className="w-8 h-8 mx-auto mb-2" />
                  )}
                  <div className="truncate text-xs">{a.nomeOriginale}</div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Storico stati */}
      {segnalazione.storicoStati && segnalazione.storicoStati.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <History className="w-4 h-4" /> Storico degli stati
            </CardTitle>
            <CardDescription>Tracciabilità completa della segnalazione</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {segnalazione.storicoStati.map((st, idx, arr) => {
                const isLast = idx === arr.length - 1;
                return (
                  <li key={st.id} className="flex gap-3 text-sm">
                    <div className="flex flex-col items-center">
                      <div className={`w-3 h-3 rounded-full ${st.statoNuovo ? coloreStato(st.statoNuovo) : "bg-gray-400"}`} />
                      {!isLast && (
                        <div className="w-px flex-1 bg-border my-1" />
                      )}
                    </div>
                    <div className="pb-3">
                      <div className="font-medium">
                        {st.statoPrecedente ? `${labelStato(st.statoPrecedente)} → ` : ""}
                        {st.statoNuovo ? labelStato(st.statoNuovo) : "Evento di sistema"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(st.timestamp).toLocaleString("it-IT")},{" "}
                        {st.user?.nomeCognome ?? "n/d"} ({st.user ? labelRuolo(st.user.ruolo) : ""})
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

      {/* Dialog rifiuto */}
      <Dialog open={dialogRifiuto} onOpenChange={setDialogRifiuto}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rifiuta la segnalazione</DialogTitle>
            <DialogDescription>
              La segnalazione tornerà in stato di bozza al volontario. La nota è obbligatoria.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="nota-rifiuto">Nota per il volontario</Label>
            <Textarea
              id="nota-rifiuto"
              rows={4}
              value={notaRifiuto}
              onChange={(e) => setNotaRifiuto(e.target.value)}
              placeholder="Es. Mancano le foto dell'impianto. Ricaricare e reinviare."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogRifiuto(false)}>Annulla</Button>
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
              Operazione riservata a referenti e amministratori. Usala per registrare
              l&apos;esito dopo l&apos;invio della PEC: <strong>In attesa</strong> se non è
              ancora arrivata risposta dall&apos;amministrazione, <strong>Chiusa positiva</strong>{" "}
              se l&apos;impianto è stato adeguato, <strong>Chiusa negativa</strong> se non c&apos;è
              stato adeguamento (da qui puoi valutare di generare una nuova segnalazione
              collegata per recidiva, dal pulsante &quot;Nuova segnalazione collegata&quot;).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Nuovo stato</Label>
              <Select value={nuovoStato} onValueChange={(v) => setNuovoStato(v as StatoSegnalazione)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Le opzioni sono filtrate in base alla matrice
                      TRANSIZIONI_LECITE per lo stato corrente, così
                      l'utente può selezionare solo transizioni lecite
                      (il backend le rifiuterebbe con 400 altrimenti). */}
                  {STATI_SEGNALAZIONE.filter((s) =>
                    (TRANSIZIONI_LECITE[segnalazione.stato] ?? []).includes(s.value)
                  ).map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="nota-cambio">Nota (opzionale)</Label>
              <Textarea
                id="nota-cambio"
                rows={3}
                value={notaCambio}
                onChange={(e) => setNotaCambio(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogCambioStato(false)}>Annulla</Button>
            <Button onClick={cambiaStato} disabled={azioneInCorso}>Conferma</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
