import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Edit, Trash2 } from "lucide-react";
import type { SessionUser } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { formatData } from "@/lib/format";
import { guardDemoReadOnly, isDemoSession } from "@/lib/demo-mode";
import {
  ERRORE_GENERICO,
  ERRORE_CONNESSIONE,
  SEI_MESI_MS,
  ErroreCampo,
  attributiErrore,
  chiamaApi,
  useConferma,
  useErroriModulo,
} from "./condivisi";
import type { Provincia, Comune, ErroriCampi } from "./condivisi";

// ----------------------------------------------------------------
// Tab Comuni
// ----------------------------------------------------------------
export function ComuniTab({ toast, user }: { toast: ReturnType<typeof useToast>["toast"]; user: SessionUser }) {
  const conferma = useConferma();
  const [comuni, setComuni] = useState<Comune[]>([]);
  // Istante di riferimento per il controllo "verifica più vecchia di 6 mesi":
  // letto una sola volta al montaggio, così il render resta puro.
  const [adesso] = useState(() => Date.now());
  const [province, setProvince] = useState<Provincia[]>([]);
  const [search, setSearch] = useState("");
  // Debounce della ricerca comuni: la tabella comuni può avere 8000+
  // record in Italia, e una fetch per ogni keystroke saturerebbe il
  // server. Allineato al debounce di lista-segnalazioni (300ms).
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [dialog, setDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<{
    nome: string;
    provinciaId: string;
    cap: string;
    pecComune: string;
    nomeSindaco: string;
    noteAggiornamento: string;
  }>({
    nome: "",
    provinciaId: "",
    cap: "",
    pecComune: "",
    nomeSindaco: "",
    noteAggiornamento: "",
  });

  // Debounce 300ms su search: evita fetch multipli durante la digitazione.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const carica = useCallback(async () => {
    if (isDemoSession(user)) return; // In modalità demo non si caricano dati dal server.
    const url = debouncedSearch
      ? `/api/config/comuni?search=${encodeURIComponent(debouncedSearch)}`
      : "/api/config/comuni";
    // Esegue le 2 fetch in parallelo per ridurre la latenza
    const risposte = await Promise.all([fetch(url), fetch("/api/config/province")]).catch(() => null);
    if (!risposte) {
      toast(ERRORE_CONNESSIONE);
      return;
    }
    const [resComuni, resProvince] = risposte;
    const [dataComuni, dataProvince] = await Promise.all([
      resComuni.json().catch(() => ({})),
      resProvince.json().catch(() => ({})),
    ]);
    setComuni(dataComuni.comuni ?? []);
    setProvince(dataProvince.province ?? []);
  }, [user, debouncedSearch, toast]);
  useEffect(() => {
    carica();
  }, [carica]);

  function apriCrea() {
    setForm({ nome: "", provinciaId: "", cap: "", pecComune: "", nomeSindaco: "", noteAggiornamento: "" });
    setEditingId(null);
    setDialog(true);
  }

  function apriModifica(c: Comune) {
    setForm({
      nome: c.nome,
      provinciaId: String(c.provinciaId),
      cap: c.cap,
      pecComune: c.pecComune,
      nomeSindaco: c.nomeSindaco ?? "",
      noteAggiornamento: c.noteAggiornamento ?? "",
    });
    setEditingId(c.id);
    setDialog(true);
  }

  const { errori, segnala } = useErroriModulo(form);
  async function salva() {
    const campi: ErroriCampi = {};
    if (!form.nome) campi["campo-admin-16"] = "Inserisci il nome del comune.";
    if (!form.provinciaId) campi["campo-admin-17"] = "Scegli la provincia.";
    if (!form.cap) campi["campo-admin-18"] = "Inserisci il CAP.";
    if (!form.pecComune) campi["campo-admin-19"] = "Inserisci la PEC del Comune.";
    if (segnala(campi)) return;
    try {
      guardDemoReadOnly(user);
    } catch (e) {
      toast({
        title: "Azione non disponibile",
        description: e instanceof Error && e.message ? e.message : ERRORE_GENERICO,
        variant: "destructive",
      });
      return;
    }
    const url = editingId ? `/api/config/comuni/${editingId}` : "/api/config/comuni";
    const method = editingId ? "PUT" : "POST";
    const res = await chiamaApi(toast, url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Operazione non riuscita", description: data.error ?? ERRORE_GENERICO, variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Comune aggiornato" : "Comune creato" });
    setDialog(false);
    setForm({ nome: "", provinciaId: "", cap: "", pecComune: "", nomeSindaco: "", noteAggiornamento: "" });
    setEditingId(null);
    carica();
  }

  function elimina(id: number, nome: string) {
    conferma.chiedi(
      `Eliminare il comune «${nome}»? Non si può annullare. Il server blocca l'operazione se il comune ha segnalazioni collegate.`,
      () => void eliminaConfermata(id),
    );
  }

  async function eliminaConfermata(id: number) {
    try {
      guardDemoReadOnly(user);
    } catch (e) {
      toast({
        title: "Azione non disponibile",
        description: e instanceof Error && e.message ? e.message : ERRORE_GENERICO,
        variant: "destructive",
      });
      return;
    }
    const res = await chiamaApi(toast, `/api/config/comuni/${id}`, { method: "DELETE" });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Operazione non riuscita", description: data.error ?? ERRORE_GENERICO, variant: "destructive" });
      return;
    }
    toast({ title: "Comune eliminato" });
    carica();
  }

  return (
    <Card>
      {conferma.dialog}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Comuni</CardTitle>
          <CardDescription>
            Tabella più importante dopo le regioni: nome del sindaco e PEC vanno verificati periodicamente
          </CardDescription>
        </div>
        <Button size="sm" onClick={apriCrea}>
          <Plus className="w-4 h-4 mr-1" /> Nuovo
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <Input placeholder="Cerca comune..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card">
              <tr className="text-left border-b">
                <th scope="col" className="py-2 pr-2">
                  Comune
                </th>
                <th scope="col" className="py-2 pr-2">
                  Prov.
                </th>
                <th scope="col" className="py-2 pr-2">
                  CAP
                </th>
                <th scope="col" className="py-2 pr-2">
                  PEC
                </th>
                <th scope="col" className="py-2 pr-2">
                  Sindaco
                </th>
                <th scope="col" className="py-2 pr-2">
                  Verifica
                </th>
                <th scope="col" className="py-2 pr-2 text-center">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody>
              {comuni.map((c) => {
                // Verifica se il comune ha il dato del sindaco non verificato
                // da oltre 6 mesi. Validiamo esplicitamente che la stringa
                // sia una data ISO valida: noteAggiornamento è un campo
                // testuale libero, e `new Date(stringa-non-data).getTime()`
                // ritornerebbe NaN. In quel caso trattiamo il comune come
                // "da verificare" anziché come "verificato".
                const parsedDate = c.noteAggiornamento ? new Date(c.noteAggiornamento) : null;
                const isValidDate = parsedDate !== null && !isNaN(parsedDate.getTime());
                const noteDate = isValidDate ? (parsedDate as Date).getTime() : 0;
                const needsCheck =
                  !c.nomeSindaco || !c.noteAggiornamento || !isValidDate || adesso - noteDate > SEI_MESI_MS;
                return (
                  <tr key={c.id} className={`border-b hover:bg-accent/20 ${needsCheck ? "bg-amber-500/5" : ""}`}>
                    <td className="py-2 pr-2 font-medium">{c.nome}</td>
                    <td className="py-2 pr-2">{c.provincia?.sigla}</td>
                    <td className="py-2 pr-2">{c.cap}</td>
                    <td className="py-2 pr-2 text-xs">{c.pecComune}</td>
                    <td className="py-2 pr-2 text-xs">{c.nomeSindaco ?? "n/d"}</td>
                    <td className="py-2 pr-2 text-xs">
                      {needsCheck ? (
                        <span className="text-amber-700 dark:text-amber-300 font-medium">Da verificare</span>
                      ) : (
                        <span className="text-muted-foreground">{formatData(c.noteAggiornamento)}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-center">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Modifica ${c.nome}`}
                        onClick={() => apriModifica(c)}
                        className="h-7 w-7 p-0"
                      >
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Elimina ${c.nome}`}
                        onClick={() => elimina(c.id, c.nome)}
                        className="h-7 w-7 p-0"
                      >
                        <Trash2 className="w-3 h-3 text-destructive" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {comuni.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-muted-foreground">
                    Nessun comune configurato
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifica comune" : "Nuovo comune"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="campo-admin-16">Nome</Label>
              <Input
                id="campo-admin-16"
                {...attributiErrore("campo-admin-16", errori)}
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
              <ErroreCampo id="campo-admin-16" errori={errori} />
            </div>
            <div>
              <Label htmlFor="campo-admin-17">Provincia</Label>
              <Select value={form.provinciaId} onValueChange={(v) => setForm({ ...form, provinciaId: v })}>
                <SelectTrigger id="campo-admin-17" {...attributiErrore("campo-admin-17", errori)}>
                  <SelectValue placeholder="Seleziona..." />
                </SelectTrigger>
                <SelectContent>
                  {province.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.nome} ({p.sigla})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ErroreCampo id="campo-admin-17" errori={errori} />
            </div>
            <div>
              <Label htmlFor="campo-admin-18">CAP</Label>
              <Input
                id="campo-admin-18"
                {...attributiErrore("campo-admin-18", errori)}
                value={form.cap}
                onChange={(e) => setForm({ ...form, cap: e.target.value })}
              />
              <ErroreCampo id="campo-admin-18" errori={errori} />
            </div>
            <div>
              <Label htmlFor="campo-admin-19">PEC del Comune</Label>
              <Input
                id="campo-admin-19"
                {...attributiErrore("campo-admin-19", errori)}
                value={form.pecComune}
                onChange={(e) => setForm({ ...form, pecComune: e.target.value })}
              />
              <ErroreCampo id="campo-admin-19" errori={errori} />
            </div>
            <div>
              <Label htmlFor="campo-admin-20">Nome del sindaco</Label>
              <Input
                id="campo-admin-20"
                value={form.nomeSindaco}
                onChange={(e) => setForm({ ...form, nomeSindaco: e.target.value })}
              />
            </div>
            <div>
              <Label htmlFor="campo-admin-21">Data ultima verifica</Label>
              <Input
                id="campo-admin-21"
                type="date"
                value={form.noteAggiornamento}
                onChange={(e) => setForm({ ...form, noteAggiornamento: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>
              Annulla
            </Button>
            <Button onClick={salva}>Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
