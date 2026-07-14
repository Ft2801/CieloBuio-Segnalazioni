"use client";

/**
 * Form di creazione/modifica di una segnalazione.
 * Riproduce il flusso del sistema Excel originale (sezione 12 specifiche):
 * 1. Acquisizione luogo (indirizzo + GPS opzionale)
 * 2. Derivazione automatica comune -> provincia -> regione -> legge
 * 3. Specifiche di non conformità (checkbox + testo libero)
 * 4. Personalizzazione invio (destinatario, ARPA, CC, oggetto)
 * 5. Allegati (foto, max 4)
 *
 * Autore: Fabio Tempera (2026)
 */

import { useEffect, useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeft,
  MapPin,
  Camera,
  Crosshair,
  Save,
  FileText,
  Trash2,
  Upload,
} from "lucide-react";
import type { Segnalazione, SessionUser } from "@/lib/types";
import { MAX_ALLEGATI_PER_SEGNALAZIONE, MAX_ALLEGATO_BYTE } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { guardDemoReadOnly, isDemoSession, DEMO_READONLY_MESSAGE } from "@/lib/demo-mode";

type Comune = {
  id: number;
  nome: string;
  cap: string;
  pecComune: string;
  nomeSindaco: string | null;
  provincia: { sigla: string; nome: string; regione: { regione: string; riferimentoLegge: string } };
};

export function FormSegnalazione({
  user,
  segnalazioneId,
  segnalazionePrecedenteId,
  onBack,
  onSaved,
}: {
  user: SessionUser;
  segnalazioneId?: string | null;
  segnalazionePrecedenteId?: string | null;
  onBack: () => void;
  onSaved: (id: string) => void;
}) {
  const { toast } = useToast();
  const [caricamento, setCaricamento] = useState(false);
  const [salvataggio, setSalvataggio] = useState(false);
  const [comuni, setComuni] = useState<Comune[]>([]);
  const [searchComune, setSearchComune] = useState("");
  const [allegati, setAllegati] = useState<NonNullable<Segnalazione["allegati"]>>([]);

  // Campi del form
  const [indirizzoVia, setIndirizzoVia] = useState("");
  const [comuneId, setComuneId] = useState<number | null>(null);
  const [cap, setCap] = useState("");
  const [latitudine, setLatitudine] = useState<number | null>(null);
  const [longitudine, setLongitudine] = useState<number | null>(null);
  const [nomeEsercizio, setNomeEsercizio] = useState("");

  const [chkVetroPianoInclinato, setChkVetroPianoInclinato] = useState(false);
  const [chkVetroCurvo, setChkVetroCurvo] = useState(false);
  const [chkAltroTipologia, setChkAltroTipologia] = useState(false);
  const [notaAltroTipologia, setNotaAltroTipologia] = useState("");

  const [chkLuceVersoAlto, setChkLuceVersoAlto] = useState(false);
  const [chkAbbagliamento, setChkAbbagliamento] = useState(false);
  const [chkLuceIntrusiva, setChkLuceIntrusiva] = useState(false);
  const [chkAltroProblema, setChkAltroProblema] = useState(false);
  const [notaAltroProblema, setNotaAltroProblema] = useState("");

  const [descrizioneLibera, setDescrizioneLibera] = useState("");
  const [destinatarioNome, setDestinatarioNome] = useState("");
  const [includiArpa, setIncludiArpa] = useState(false);
  const [pecCcAggiuntive, setPecCcAggiuntive] = useState("");
  const [oggettoPec, setOggettoPec] = useState("");
  const [testoIntroduttivoPec, setTestoIntroduttivoPec] = useState("");
  const [mittenteVisibile, setMittenteVisibile] = useState(true);

  const [comuneSelezionato, setComuneSelezionato] = useState<Comune | null>(null);
  const [segnalazionePrecedente, setSegnalazionePrecedente] = useState<{
    id: string;
    numeroProtocollo: string | null;
    indirizzoVia: string;
    livelloRecidiva: number;
  } | null>(null);

  // ID della segnalazione creata dal "Salva e continua a modificare":
  // tracciato localmente perché il prop segnalazioneId non cambia dopo
  // una POST. Questo stato rende disponibile l'ID appena generato per
  // le operazioni successive (upload allegati) senza uscire dalla pagina.
  const [createdId, setCreatedId] = useState<string | null>(null);
  const effectiveSegnalazioneId = segnalazioneId ?? createdId;

  // Carica dettaglio se in modifica
  useEffect(() => {
    if (!segnalazioneId) return;
    // In demo mode, leggiamo i dati della segnalazione dalla lib demo-mode
    // invece di chiamare l'API (che non è disponibile senza server).
    if (isDemoSession(user)) {
      // Demo mode: la demo non supporta modifica di segnalazioni esistenti,
      // mostriamo solo il form vuoto (come nuova segnalazione).
      setCaricamento(false);
      return;
    }
    setCaricamento(true);
    fetch(`/api/segnalazioni/${segnalazioneId}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error ?? "Errore caricamento segnalazione");
        }
        return r.json().catch(() => ({}));
      })
      .then((data) => {
        const s = data.segnalazione;
        if (!s) return;
        setIndirizzoVia(s.indirizzoVia ?? "");
        setComuneId(s.comuneId ?? null);
        setCap(s.cap ?? "");
        setLatitudine(s.latitudine);
        setLongitudine(s.longitudine);
        setNomeEsercizio(s.nomeEsercizio ?? "");
        setChkVetroPianoInclinato(s.chkVetroPianoInclinato);
        setChkVetroCurvo(s.chkVetroCurvo);
        setChkAltroTipologia(s.chkAltroTipologia);
        setNotaAltroTipologia(s.notaAltroTipologia ?? "");
        setChkLuceVersoAlto(s.chkLuceVersoAlto);
        setChkAbbagliamento(s.chkAbbagliamento);
        setChkLuceIntrusiva(s.chkLuceIntrusiva);
        setChkAltroProblema(s.chkAltroProblema);
        setNotaAltroProblema(s.notaAltroProblema ?? "");
        setDescrizioneLibera(s.descrizioneLibera ?? "");
        setDestinatarioNome(s.destinatarioNome ?? "");
        setIncludiArpa(s.includiArpa);
        setPecCcAggiuntive(s.pecCcAggiuntive ?? "");
        setOggettoPec(s.oggettoPec ?? "");
        setTestoIntroduttivoPec(s.testoIntroduttivoPec ?? "");
        setMittenteVisibile(s.mittenteVisibile);
        setAllegati(s.allegati ?? []);
      })
      .catch((e) => {
        toast({
          title: "Errore caricamento",
          description: e instanceof Error ? e.message : "Errore sconosciuto",
          variant: "destructive",
        });
      })
      .finally(() => setCaricamento(false));
  }, [segnalazioneId, user, toast]);

  // Carica segnalazione precedente se presente (recidiva)
  useEffect(() => {
    if (!segnalazionePrecedenteId) return;
    if (isDemoSession(user)) return;
    fetch(`/api/segnalazioni/${segnalazionePrecedenteId}`)
      .then(async (r) => {
        if (!r.ok) return null;
        return r.json().catch(() => ({}));
      })
      .then((data) => {
        if (!data) return;
        const s = data.segnalazione;
        if (!s) return;
        setSegnalazionePrecedente({
          id: s.id,
          numeroProtocollo: s.numeroProtocollo,
          indirizzoVia: s.indirizzoVia,
          livelloRecidiva: s.livelloRecidiva ?? 1,
        });
        // Precompila i campi del luogo con quelli della segnalazione precedente
        setIndirizzoVia(s.indirizzoVia ?? "");
        setComuneId(s.comuneId ?? null);
        setCap(s.cap ?? "");
        setLatitudine(s.latitudine);
        setLongitudine(s.longitudine);
        setNomeEsercizio(s.nomeEsercizio ?? "");
      })
      .catch(console.error);
  }, [segnalazionePrecedenteId, user]);

  // Carica comuni (con ricerca e debounce 300ms)
  const debounceComuneTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [debouncedSearchComune, setDebouncedSearchComune] = useState("");
  useEffect(() => {
    if (debounceComuneTimer.current) clearTimeout(debounceComuneTimer.current);
    debounceComuneTimer.current = setTimeout(() => {
      setDebouncedSearchComune(searchComune);
    }, 300);
    return () => {
      if (debounceComuneTimer.current) clearTimeout(debounceComuneTimer.current);
    };
  }, [searchComune]);

  useEffect(() => {
    const url = debouncedSearchComune
      ? `/api/config/comuni?search=${encodeURIComponent(debouncedSearchComune)}`
      : `/api/config/comuni`;
    fetch(url)
      .then((r) => r.json().catch(() => ({})))
      .then((data) => setComuni(data.comuni ?? []))
      .catch(console.error);
  }, [debouncedSearchComune]);

  // Quando seleziona un comune, aggiorna cap/destinatario/oggetto.
  // La ricerca comune potrebbe filtrare fuori il comune selezionato
  // dalla lista visibile, ma conserviamo comunque l'oggetto Comune
  // tracciato esplicitamente in comuneSelezionato (impostato nel
  // callback onClick della lista, non derivato da comuni.find qui).
  // I campi PEC (oggetto, testo introduttivo, destinatario) vengono
  // precompilati solo se l'utente non li ha già modificati a mano:
  // il guard `!field` preserva le modifiche utente quando cambia comune.
  useEffect(() => {
    if (!comuneId) {
      setComuneSelezionato(null);
      return;
    }
    // Se abbiamo già un comune selezionato tracciato, usiamo quello.
    // Altrimenti cerchiamo nella lista visibile (utile per il caricamento
    // iniziale di una segnalazione in modifica dove il comune era già
    // impostato: in quel caso la lista potrebbe non contenerlo, e il
    // comuneSelezionato resta null finché l'utente non cerca/seleziona).
    if (comuneSelezionato && comuneSelezionato.id === comuneId) {
      return;
    }
    const c = comuni.find((x) => x.id === comuneId);
    if (c) {
      setComuneSelezionato(c);
      if (!cap) setCap(c.cap);
      if (!destinatarioNome && c.nomeSindaco) {
        setDestinatarioNome(`Sindaco ${c.nomeSindaco}`);
      }
      if (!oggettoPec) {
        setOggettoPec(
          `Segnalazione impianto di illuminazione non conforme - ${c.nome} (${c.provincia.sigla})`
        );
      }
      if (!testoIntroduttivoPec) {
        setTestoIntroduttivoPec(
          "Si segnala la presenza di un impianto di illuminazione non conforme alle disposizioni di legge in vigore."
        );
      }
    }
    // Dipendenze limitate a comuneId e comuneSelezionato per mantenere
    // l'effetto focalizzato sulla selezione del comune e non rieseguirlo
    // ad ogni cambio della lista comuni (soggetta a debounce di ricerca).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comuneId, comuneSelezionato]);

  // GPS
  const [gpsLoading, setGpsLoading] = useState(false);
  function rilevaGPS() {
    if (!navigator.geolocation) {
      toast({ title: "GPS non disponibile", variant: "destructive" });
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitudine(pos.coords.latitude);
        setLongitudine(pos.coords.longitude);
        toast({ title: "Posizione rilevata", description: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}` });
        setGpsLoading(false);
      },
      (err) => {
        toast({ title: "Errore GPS", description: err.message, variant: "destructive" });
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  async function salva(esci: boolean = false) {
    if (!indirizzoVia.trim()) {
      toast({ title: "Indirizzo obbligatorio", variant: "destructive" });
      return;
    }
    setSalvataggio(true);
    try {
      guardDemoReadOnly(user);
      const payload = {
        indirizzoVia,
        comuneId,
        cap,
        latitudine,
        longitudine,
        nomeEsercizio,
        chkVetroPianoInclinato,
        chkVetroCurvo,
        chkAltroTipologia,
        notaAltroTipologia,
        chkLuceVersoAlto,
        chkAbbagliamento,
        chkLuceIntrusiva,
        chkAltroProblema,
        notaAltroProblema,
        descrizioneLibera,
        destinatarioNome,
        includiArpa,
        pecCcAggiuntive,
        oggettoPec,
        testoIntroduttivoPec,
        mittenteVisibile,
        segnalazionePrecedenteId: segnalazionePrecedenteId ?? null,
        // livelloRecidiva NON viene inviato dal client: il server lo calcola
        // server-side in base alla segnalazione precedente collegata.
      };
      const url = effectiveSegnalazioneId ? `/api/segnalazioni/${effectiveSegnalazioneId}` : "/api/segnalazioni";
      const method = effectiveSegnalazioneId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Errore salvataggio");
      // Traccia l'ID della segnalazione appena creata per consentire
      // l'upload di allegati senza uscire dalla pagina.
      if (data.segnalazione?.id && !effectiveSegnalazioneId) {
        setCreatedId(data.segnalazione.id);
      }
      toast({ title: "Segnalazione salvata", description: "Bozza aggiornata con successo" });
      if (esci && data.segnalazione?.id) {
        onSaved(data.segnalazione.id);
      }
    } catch (e) {
      toast({
        title: "Errore",
        description: e instanceof Error ? e.message : "Errore sconosciuto",
        variant: "destructive",
      });
    } finally {
      setSalvataggio(false);
    }
  }

  async function caricaAllegato(file: File) {
    if (isDemoSession(user)) {
      toast({ title: "Azione non disponibile", description: DEMO_READONLY_MESSAGE, variant: "destructive" });
      return;
    }
    if (!effectiveSegnalazioneId) {
      toast({ title: "Salva prima la bozza", description: "Salva la segnalazione prima di caricare allegati", variant: "destructive" });
      return;
    }
    // Validazione client-side dimensione (10 MB) per evitare upload lunghi
    // che falliscono lato server con errore opaco. Il messaggio usa la
    // costante MAX_ALLEGATO_BYTE per restare coerente se il limite cambia.
    const MAX_FILE_SIZE = MAX_ALLEGATO_BYTE;
    if (file.size > MAX_FILE_SIZE) {
      toast({
        title: "File troppo grande",
        description: `Dimensione massima ${(MAX_FILE_SIZE / 1024 / 1024).toFixed(0)} MB. Il file selezionato è di ${(file.size / 1024 / 1024).toFixed(2)} MB.`,
        variant: "destructive",
      });
      return;
    }
    const formData = new FormData();
    formData.append("file", file);
    formData.append("segnalazioneId", effectiveSegnalazioneId);
    formData.append("tipo", file.type.startsWith("image/") ? "foto" : "documento");
    try {
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Errore upload", description: data.error ?? "Errore sconosciuto", variant: "destructive" });
        return;
      }
      setAllegati((prev) => [...prev, data.allegato]);
      toast({ title: "Allegato caricato" });
    } catch (e) {
      toast({
        title: "Errore di rete",
        description: e instanceof Error ? e.message : "Errore sconosciuto",
        variant: "destructive",
      });
    }
  }

  async function eliminaAllegato(id: string) {
    if (isDemoSession(user)) {
      toast({ title: "Azione non disponibile", description: DEMO_READONLY_MESSAGE, variant: "destructive" });
      return;
    }
    if (!confirm("Eliminare questo allegato?")) return;
    // Verifica la risposta prima di aggiornare lo stato locale: se l'API
    // fallisce, l'allegato resta nella UI.
    try {
      const res = await fetch(`/api/allegati?id=${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Errore eliminazione",
          description: data.error ?? "Errore sconosciuto",
          variant: "destructive",
        });
        return;
      }
      setAllegati((prev) => prev.filter((a) => a.id !== id));
      toast({ title: "Allegato eliminato" });
    } catch (e) {
      toast({
        title: "Errore di rete",
        description: e instanceof Error ? e.message : "Errore sconosciuto",
        variant: "destructive",
      });
    }
  }

  if (caricamento) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-muted-foreground">Caricamento…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Indietro
        </Button>
        <h1 className="text-2xl font-bold">
          {segnalazioneId ? "Modifica segnalazione" : "Nuova segnalazione"}
        </h1>
      </div>

      {segnalazionePrecedente && (
        <div className="p-4 rounded-md border border-amber-500/40 bg-amber-500/5 text-sm">
          <p className="font-medium text-amber-700 dark:text-amber-300">
            Segnalazione collegata per recidiva
          </p>
          <p className="text-muted-foreground mt-1">
            Questa è la segnalazione di livello {segnalazionePrecedente.livelloRecidiva + 1} per la pratica{" "}
            {segnalazionePrecedente.numeroProtocollo ?? "senza protocollo"} ({segnalazionePrecedente.indirizzoVia}).
            I campi del luogo sono stati precompilati con quelli della segnalazione precedente.
          </p>
        </div>
      )}

      {/* 1. Luogo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="w-5 h-5" /> Luogo della segnalazione
          </CardTitle>
          <CardDescription>
            Indica dove si trova l&apos;impianto non conforme. Puoi usare il GPS o inserire l&apos;indirizzo manualmente.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="indirizzo">Indirizzo *</Label>
              <Input
                id="indirizzo"
                value={indirizzoVia}
                onChange={(e) => setIndirizzoVia(e.target.value)}
                placeholder="Via, numero civico"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="esercizio">Nome esercizio (opzionale)</Label>
              <Input
                id="esercizio"
                value={nomeEsercizio}
                onChange={(e) => setNomeEsercizio(e.target.value)}
                placeholder="Es. Bar Centrale, Capannone industriale"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Comune</Label>
            <Input
              placeholder="Cerca comune..."
              value={searchComune}
              onChange={(e) => setSearchComune(e.target.value)}
              className="mb-2"
            />
            <div className="max-h-48 overflow-y-auto border rounded-md">
              {comuni.length === 0 ? (
                <div className="p-3 text-sm text-muted-foreground text-center">
                  Nessun comune. Inizia a digitare per cercare.
                </div>
              ) : (
                <ul className="divide-y">
                  {comuni.slice(0, 30).map((c) => (
                    <li
                      key={c.id}
                      className={`p-2 cursor-pointer hover:bg-accent/30 text-sm ${
                        comuneId === c.id ? "bg-primary/20" : ""
                      }`}
                      onClick={() => {
                        setComuneId(c.id);
                        // Traccia esplicitamente il comune selezionato:
                        // quando l'utente cerca un altro comune, il
                        // filtering di `comuni` non azzererà la selezione.
                        setComuneSelezionato(c);
                        // Precompila cap/destinatario/oggetto dal comune.
                        if (!cap) setCap(c.cap);
                        if (!destinatarioNome && c.nomeSindaco) {
                          setDestinatarioNome(`Sindaco ${c.nomeSindaco}`);
                        }
                        if (!oggettoPec) {
                          setOggettoPec(
                            `Segnalazione impianto di illuminazione non conforme - ${c.nome} (${c.provincia.sigla})`
                          );
                        }
                        if (!testoIntroduttivoPec) {
                          setTestoIntroduttivoPec(
                            "Si segnala la presenza di un impianto di illuminazione non conforme alle disposizioni di legge in vigore."
                          );
                        }
                        setSearchComune("");
                      }}
                    >
                      <span className="font-medium">{c.nome}</span>
                      <span className="text-muted-foreground">, {c.cap} ({c.provincia.sigla})</span>
                      {c.nomeSindaco && (
                        <span className="text-xs text-muted-foreground">, Sindaco: {c.nomeSindaco}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {comuneSelezionato && (
              <div className="text-sm text-muted-foreground mt-2 p-2 bg-accent/20 rounded">
                <strong>Comune selezionato:</strong> {comuneSelezionato.nome} ({comuneSelezionato.provincia.sigla}),{" "}
                {comuneSelezionato.provincia.regione.regione}
                <br />
                <strong>Riferimento legge:</strong> {comuneSelezionato.provincia.regione.riferimentoLegge}
                <br />
                <strong>PEC Comune:</strong> {comuneSelezionato.pecComune}
              </div>
            )}
          </div>

          <div className="grid sm:grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cap">CAP</Label>
              <Input id="cap" value={cap} onChange={(e) => setCap(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lat">Latitudine</Label>
              <Input
                id="lat"
                type="number"
                step="any"
                value={latitudine ?? ""}
                onChange={(e) => setLatitudine(e.target.value ? Number(e.target.value) : null)}
                placeholder="auto"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="lng">Longitudine</Label>
              <Input
                id="lng"
                type="number"
                step="any"
                value={longitudine ?? ""}
                onChange={(e) => setLongitudine(e.target.value ? Number(e.target.value) : null)}
                placeholder="auto"
              />
            </div>
          </div>

          <Button type="button" variant="outline" size="sm" onClick={rilevaGPS} disabled={gpsLoading}>
            <Crosshair className="w-4 h-4 mr-1" /> {gpsLoading ? "Rilevazione in corso…" : "Rileva posizione GPS"}
          </Button>
        </CardContent>
      </Card>

      {/* 2. Tipologia non conformità */}
      <Card>
        <CardHeader>
          <CardTitle>Tipologia di non conformità</CardTitle>
          <CardDescription>Seleziona una o più tipologie riscontrate</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="chk1"
              checked={chkVetroPianoInclinato}
              onCheckedChange={(v) => setChkVetroPianoInclinato(!!v)}
            />
            <Label htmlFor="chk1" className="cursor-pointer text-sm leading-snug">
              Apparecchi a chiusura (vetro di protezione) piana inclinata rispetto all&apos;orizzontale
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="chk2"
              checked={chkVetroCurvo}
              onCheckedChange={(v) => setChkVetroCurvo(!!v)}
            />
            <Label htmlFor="chk2" className="cursor-pointer text-sm leading-snug">
              Apparecchi a dispersione libera o a chiusura sporgente (vetro curvo o vetri laterali)
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="chk3"
              checked={chkAltroTipologia}
              onCheckedChange={(v) => setChkAltroTipologia(!!v)}
            />
            <Label htmlFor="chk3" className="cursor-pointer text-sm">
              Altro
            </Label>
          </div>
          {chkAltroTipologia && (
            <Textarea
              placeholder="Specifica la tipologia..."
              value={notaAltroTipologia}
              onChange={(e) => setNotaAltroTipologia(e.target.value)}
            />
          )}
        </CardContent>
      </Card>

      {/* 3. Problemi/anomalie */}
      <Card>
        <CardHeader>
          <CardTitle>Problemi/anomalie riscontrate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2">
            <Checkbox
              id="chk4"
              checked={chkLuceVersoAlto}
              onCheckedChange={(v) => setChkLuceVersoAlto(!!v)}
            />
            <Label htmlFor="chk4" className="cursor-pointer text-sm leading-snug">
              Emissione di luce verso l&apos;alto
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="chk5"
              checked={chkAbbagliamento}
              onCheckedChange={(v) => setChkAbbagliamento(!!v)}
            />
            <Label htmlFor="chk5" className="cursor-pointer text-sm leading-snug">
              Elevati fenomeni di abbagliamento e pericolo per il traffico pedonale e stradale
              (vietati anche ai sensi dell&apos;art. 23 del Codice della Strada)
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="chk6"
              checked={chkLuceIntrusiva}
              onCheckedChange={(v) => setChkLuceIntrusiva(!!v)}
            />
            <Label htmlFor="chk6" className="cursor-pointer text-sm leading-snug">
              Luce intrusiva nei fondi e aree private (non ammessa ai sensi del Codice Civile ex art. 844)
            </Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="chk7"
              checked={chkAltroProblema}
              onCheckedChange={(v) => setChkAltroProblema(!!v)}
            />
            <Label htmlFor="chk7" className="cursor-pointer text-sm">
              Altro
            </Label>
          </div>
          {chkAltroProblema && (
            <Textarea
              placeholder="Specifica il problema..."
              value={notaAltroProblema}
              onChange={(e) => setNotaAltroProblema(e.target.value)}
            />
          )}
          <div className="space-y-2">
            <Label htmlFor="desc">Descrizione libera (facoltativa, va nella lettera PEC)</Label>
            <Textarea
              id="desc"
              rows={4}
              value={descrizioneLibera}
              onChange={(e) => setDescrizioneLibera(e.target.value)}
              placeholder="Eventuali dettagli aggiuntivi da inserire nella lettera di segnalazione..."
            />
          </div>
        </CardContent>
      </Card>

      {/* 4. Personalizzazione invio */}
      <Card>
        <CardHeader>
          <CardTitle>Personalizzazione invio PEC</CardTitle>
          <CardDescription>
            Questi dati verranno usati per comporre la lettera. Sono precompilati automaticamente dal comune selezionato.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dest">Destinatario</Label>
            <Input
              id="dest"
              value={destinatarioNome}
              onChange={(e) => setDestinatarioNome(e.target.value)}
              placeholder="Es. Sindaco Nome Cognome"
            />
          </div>
          <div className="flex items-center justify-between p-3 rounded-md bg-accent/20">
            <div>
              <div className="font-medium text-sm">Includi ARPA regionale in copia</div>
              <div className="text-xs text-muted-foreground">
                Aggiunge l&apos;indirizzo PEC dell&apos;ARPA regionale tra i destinatari
              </div>
            </div>
            <Switch checked={includiArpa} onCheckedChange={setIncludiArpa} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="cc">PEC aggiuntive in copia (separate da ;)</Label>
            <Input
              id="cc"
              value={pecCcAggiuntive}
              onChange={(e) => setPecCcAggiuntive(e.target.value)}
              placeholder="altro1@pec.it; altro2@pec.it"
            />
            <p className="text-xs text-muted-foreground">
              Nota tecnica: i messaggi PEC non supportano il CCN (BCC). Tutti i destinatari vanno in TO o CC.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="ogg">Oggetto PEC</Label>
            <Input
              id="ogg"
              value={oggettoPec}
              onChange={(e) => setOggettoPec(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="intro">Testo introduttivo PEC</Label>
            <Textarea
              id="intro"
              rows={3}
              value={testoIntroduttivoPec}
              onChange={(e) => setTestoIntroduttivoPec(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between p-3 rounded-md bg-accent/20">
            <div>
              <div className="font-medium text-sm">
                Mittente: {mittenteVisibile ? "volontario" : "referente CieloBuio"}
              </div>
              <div className="text-xs text-muted-foreground">
                Se attivo, la lettera parte a nome del volontario segnalatore (con i suoi dati anagrafici). Se disattivato, parte a nome del referente CieloBuio. La decisione va concordata con il direttivo caso per caso.
              </div>
            </div>
            <Switch checked={mittenteVisibile} onCheckedChange={setMittenteVisibile} />
          </div>
        </CardContent>
      </Card>

      {/* 5. Allegati */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Camera className="w-5 h-5" /> Allegati
          </CardTitle>
          <CardDescription>
            Fino a 4 foto o documenti a supporto della segnalazione. Formati
            accettati: JPG, PNG, WebP, PDF. Dimensione massima 10 MB per file.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {allegati.length > 0 && (
            <ul className="space-y-2">
              {allegati.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 p-2 border rounded-md">
                  <a
                    href={`/api/allegati/${a.id}/download`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm hover:underline min-w-0 flex-1"
                  >
                    <FileText className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">{a.nomeOriginale}</span>
                  </a>
                  <Badge variant="outline">{a.tipo}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => eliminaAllegato(a.id)}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {allegati.length < MAX_ALLEGATI_PER_SEGNALAZIONE ? (
            <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-md cursor-pointer hover:border-primary/40 hover:bg-accent/20 text-sm">
              <Upload className="w-4 h-4" />
              <span>Carica allegato (max {MAX_ALLEGATI_PER_SEGNALAZIONE})</span>
              <input
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.pdf,application/pdf"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) caricaAllegato(f);
                  e.target.value = "";
                }}
              />
            </label>
          ) : (
            <p className="text-sm text-muted-foreground text-center p-3">
              Raggiunto il limite massimo di 4 allegati
            </p>
          )}
        </CardContent>
      </Card>

      {/* Azioni */}
      <div className="space-y-2 pb-6">
        <p className="text-xs text-muted-foreground text-right">
          Il salvataggio non invia nulla: la bozza resta modificabile. Per inviarla
          al referente territoriale per l&apos;approvazione, apri il dettaglio della
          segnalazione e usa il pulsante &quot;Invia al referente&quot;.
        </p>
        <div className="flex flex-wrap gap-3 justify-end">
          <Button variant="outline" onClick={onBack}>
            Annulla
          </Button>
          <Button variant="secondary" onClick={() => salva(false)} disabled={salvataggio}>
            <Save className="w-4 h-4 mr-1" /> Salva e continua a modificare
          </Button>
          <Button onClick={() => salva(true)} disabled={salvataggio}>
            <Save className="w-4 h-4 mr-1" /> Salva ed esci alla lista
          </Button>
        </div>
      </div>
    </div>
  );
}
