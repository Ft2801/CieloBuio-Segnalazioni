"use client";

/**
 * Lista delle segnalazioni con filtri per stato e ricerca testuale.
 * Autore: Fabio Tempera (2026)
 */

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, FileText, MapPin, Calendar, User, ChevronRight, Download } from "lucide-react";
import type { Segnalazione, StatoSegnalazione, SessionUser } from "@/lib/types";
import { STATI_SEGNALAZIONE, labelStato, coloreStato } from "@/lib/types";
import { isDemoSession } from "@/lib/demo-mode";
import { DEMO_SEGNALAZIONI } from "@/lib/demo-data";

export function ListaSegnalazioni({
  user,
  filtroStatoIniziale,
  onApriDettaglio,
  onNavigate,
}: {
  user: SessionUser;
  filtroStatoIniziale?: StatoSegnalazione | "all";
  onApriDettaglio: (id: string) => void;
  onNavigate?: (vista: string) => void;
}) {
  const [segnalazioni, setSegnalazioni] = useState<Segnalazione[]>([]);
  const [caricamento, setCaricamento] = useState(true);
  const [caricamentoAltro, setCaricamentoAltro] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const [stato, setStato] = useState<StatoSegnalazione | "all">(filtroStatoIniziale ?? "all");
  const [search, setSearch] = useState("");
  // Debounce di 300ms sulla ricerca per evitare un fetch per ogni
  // carattere digitato (saturazione del server su dataset grandi).
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(search);
    }, 300);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [search]);

  const LIMIT = 50;
  // Token di "latest request" per gestire la concorrenza delle fetch:
  // quando l'utente cambia filtro rapidamente, una fetch precedente
  // potrebbe completarsi dopo quella più recente e sovrascrivere i
  // risultati aggiornati con risultati non più pertinenti. Incrementiamo
  // il token prima di ogni fetch e scartiamo i risultati se il token non
  // corrisponde più a quello atteso.
  const reqIdRef = useRef(0);

  const carica = useCallback(async () => {
    const myReqId = ++reqIdRef.current;
    setCaricamento(true);
    if (isDemoSession(user)) {
      // Modalità demo: filtra i dati statici incorporati nel bundle,
      // nessuna richiesta di rete. Funziona anche a server spento.
      let risultati = DEMO_SEGNALAZIONI;
      if (stato !== "all") risultati = risultati.filter((s) => s.stato === stato);
      if (debouncedSearch.trim()) {
        const q = debouncedSearch.trim().toLowerCase();
        risultati = risultati.filter(
          (s) =>
            s.indirizzoVia.toLowerCase().includes(q) ||
            (s.numeroProtocollo ?? "").toLowerCase().includes(q) ||
            (s.comune?.nome ?? "").toLowerCase().includes(q)
        );
      }
      // In demo non ci sono race reali, ma rispettiamo comunque il token.
      if (myReqId !== reqIdRef.current) return;
      setSegnalazioni(risultati);
      setHasMore(false);
      setTotal(risultati.length);
      setCaricamento(false);
      return;
    }
    try {
      const params = new URLSearchParams();
      if (stato !== "all") params.set("stato", stato);
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      params.set("limit", String(LIMIT));
      params.set("offset", "0");
      const res = await fetch(`/api/segnalazioni?${params}`);
      // Scarta i risultati se nel frattempo è partita una fetch più recente.
      if (myReqId !== reqIdRef.current) return;
      if (!res.ok) {
        setSegnalazioni([]);
        setHasMore(false);
        setTotal(0);
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
    } finally {
      // Solo l'ultima fetch deve sbloccare il caricamento.
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
      const params = new URLSearchParams();
      if (stato !== "all") params.set("stato", stato);
      if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
      params.set("limit", String(LIMIT));
      params.set("offset", String(segnalazioni.length));
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
      if (myReqId === reqIdRef.current) {
        setCaricamentoAltro(false);
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold">Segnalazioni</h1>
        <div className="flex gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Cerca indirizzo, protocollo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 w-full sm:w-64"
            />
          </div>
          <Select value={stato} onValueChange={(v) => setStato(v as StatoSegnalazione | "all")}>
            <SelectTrigger className="w-44">
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
          <Button
            variant="outline"
            size="icon"
            onClick={() => {
              const params = new URLSearchParams();
              if (stato !== "all") params.set("stato", stato);
              if (debouncedSearch.trim()) params.set("search", debouncedSearch.trim());
              window.open(`/api/segnalazioni/export?${params}`, "_blank");
            }}
            aria-label="Esporta CSV"
            title="Esporta in CSV"
          >
            <Download className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {caricamento ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Caricamento in corso…
          </CardContent>
        </Card>
      ) : segnalazioni.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center">
            <FileText className="w-10 h-10 mx-auto text-muted-foreground mb-3" aria-hidden="true" />
            <p className="text-muted-foreground mb-4">Nessuna segnalazione trovata.</p>
            <Button onClick={() => onNavigate?.("nuova-segnalazione")}>
              <FileText className="w-4 h-4 mr-1" /> Crea una nuova segnalazione
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {segnalazioni.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer hover:border-primary/40 hover:bg-accent/20 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onApriDettaglio(s.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onApriDettaglio(s.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Apri dettaglio segnalazione ${s.numeroProtocollo ?? s.id}`}
            >
              <CardContent className="py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium text-white ${coloreStato(s.stato)}`}
                      >
                        {labelStato(s.stato)}
                      </span>
                      {s.numeroProtocollo && (
                        <Badge variant="outline" className="font-mono text-xs">
                          {s.numeroProtocollo}
                        </Badge>
                      )}
                      {s.livelloRecidiva > 1 && (
                        <Badge variant="destructive" className="text-xs">
                          Recidiva livello {s.livelloRecidiva}
                        </Badge>
                      )}
                    </div>
                    <div className="font-medium truncate">
                      {s.nomeEsercizio ?? s.indirizzoVia}
                    </div>
                    <div className="text-sm text-muted-foreground flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {s.indirizzoVia}
                      {s.comune ? `, ${s.comune.nome}` : ""}
                      {s.provincia ? ` (${s.provincia.sigla})` : ""}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {new Date(s.dataSegnalazione).toLocaleDateString("it-IT")}
                      </span>
                      <span className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        {s.volontario?.nomeCognome ?? "n/d"}
                      </span>
                      {s._count?.allegati && s._count.allegati > 0 && (
                        <span className="flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          {s._count.allegati} allegat{s._count.allegati === 1 ? "o" : "i"}
                        </span>
                      )}
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground flex-shrink-0 mt-1" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
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
            ? `${total} segnalazion${total === 1 ? "e" : "i"}`
            : `${segnalazioni.length} di ${total} segnalazioni caricate`}
        </p>
      )}
    </div>
  );
}
