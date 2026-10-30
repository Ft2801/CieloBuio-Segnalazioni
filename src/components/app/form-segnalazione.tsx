"use client";

/**
 * Form di creazione/modifica di una segnalazione.
 * Flusso di compilazione:
 * 1. Acquisizione luogo (indirizzo + GPS opzionale)
 * 2. Derivazione automatica comune -> provincia -> regione -> legge
 * 3. Tipologie e problemi di non conformità (checkbox + testo libero)
 * 4. Personalizzazione invio (destinatario, ARPA, CC, oggetto)
 * 5. Allegati (foto, max 4)
 *
 * Autore: Fabio Tempera (2026)
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, MapPin, Camera, Crosshair, Save, FileText, Trash2, Upload, ChevronDown } from "lucide-react";
import type { Segnalazione, SessionUser } from "@/lib/types";
import { MAX_ALLEGATI_PER_SEGNALAZIONE, MAX_ALLEGATO_BYTE } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { guardDemoReadOnly, isDemoSession, DEMO_READONLY_MESSAGE } from "@/lib/demo-mode";
import { getDemoSegnalazione } from "@/lib/demo-data";
import { FUSO_ORARIO_UI } from "@/lib/format";

/** Messaggio unico per gli errori senza dettaglio dal server. */
const ERRORE_GENERICO = "Operazione non riuscita. Riprova tra qualche istante.";

/** Passi del form: il luogo è obbligatorio, il resto si può completare in più momenti. */
type PassoForm = "luogo" | "conformita" | "allegati";
const PASSI_FORM: { id: PassoForm; etichetta: string }[] = [
  { id: "luogo", etichetta: "Luogo" },
  { id: "conformita", etichetta: "Non conformità" },
  { id: "allegati", etichetta: "Allegati e invio" },
];

/** Attesa dopo l'ultima modifica prima del salvataggio automatico della bozza. */
const RITARDO_AUTOSALVATAGGIO_MS = 2000;

const ETICHETTA_TIPO_ALLEGATO: Record<string, string> = { foto: "Foto", documento: "Documento" };

/** Messaggio leggibile per gli errori di geolocalizzazione del browser. */
function messaggioErroreGps(code: number): string {
  if (code === 1) return "Permesso di posizione negato. Inserisci l'indirizzo o le coordinate manualmente.";
  return "Impossibile rilevare la posizione. Riprova o inserisci le coordinate manualmente.";
}

type Comune = {
  id: number;
  nome: string;
  cap: string;
  pecComune: string;
  nomeSindaco: string | null;
  provincia: { sigla: string; nome: string; regione: { regione: string; riferimentoLegge: string } };
};

/** Testo introduttivo predefinito della PEC, finché l'utente non lo modifica. */
const TESTO_INTRODUTTIVO_PREDEFINITO =
  "Si segnala la presenza di un impianto di illuminazione non conforme alle disposizioni di legge in vigore.";

/** Oggetto predefinito della PEC per il comune indicato. */
function oggettoPecPredefinito(c: Comune): string {
  return `Segnalazione impianto di illuminazione non conforme - ${c.nome} (${c.provincia.sigla})`;
}

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
  // Una pratica in modifica non deve creare la baseline dell'autosalvataggio
  // prima che la risposta del server abbia popolato tutti i campi.
  const [caricamento, setCaricamento] = useState(Boolean(segnalazioneId));
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
  const [passo, setPasso] = useState<PassoForm>("luogo");
  const [errori, setErrori] = useState<{ indirizzo?: string }>({});
  const [statoSalvataggio, setStatoSalvataggio] = useState<"nessuno" | "in_corso" | "salvato" | "errore">("nessuno");
  const [ultimoSalvataggio, setUltimoSalvataggio] = useState<Date | null>(null);
  // Firma dei dati dell'ultima bozza salvata: confrontata con quella corrente per sapere se ci sono modifiche.
  const [firmaSalvata, setFirmaSalvata] = useState<string | null>(null);
  const salvataggioInCorsoRef = useRef(false);
  const versioneRef = useRef<string | undefined>(undefined);
  const [erroreCaricamento, setErroreCaricamento] = useState(false);
  const riepilogoErroriRef = useRef<HTMLDivElement>(null);
  const contenutoPassoRef = useRef<HTMLDivElement>(null);
  const passoMontato = useRef(false);
  const [allegatoDaEliminare, setAllegatoDaEliminare] = useState<{ id: string; nome: string } | null>(null);
  const effectiveSegnalazioneId = segnalazioneId ?? createdId;

  // Carica dettaglio se in modifica. In modalità dimostrativa i dati arrivano
  // dal set statico incorporato nel bundle, senza richieste di rete.
  useEffect(() => {
    if (!segnalazioneId) return;

    // Copia i dati della segnalazione nello stato del form (solo setter stabili).
    function applica(s: Segnalazione) {
      versioneRef.current = s.updatedAt;
      setIndirizzoVia(s.indirizzoVia ?? "");
      setComuneId(s.comuneId ?? null);
      // Il dettaglio contiene il Comune associato anche quando non compare
      // nelle prime 30 voci della ricerca. Mostralo subito e conservalo
      // come riferimento per aggiornare i soli campi PEC precompilati.
      setComuneSelezionato(
        s.comune?.id === s.comuneId && typeof s.comune.cap === "string" && s.provincia && s.regione
          ? {
              id: s.comune.id,
              nome: s.comune.nome,
              cap: s.comune.cap,
              pecComune: s.comune.pecComune,
              nomeSindaco: s.comune.nomeSindaco,
              provincia: {
                sigla: s.provincia.sigla,
                nome: s.provincia.nome,
                regione: { regione: s.regione.regione, riferimentoLegge: s.regione.riferimentoLegge },
              },
            }
          : null,
      );
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
    }

    if (isDemoSession(user)) {
      const demo = getDemoSegnalazione(segnalazioneId);
      if (demo) applica(demo);
      setCaricamento(false);
      return;
    }

    setCaricamento(true);
    setErroreCaricamento(false);
    fetch(`/api/segnalazioni/${segnalazioneId}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(typeof data.error === "string" ? data.error : "La segnalazione non è stata caricata.");
        }
        return r.json().catch(() => ({}));
      })
      .then((data) => {
        if (!data.segnalazione) throw new Error("Risposta priva della segnalazione.");
        applica(data.segnalazione as Segnalazione);
      })
      .catch((e) => {
        setErroreCaricamento(true);
        toast({
          title: "Caricamento non riuscito",
          description: e instanceof Error ? e.message : ERRORE_GENERICO,
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
      .catch(() => {
        // Il box recidiva resta vuoto: la segnalazione precedente è facoltativa.
      });
  }, [segnalazionePrecedenteId, user]);

  // Carica comuni (con ricerca e debounce 300ms)
  const [debouncedSearchComune, setDebouncedSearchComune] = useState("");
  useEffect(() => {
    // Timer locale all'effetto: la pulizia annulla quello del valore precedente.
    const timer = setTimeout(() => {
      setDebouncedSearchComune(searchComune);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchComune]);

  useEffect(() => {
    const controller = new AbortController();
    let annullata = false;
    const url = debouncedSearchComune
      ? `/api/config/comuni?search=${encodeURIComponent(debouncedSearchComune)}`
      : `/api/config/comuni`;
    fetch(url, { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) throw new Error("Elenco comuni non disponibile");
        return r.json();
      })
      .then((data) => {
        // Una risposta lenta a una ricerca precedente non deve sostituire
        // l'elenco della ricerca corrente, neppure se il mock ignora abort.
        if (!annullata) setComuni(data.comuni ?? []);
      })
      .catch(() => {
        if (!annullata) setComuni([]);
      });
    return () => {
      annullata = true;
      controller.abort();
    };
  }, [debouncedSearchComune]);

  /** Mantiene i valori manuali; aggiorna quelli ancora uguali ai default del Comune precedente. */
  function precompilaDaComune(c: Comune) {
    const precedente = comuneSelezionato;
    setCap((valore) => (!valore || (precedente && valore === precedente.cap) ? c.cap : valore));
    setDestinatarioNome((valore) =>
      !valore ||
      (precedente &&
        valore === (precedente.nomeSindaco ? `Sindaco ${precedente.nomeSindaco}` : `Comune di ${precedente.nome}`))
        ? c.nomeSindaco
          ? `Sindaco ${c.nomeSindaco}`
          : `Comune di ${c.nome}`
        : valore,
    );
    setOggettoPec((valore) =>
      !valore || (precedente && valore === oggettoPecPredefinito(precedente)) ? oggettoPecPredefinito(c) : valore,
    );
    setTestoIntroduttivoPec((valore) => valore || TESTO_INTRODUTTIVO_PREDEFINITO);
  }

  // Quando seleziona un comune, aggiorna cap/destinatario/oggetto.
  // La ricerca comune potrebbe filtrare fuori il comune selezionato
  // dalla lista visibile, ma conserviamo comunque l'oggetto Comune
  // tracciato esplicitamente in comuneSelezionato (impostato nel
  // callback onClick della lista, non derivato da comuni.find qui).
  // Quando cambia comune, CAP, destinatario e oggetto seguono il nuovo
  // valore predefinito solo se corrispondono ancora a quello precedente.
  // I valori personalizzati dall'utente restano invariati.
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
      precompilaDaComune(c);
    }
    // La lista può arrivare dopo il dettaglio della pratica: riprovare
    // quando arriva consente di mostrare e precompilare il Comune salvato.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comuneId, comuneSelezionato, comuni]);

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
        toast({
          title: "Posizione rilevata",
          description: `${pos.coords.latitude.toFixed(6)}, ${pos.coords.longitude.toFixed(6)}`,
        });
        setGpsLoading(false);
      },
      (err) => {
        toast({ title: "Posizione non rilevata", description: messaggioErroreGps(err.code), variant: "destructive" });
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }

  function costruisciPayload() {
    return {
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
  }

  // Firma dei dati del form: cambia solo quando cambia un campo salvabile.
  const firmaPayload = JSON.stringify(costruisciPayload());

  function mostraErroreIndirizzo() {
    setErrori({ indirizzo: "Inserisci l'indirizzo della pratica per continuare." });
  }

  async function salva(esci: boolean = false, silenzioso: boolean = false) {
    // Evita una doppia POST se due click arrivano prima del rerender React.
    if (salvataggioInCorsoRef.current || erroreCaricamento || caricamento) return;
    // L'auto-salvataggio non chiama salva() senza indirizzo: l'errore riguarda solo l'azione dell'utente.
    if (!indirizzoVia.trim()) {
      mostraErroreIndirizzo();
      return;
    }
    salvataggioInCorsoRef.current = true;
    const firmaInviata = firmaPayload;
    setSalvataggio(true);
    setStatoSalvataggio("in_corso");
    try {
      guardDemoReadOnly(user);
      const payload = { ...costruisciPayload(), updatedAt: versioneRef.current };
      const url = effectiveSegnalazioneId ? `/api/segnalazioni/${effectiveSegnalazioneId}` : "/api/segnalazioni";
      const method = effectiveSegnalazioneId ? "PUT" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : ERRORE_GENERICO);
      if (typeof data.segnalazione?.id !== "string") {
        throw new Error("Risposta incompleta: verifica la bozza nell'elenco prima di riprovare.");
      }
      // Traccia l'ID della segnalazione appena creata per consentire
      // l'upload di allegati senza uscire dalla pagina.
      if (!effectiveSegnalazioneId) {
        setCreatedId(data.segnalazione.id);
      }
      versioneRef.current = data.segnalazione.updatedAt;
      setFirmaSalvata(firmaInviata);
      setUltimoSalvataggio(new Date());
      setStatoSalvataggio("salvato");
      if (!silenzioso) {
        toast({ title: "Bozza salvata", description: "Puoi continuare a modificarla o inviarla al referente." });
      }
      if (esci) onSaved(data.segnalazione.id);
    } catch (e) {
      setStatoSalvataggio("errore");
      if (!silenzioso) {
        toast({
          title: "Salvataggio non riuscito",
          description: e instanceof Error && e.message ? e.message : ERRORE_GENERICO,
          variant: "destructive",
        });
      }
    } finally {
      salvataggioInCorsoRef.current = false;
      setSalvataggio(false);
    }
  }

  async function caricaAllegato(file: File) {
    if (isDemoSession(user)) {
      toast({ title: "Azione non disponibile", description: DEMO_READONLY_MESSAGE, variant: "destructive" });
      return;
    }
    if (!effectiveSegnalazioneId) {
      toast({
        title: "Salva prima la bozza",
        description: "Salva la segnalazione prima di caricare allegati",
        variant: "destructive",
      });
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
      const res = await fetch("/api/upload", {
        method: "POST",
        body: formData,
        headers: versioneRef.current ? { "If-Match": JSON.stringify(versioneRef.current) } : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: "Caricamento allegato non riuscito",
          description: typeof data.error === "string" ? data.error : ERRORE_GENERICO,
          variant: "destructive",
        });
        return;
      }
      if (!data.allegato || typeof data.allegato.id !== "string") throw new Error("Risposta allegato incompleta");
      versioneRef.current = data.updatedAt ?? versioneRef.current;
      setAllegati((prev) => [...prev, data.allegato]);
      toast({ title: "Allegato caricato" });
    } catch {
      toast({
        title: "Connessione non riuscita",
        description: "Verifica la connessione e riprova.",
        variant: "destructive",
      });
    }
  }

  async function eliminaAllegato(id: string) {
    setAllegatoDaEliminare(null);
    if (isDemoSession(user)) {
      toast({ title: "Azione non disponibile", description: DEMO_READONLY_MESSAGE, variant: "destructive" });
      return;
    }
    // Verifica la risposta prima di aggiornare lo stato locale: se l'API
    // fallisce, l'allegato resta nella UI.
    try {
      const res = await fetch(`/api/allegati?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: versioneRef.current ? { "If-Match": JSON.stringify(versioneRef.current) } : undefined,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Eliminazione non riuscita",
          description: typeof data.error === "string" ? data.error : ERRORE_GENERICO,
          variant: "destructive",
        });
        return;
      }
      const esito = await res.json().catch(() => ({}));
      versioneRef.current = esito.updatedAt ?? versioneRef.current;
      setAllegati((prev) => prev.filter((a) => a.id !== id));
      toast({ title: "Allegato eliminato" });
    } catch {
      toast({
        title: "Connessione non riuscita",
        description: "Verifica la connessione e riprova.",
        variant: "destructive",
      });
    }
  }

  // Focus sul contenuto del passo dopo ogni cambio di passo (non al primo caricamento).
  useEffect(() => {
    if (!passoMontato.current) {
      passoMontato.current = true;
      return;
    }
    contenutoPassoRef.current?.focus();
  }, [passo]);

  // Il focus va al riepilogo errori quando compare un nuovo errore.
  useEffect(() => {
    if (errori.indirizzo) riepilogoErroriRef.current?.focus();
  }, [errori]);

  // Baseline delle modifiche: la prima firma valida è quella dei dati caricati.
  useEffect(() => {
    if (!caricamento && !erroreCaricamento && firmaSalvata === null && effectiveSegnalazioneId) {
      setFirmaSalvata(firmaPayload);
    }
  }, [caricamento, erroreCaricamento, firmaSalvata, effectiveSegnalazioneId, firmaPayload]);

  // Auto-salvataggio: attivo solo per bozze già salvate sul server, così la sola
  // apertura di un form precompilato (es. recidiva) non crea bozze da sola.
  useEffect(() => {
    if (caricamento || erroreCaricamento || salvataggio || statoSalvataggio === "errore" || isDemoSession(user)) return;
    if (!effectiveSegnalazioneId || firmaSalvata === null || firmaPayload === firmaSalvata) return;
    if (!indirizzoVia.trim() || !comuneId) return;
    const timer = setTimeout(() => {
      void salva(false, true);
    }, RITARDO_AUTOSALVATAGGIO_MS);
    return () => clearTimeout(timer);
    // salva() ricrea le sue dipendenze a ogni render: il timer si riavvia solo quando cambiano i dati.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    caricamento,
    erroreCaricamento,
    statoSalvataggio,
    salvataggio,
    effectiveSegnalazioneId,
    firmaSalvata,
    firmaPayload,
    indirizzoVia,
    comuneId,
    user,
  ]);

  function vaiAlPasso(indice: number) {
    const bersaglio = PASSI_FORM[Math.max(0, Math.min(indice, PASSI_FORM.length - 1))];
    if (bersaglio && bersaglio.id !== passo) setPasso(bersaglio.id);
  }

  const indicePasso = PASSI_FORM.findIndex((p) => p.id === passo);

  function passoSuccessivo() {
    if (passo === "luogo" && !indirizzoVia.trim()) {
      mostraErroreIndirizzo();
      return;
    }
    vaiAlPasso(indicePasso + 1);
  }

  const modificheNonSalvate = firmaSalvata !== null && firmaPayload !== firmaSalvata;
  const testoStatoSalvataggio =
    statoSalvataggio === "in_corso"
      ? "Salvataggio in corso…"
      : statoSalvataggio === "errore"
        ? "Salvataggio non riuscito. Usa Salva per riprovare."
        : modificheNonSalvate
          ? "Modifiche non salvate."
          : ultimoSalvataggio
            ? `Bozza salvata alle ${ultimoSalvataggio.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: FUSO_ORARIO_UI })}.`
            : "";

  if (caricamento) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-muted-foreground">Caricamento…</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col items-start gap-1">
        <Button variant="ghost" size="sm" className="-ml-3" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Indietro
        </Button>
        <h1 className="text-2xl font-bold">{segnalazioneId ? "Modifica segnalazione" : "Nuova segnalazione"}</h1>
      </div>

      {erroreCaricamento && (
        <p role="alert" className="text-sm text-destructive">
          Impossibile caricare la segnalazione. Torna al dettaglio e ricarica prima di modificarla.
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        I campi contrassegnati con <span aria-hidden="true">*</span>
        <span className="sr-only">un asterisco</span> sono obbligatori.
      </p>

      <nav aria-label="Passi della segnalazione">
        <ol className="grid grid-cols-3 gap-2">
          {PASSI_FORM.map((p, indice) => (
            <li key={p.id}>
              <button
                type="button"
                aria-current={p.id === passo ? "step" : undefined}
                onClick={() => vaiAlPasso(indice)}
                className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  p.id === passo ? "border-primary bg-primary/10 font-semibold" : "border-border hover:bg-accent/30"
                }`}
              >
                <span className="block text-muted-foreground">
                  Passo {indice + 1} di {PASSI_FORM.length}
                </span>
                {p.etichetta}
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {errori.indirizzo && (
        <div
          ref={riepilogoErroriRef}
          tabIndex={-1}
          role="alert"
          className="rounded-md border border-rose-500/50 bg-rose-50 p-4 text-sm focus:outline-none dark:bg-rose-950/50"
        >
          <p className="font-medium text-rose-900 dark:text-rose-100">Correggi l&apos;errore per continuare</p>
          <ul className="mt-2 list-disc pl-5">
            <li>
              <button
                type="button"
                className="text-left underline underline-offset-2"
                onClick={() => document.getElementById("indirizzo")?.focus()}
              >
                {errori.indirizzo}
              </button>
            </li>
          </ul>
        </div>
      )}

      {segnalazionePrecedente && (
        <div className="p-4 rounded-md border border-amber-500/50 bg-amber-50 dark:bg-amber-950/50 text-sm">
          <p className="font-medium text-amber-900 dark:text-amber-100">Segnalazione collegata per recidiva</p>
          <p className="text-muted-foreground mt-1">
            Questa è la segnalazione di livello {segnalazionePrecedente.livelloRecidiva + 1} per la pratica{" "}
            {segnalazionePrecedente.numeroProtocollo ?? "senza protocollo"} ({segnalazionePrecedente.indirizzoVia}). I
            campi del luogo sono stati precompilati con quelli della segnalazione precedente.
          </p>
        </div>
      )}

      <div ref={contenutoPassoRef} tabIndex={-1} className="space-y-6 focus:outline-none">
        <div hidden={passo !== "luogo"}>
          {/* 1. Luogo */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MapPin className="w-5 h-5" /> Luogo della segnalazione
              </CardTitle>
              <CardDescription>
                Indica dove si trova l&apos;impianto non conforme. Puoi usare il GPS o inserire l&apos;indirizzo
                manualmente.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="indirizzo">Indirizzo *</Label>
                  <Input
                    id="indirizzo"
                    value={indirizzoVia}
                    onChange={(e) => {
                      setIndirizzoVia(e.target.value);
                      if (errori.indirizzo && e.target.value.trim()) setErrori({});
                    }}
                    placeholder="Via, numero civico"
                    required
                    aria-invalid={errori.indirizzo ? true : undefined}
                    aria-describedby={errori.indirizzo ? "errore-indirizzo" : undefined}
                  />
                  {errori.indirizzo && (
                    <p id="errore-indirizzo" className="text-sm text-rose-800 dark:text-rose-200">
                      {errori.indirizzo}
                    </p>
                  )}
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
                <Label htmlFor="cerca-comune">Comune</Label>
                <Input
                  id="cerca-comune"
                  placeholder="Cerca comune..."
                  value={searchComune}
                  onChange={(e) => setSearchComune(e.target.value)}
                  className="mb-2"
                />
                <div className="max-h-48 overflow-y-auto border rounded-md">
                  {comuni.length === 0 ? (
                    <div className="p-3 text-sm text-muted-foreground text-center">
                      {searchComune.trim() ? (
                        <>Nessun comune trovato per &quot;{searchComune.trim()}&quot;.</>
                      ) : (
                        "Nessun comune disponibile."
                      )}
                    </div>
                  ) : (
                    <ul className="divide-y">
                      {comuni.slice(0, 30).map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            aria-pressed={comuneId === c.id}
                            className={`w-full text-left p-2 cursor-pointer hover:bg-accent/30 text-sm ${
                              comuneId === c.id ? "bg-primary/20" : ""
                            }`}
                            onClick={() => {
                              setComuneId(c.id);
                              // Traccia esplicitamente il comune selezionato:
                              // quando l'utente cerca un altro comune, il
                              // filtering di `comuni` non azzererà la selezione.
                              setComuneSelezionato(c);
                              precompilaDaComune(c);
                              setSearchComune("");
                            }}
                          >
                            <span className="font-medium">{c.nome}</span>
                            <span className="text-muted-foreground">
                              , {c.cap} ({c.provincia.sigla})
                            </span>
                            {c.nomeSindaco && (
                              <span className="text-xs text-muted-foreground">, Sindaco: {c.nomeSindaco}</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {comuneSelezionato && comuneSelezionato.id === comuneId && (
                  <div className="text-sm text-muted-foreground mt-2 p-2 bg-accent/20 rounded">
                    <strong>Comune selezionato:</strong> {comuneSelezionato.nome} ({comuneSelezionato.provincia.sigla}
                    ), {comuneSelezionato.provincia.regione.regione}
                    <br />
                    <strong>Riferimento legge:</strong> {comuneSelezionato.provincia.regione.riferimentoLegge}
                    <br />
                    {comuneSelezionato.pecComune ? (
                      <>
                        <strong>PEC Comune:</strong> {comuneSelezionato.pecComune}
                      </>
                    ) : (
                      <span className="text-amber-900 dark:text-amber-100">
                        <strong>PEC Comune:</strong> non ancora configurata. L&apos;invio resta bloccato finché un
                        amministratore non la inserisce.
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="grid sm:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="cap">CAP</Label>
                  <Input
                    id="cap"
                    value={cap}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={5}
                    pattern="[0-9]{5}"
                    placeholder="es. 20121"
                    onChange={(e) => setCap(e.target.value.replace(/\D/g, "").slice(0, 5))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lat">Latitudine</Label>
                  <Input
                    id="lat"
                    type="number"
                    step="any"
                    value={latitudine ?? ""}
                    onChange={(e) => setLatitudine(e.target.value ? Number(e.target.value) : null)}
                    placeholder="es. 45.464211"
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
                    placeholder="es. 9.190347"
                  />
                </div>
              </div>

              <Button type="button" variant="outline" size="sm" onClick={rilevaGPS} disabled={gpsLoading}>
                <Crosshair className="w-4 h-4 mr-1" /> {gpsLoading ? "Rilevazione in corso…" : "Rileva posizione GPS"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <div hidden={passo !== "conformita"}>
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
                <Checkbox id="chk2" checked={chkVetroCurvo} onCheckedChange={(v) => setChkVetroCurvo(!!v)} />
                <Label htmlFor="chk2" className="cursor-pointer text-sm leading-snug">
                  Apparecchi a dispersione libera o a chiusura sporgente (vetro curvo o vetri laterali)
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox id="chk3" checked={chkAltroTipologia} onCheckedChange={(v) => setChkAltroTipologia(!!v)} />
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
                <Checkbox id="chk4" checked={chkLuceVersoAlto} onCheckedChange={(v) => setChkLuceVersoAlto(!!v)} />
                <Label htmlFor="chk4" className="cursor-pointer text-sm leading-snug">
                  Emissione di luce verso l&apos;alto
                </Label>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox id="chk5" checked={chkAbbagliamento} onCheckedChange={(v) => setChkAbbagliamento(!!v)} />
                <div className="space-y-1">
                  <Label htmlFor="chk5" className="cursor-pointer text-sm leading-snug">
                    Elevati fenomeni di abbagliamento e pericolo per il traffico pedonale e stradale
                  </Label>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer underline underline-offset-2">Riferimento normativo</summary>
                    <p className="mt-1">Vietati anche ai sensi dell&apos;art. 23 del Codice della Strada.</p>
                  </details>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox id="chk6" checked={chkLuceIntrusiva} onCheckedChange={(v) => setChkLuceIntrusiva(!!v)} />
                <div className="space-y-1">
                  <Label htmlFor="chk6" className="cursor-pointer text-sm leading-snug">
                    Luce intrusiva nei fondi e aree private
                  </Label>
                  <details className="text-xs text-muted-foreground">
                    <summary className="cursor-pointer underline underline-offset-2">Riferimento normativo</summary>
                    <p className="mt-1">Non ammessa ai sensi del Codice Civile, art. 844.</p>
                  </details>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Checkbox id="chk7" checked={chkAltroProblema} onCheckedChange={(v) => setChkAltroProblema(!!v)} />
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
        </div>

        <div hidden={passo !== "allegati"}>
          {/* 5. Allegati */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Camera className="w-5 h-5" /> Allegati
              </CardTitle>
              <CardDescription>
                Fino a {MAX_ALLEGATI_PER_SEGNALAZIONE} foto o documenti a supporto della segnalazione. Formati
                accettati: JPG, PNG, WebP, PDF. Dimensione massima {MAX_ALLEGATO_BYTE / (1024 * 1024)} MB per file.
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
                      <Badge variant="outline">{ETICHETTA_TIPO_ALLEGATO[a.tipo] ?? a.tipo}</Badge>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Elimina allegato ${a.nomeOriginale}`}
                        onClick={() => setAllegatoDaEliminare({ id: a.id, nome: a.nomeOriginale })}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" aria-hidden="true" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {allegati.length < MAX_ALLEGATI_PER_SEGNALAZIONE ? (
                <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-md cursor-pointer hover:border-primary/50 hover:bg-accent/20 text-sm focus-within:ring-2 focus-within:ring-ring">
                  <Upload className="w-4 h-4" aria-hidden="true" />
                  <span>Carica allegato (massimo {MAX_ALLEGATI_PER_SEGNALAZIONE})</span>
                  <input
                    type="file"
                    className="sr-only"
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
                  Hai raggiunto il limite di {MAX_ALLEGATI_PER_SEGNALAZIONE} allegati. Elimina un allegato per caricarne
                  un altro.
                </p>
              )}
            </CardContent>
          </Card>

          {user.ruolo !== "volontario" && (
            <>
              {/* 4. Personalizzazione invio */}
              <Card>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-xl p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    <span className="space-y-1.5">
                      <span className="block font-semibold leading-none">Personalizzazione invio PEC (avanzata)</span>
                      <span className="block text-sm text-muted-foreground">
                        Dati della lettera, precompilati dal comune selezionato. Modificali solo se necessario.
                      </span>
                    </span>
                    <ChevronDown
                      className="mt-0.5 size-5 shrink-0 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                  </summary>
                  <CardContent className="space-y-4 pt-0">
                    <div className="space-y-2">
                      <Label htmlFor="dest">Destinatario</Label>
                      <Input
                        id="dest"
                        value={destinatarioNome}
                        onChange={(e) => setDestinatarioNome(e.target.value)}
                        placeholder="Es. Sindaco o ufficio protocollo"
                      />
                    </div>
                    <div className="flex items-center justify-between p-3 rounded-md bg-accent/20">
                      <div>
                        <Label htmlFor="includi-arpa" className="font-medium text-sm">
                          Includi ARPA regionale in copia
                        </Label>
                        <div className="text-xs text-muted-foreground">
                          Aggiunge l&apos;indirizzo PEC dell&apos;ARPA regionale tra i destinatari
                        </div>
                      </div>
                      <Switch id="includi-arpa" checked={includiArpa} onCheckedChange={setIncludiArpa} />
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
                        Le PEC non permettono la copia nascosta: inserisci ogni destinatario tra A o Cc.
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="ogg">Oggetto PEC</Label>
                      <Input id="ogg" value={oggettoPec} onChange={(e) => setOggettoPec(e.target.value)} />
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
                        <Label htmlFor="mittente-visibile" className="font-medium text-sm">
                          Mittente: {mittenteVisibile ? "volontario" : "referente CieloBuio"}
                        </Label>
                        <div className="text-xs text-muted-foreground">
                          Se attivo, la lettera parte a nome del volontario segnalatore (con i suoi dati anagrafici). Se
                          disattivato, parte a nome del referente CieloBuio. La decisione va concordata con il direttivo
                          caso per caso.
                        </div>
                      </div>
                      <Switch id="mittente-visibile" checked={mittenteVisibile} onCheckedChange={setMittenteVisibile} />
                    </div>
                  </CardContent>
                </details>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Navigazione tra i passi e salvataggio */}
      <div className="space-y-3 pb-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button variant="outline" onClick={() => vaiAlPasso(indicePasso - 1)} disabled={indicePasso === 0}>
            Passo precedente
          </Button>
          {indicePasso < PASSI_FORM.length - 1 && <Button onClick={passoSuccessivo}>Continua</Button>}
        </div>
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground min-h-5">
          {testoStatoSalvataggio}
        </p>
        <p className="text-sm text-muted-foreground">
          Il salvataggio non invia nulla: la bozza resta modificabile. Per inviarla al referente territoriale, apri il
          dettaglio della segnalazione e usa il pulsante &quot;Invia in revisione&quot;.
        </p>
        <div className="flex flex-wrap gap-3 justify-end">
          <Button variant="outline" onClick={onBack}>
            Annulla
          </Button>
          <Button
            variant="secondary"
            onClick={() => salva(false)}
            disabled={salvataggio || erroreCaricamento || caricamento}
          >
            <Save className="w-4 h-4 mr-1" /> Salva bozza
          </Button>
          <Button onClick={() => salva(true)} disabled={salvataggio || erroreCaricamento || caricamento}>
            <Save className="w-4 h-4 mr-1" /> Salva ed esci alla lista
          </Button>
        </div>
      </div>
      {/* Conferma eliminazione allegato */}
      <Dialog open={allegatoDaEliminare !== null} onOpenChange={(aperto) => !aperto && setAllegatoDaEliminare(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Eliminare l&apos;allegato?</DialogTitle>
            <DialogDescription>
              &quot;{allegatoDaEliminare?.nome}&quot; verrà rimosso dalla segnalazione e non potrà essere recuperato.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAllegatoDaEliminare(null)}>
              Annulla
            </Button>
            <Button
              variant="destructive"
              onClick={() => allegatoDaEliminare && eliminaAllegato(allegatoDaEliminare.id)}
            >
              Elimina allegato
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
