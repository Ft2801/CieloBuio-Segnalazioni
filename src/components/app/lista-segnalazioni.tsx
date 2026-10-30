"use client";

/**
 * Elenco delle segnalazioni con filtro per stato, ricerca testuale e
 * esportazione CSV. Autore: Fabio Tempera (2026)
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, FileText, Download, AlertTriangle, RotateCcw, Plus } from "lucide-react";
import type { Segnalazione, StatoSegnalazione, SessionUser } from "@/lib/types";
import { STATI_SEGNALAZIONE, labelStato, coloreStato } from "@/lib/types";
import { isDemoSession } from "@/lib/demo-mode";
import { DEMO_SEGNALAZIONI } from "@/lib/demo-data";
import { FUSO_ORARIO_UI, formatData, plurale } from "@/lib/format";
import { useToast } from "@/hooks/use-toast";
import { LinkVista } from "./link-vista";

const LIMITE_PAGINA = 50;

function parametriRicerca(stato: StatoSegnalazione | "all", ricerca: string, extra: Record<string, string> = {}) {
  const params = new URLSearchParams();
  if (stato !== "all") params.set("stato", stato);
  if (ricerca.trim()) params.set("search", ricerca.trim());
  for (const [k, v] of Object.entries(extra)) params.set(k, v);
  return params;
}

/** Titolo della pratica: nome dell'esercizio se presente, altrimenti l'indirizzo. */
function titoloPratica(s: Segnalazione): string {
  return s.nomeEsercizio || s.indirizzoVia;
}

/**
 * Luogo su una riga. Se l'indirizzo è già il titolo, la riga mostra solo comune e provincia,
 * così il testo non ripete lo stesso indirizzo.
 */
function luogoPratica(s: Segnalazione): string {
  const comuneProvincia = `${s.comune?.nome ?? ""}${s.provincia ? ` (${s.provincia.sigla})` : ""}`;
  if (!s.nomeEsercizio) return comuneProvincia;
  return [s.indirizzoVia, comuneProvincia].filter(Boolean).join(", ");
}

/** Numero di allegati della pratica; zero se il conteggio non è incluso nella risposta. */
function allegatiDi(s: Segnalazione): number {
  return s._count?.allegati ?? 0;
}

function BadgeStato({ stato }: { stato: StatoSegnalazione }) {
  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium ring-1 ring-inset whitespace-nowrap ${coloreStato(stato)}`}
    >
      {labelStato(stato)}
    </span>
  );
}

export function ListaSegnalazioni({
  user,
  filtroStatoIniziale,
  onApriDettaglio,
  onNuovaSegnalazione,
}: {
  user: SessionUser;
  filtroStatoIniziale?: StatoSegnalazione | "all";
  onApriDettaglio: (id: string) => void;
  onNuovaSegnalazione: () => void;
}) {
  const { toast } = useToast();
  const [segnalazioni, setSegnalazioni] = useState<Segnalazione[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [errore, setErrore] = useState(false);
  const [caricamentoAltro, setCaricamentoAltro] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [stato, setStato] = useState<StatoSegnalazione | "all">(filtroStatoIniziale ?? "all");
  const [search, setSearch] = useState("");
  // Debounce di 300 ms sulla ricerca: evita una richiesta per ogni carattere.
  const [debouncedSearch, setDebouncedSearch] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Token della richiesta più recente: una risposta arrivata in ritardo non
  // deve sovrascrivere i risultati di un filtro successivo.
  const reqIdRef = useRef(0);

  const carica = useCallback(async () => {
    const myReqId = ++reqIdRef.current;
    setCaricamento(true);
    setErrore(false);
    if (isDemoSession(user)) {
      // Dati statici incorporati nel bundle: nessuna richiesta di rete.
      let risultati = DEMO_SEGNALAZIONI;
      if (stato !== "all") risultati = risultati.filter((s) => s.stato === stato);
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.trim().toLowerCase();
        risultati = risultati.filter(
          (s) =>
            s.indirizzoVia.toLowerCase().includes(q) ||
            (s.numeroProtocollo ?? "").toLowerCase().includes(q) ||
            (s.comune?.nome ?? "").toLowerCase().includes(q),
        );
      }
      setSegnalazioni(risultati);
      setHasMore(false);
      setTotal(risultati.length);
      setCaricamento(false);
      return;
    }
    try {
      const params = parametriRicerca(stato, debouncedSearch, {
        limit: String(LIMITE_PAGINA),
        offset: "0",
      });
      const res = await fetch(`/api/segnalazioni?${params}`);
      if (myReqId !== reqIdRef.current) return;
      if (!res.ok) {
        setSegnalazioni([]);
        setHasMore(false);
        setTotal(0);
        setErrore(true);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (myReqId !== reqIdRef.current) return;
      setSegnalazioni(data.segnalazioni ?? []);
      setHasMore(data.pagination?.hasMore ?? false);
      setTotal(data.pagination?.total ?? 0);
    } catch {
      if (myReqId !== reqIdRef.current) return;
      setSegnalazioni([]);
      setHasMore(false);
      setTotal(0);
      setErrore(true);
    } finally {
      // Solo l'ultima richiesta sblocca lo stato di caricamento.
      if (myReqId === reqIdRef.current) {
        setCaricamento(false);
      }
    }
  }, [stato, debouncedSearch, user]);

  useEffect(() => {
    carica();
  }, [carica]);

  async function caricaAltre() {
    setCaricamentoAltro(true);
    const myReqId = ++reqIdRef.current;
    try {
      const params = parametriRicerca(stato, debouncedSearch, {
        limit: String(LIMITE_PAGINA),
        offset: String(segnalazioni.length),
      });
      const res = await fetch(`/api/segnalazioni?${params}`);
      if (myReqId !== reqIdRef.current) return;
      if (!res.ok) {
        setHasMore(false);
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (myReqId !== reqIdRef.current) return;
      setSegnalazioni((prev) => [...prev, ...(data.segnalazioni ?? [])]);
      setHasMore(data.pagination?.hasMore ?? false);
    } catch {
      if (myReqId !== reqIdRef.current) return;
      setHasMore(false);
    } finally {
      // Il flag riguarda solo questa richiesta: va sempre azzerato, anche se nel
      // frattempo una ricerca più recente ha cambiato il token.
      setCaricamentoAltro(false);
    }
  }

  async function esporta() {
    if (isDemoSession(user)) {
      toast({
        title: "Esportazione non disponibile",
        description: "L'esportazione richiede un account attivo.",
        variant: "destructive",
      });
      return;
    }
    try {
      const params = parametriRicerca(stato, debouncedSearch);
      const res = await fetch(`/api/segnalazioni/export?${params}`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Esportazione non riuscita",
          description: data.error ?? "Riprova tra qualche minuto.",
          variant: "destructive",
        });
        return;
      }
      // Download diretto del file: nessuna scheda vuota aperta in caso di errore.
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      // Data del giorno nel fuso dell'app (YYYY-MM-DD), non in UTC.
      const oggi = new Date().toLocaleDateString("sv-SE", { timeZone: FUSO_ORARIO_UI });
      link.download = `segnalazioni-${oggi}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast({
        title: "Esportazione non riuscita",
        description: "Verifica la connessione e riprova.",
        variant: "destructive",
      });
    }
  }

  const vistaDettaglio = (id: string) => ({ name: "dettaglio" as const, id });
  const apriDettaglio = (id: string) => onApriDettaglio(id);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Segnalazioni</h1>
          {!caricamento && !errore && (
            <p className="text-sm text-muted-foreground mt-0.5" aria-live="polite">
              {plurale(total, "segnalazione trovata", "segnalazioni trovate")}
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none"
              aria-hidden="true"
            />
            <Input
              type="search"
              aria-label="Cerca per indirizzo, protocollo o comune"
              placeholder="Cerca indirizzo, protocollo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-full sm:w-64"
            />
          </div>
          <Select value={stato} onValueChange={(v) => setStato(v as StatoSegnalazione | "all")}>
            <SelectTrigger className="w-full sm:w-52" aria-label="Filtra per stato">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti gli stati</SelectItem>
              {STATI_SEGNALAZIONE.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={esporta} aria-label="Esporta in CSV" title="Esporta in CSV">
            <Download className="w-4 h-4" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {caricamento ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground" role="status">
            Caricamento in corso…
          </CardContent>
        </Card>
      ) : errore ? (
        <Card className="border-rose-500/50 bg-rose-50 dark:bg-rose-950/50">
          <CardContent className="text-center">
            <AlertTriangle className="w-10 h-10 mx-auto text-rose-700 dark:text-rose-300 mb-3" aria-hidden="true" />
            <p className="font-medium text-rose-900 dark:text-rose-100 mb-1">Impossibile caricare le segnalazioni</p>
            <p className="text-sm text-muted-foreground mb-4">Verifica la connessione e riprova.</p>
            <Button variant="outline" onClick={carica} className="gap-2">
              <RotateCcw className="w-4 h-4" aria-hidden="true" /> Riprova
            </Button>
          </CardContent>
        </Card>
      ) : segnalazioni.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-3" aria-hidden="true" />
            <p className="text-muted-foreground mb-4">Nessuna segnalazione trovata con i filtri selezionati.</p>
            <Button onClick={onNuovaSegnalazione}>
              <Plus className="w-4 h-4" aria-hidden="true" /> Crea una nuova segnalazione
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Desktop: tabella con intestazioni, una pratica per riga. */}
          <div className="hidden md:block overflow-x-auto rounded-xl border bg-card">
            <table className="w-full text-sm">
              <caption className="sr-only">Elenco delle segnalazioni</caption>
              <thead className="bg-muted/50 text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Stato
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Pratica
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Luogo
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium whitespace-nowrap">
                    Data
                  </th>
                  <th scope="col" className="px-4 py-2.5 font-medium">
                    Volontario
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {segnalazioni.map((s) => (
                  <tr key={s.id} className="hover:bg-accent/40">
                    <td className="px-4 py-3 align-top">
                      <BadgeStato stato={s.stato} />
                      {s.livelloRecidiva > 1 && (
                        <Badge variant="destructive" className="ml-1 text-xs">
                          Recidiva {s.livelloRecidiva}
                        </Badge>
                      )}
                    </td>
                    <th scope="row" className="px-4 py-3 align-top font-normal text-left">
                      <LinkVista
                        vista={vistaDettaglio(s.id)}
                        onNavigate={() => apriDettaglio(s.id)}
                        className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                      >
                        {titoloPratica(s)}
                      </LinkVista>
                      {s.numeroProtocollo && (
                        <div className="font-mono text-xs text-muted-foreground mt-0.5">{s.numeroProtocollo}</div>
                      )}
                      {allegatiDi(s) > 0 && (
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {plurale(allegatiDi(s), "allegato", "allegati")}
                        </div>
                      )}
                    </th>
                    <td className="px-4 py-3 align-top text-muted-foreground">{luogoPratica(s)}</td>
                    <td className="px-4 py-3 align-top whitespace-nowrap">{formatData(s.dataSegnalazione)}</td>
                    <td className="px-4 py-3 align-top">{s.volontario?.nomeCognome ?? "n/d"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: schede compatte, stesse informazioni in ordine di lettura. */}
          <ul className="md:hidden space-y-2">
            {segnalazioni.map((s) => (
              <li key={s.id}>
                <LinkVista
                  vista={vistaDettaglio(s.id)}
                  onNavigate={() => apriDettaglio(s.id)}
                  className="block rounded-xl border bg-card p-4 hover:border-primary/50 hover:bg-accent/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <BadgeStato stato={s.stato} />
                    {s.livelloRecidiva > 1 && (
                      <Badge variant="destructive" className="text-xs">
                        Recidiva {s.livelloRecidiva}
                      </Badge>
                    )}
                  </div>
                  <div className="mt-2 font-medium break-words">{titoloPratica(s)}</div>
                  <div className="text-sm text-muted-foreground break-words">{luogoPratica(s)}</div>
                  <div className="mt-2 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {s.numeroProtocollo && <span className="font-mono">{s.numeroProtocollo}</span>}
                    {allegatiDi(s) > 0 && <span>{plurale(allegatiDi(s), "allegato", "allegati")}</span>}
                    <span>{formatData(s.dataSegnalazione)}</span>
                    <span>{s.volontario?.nomeCognome ?? "n/d"}</span>
                  </div>
                </LinkVista>
              </li>
            ))}
          </ul>
        </>
      )}

      {!caricamento && hasMore && (
        <div className="text-center py-4">
          <Button variant="outline" onClick={caricaAltre} disabled={caricamentoAltro}>
            {caricamentoAltro ? "Caricamento…" : `Carica altre (visualizzate ${segnalazioni.length} di ${total})`}
          </Button>
        </div>
      )}

      {!caricamento && !hasMore && segnalazioni.length > 0 && (
        <p className="text-xs text-center text-muted-foreground py-2">
          {segnalazioni.length === total
            ? plurale(total, "segnalazione", "segnalazioni")
            : `${segnalazioni.length} di ${total} segnalazioni caricate`}
        </p>
      )}
    </div>
  );
}
