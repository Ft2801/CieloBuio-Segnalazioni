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
import { guardDemoReadOnly, isDemoSession } from "@/lib/demo-mode";
import {
  ERRORE_GENERICO,
  ERRORE_CONNESSIONE,
  ErroreCampo,
  attributiErrore,
  chiamaApi,
  useConferma,
  useErroriModulo,
} from "./condivisi";
import type { Regione, Provincia, ErroriCampi } from "./condivisi";

// ----------------------------------------------------------------
// Tab Province
// ----------------------------------------------------------------
export function ProvinceTab({ toast, user }: { toast: ReturnType<typeof useToast>["toast"]; user: SessionUser }) {
  const conferma = useConferma();
  const [province, setProvince] = useState<Provincia[]>([]);
  const [regioni, setRegioni] = useState<Regione[]>([]);
  const [dialog, setDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<{ sigla: string; nome: string; regioneId: string; pecArpaProvinciale: string }>({
    sigla: "",
    nome: "",
    regioneId: "",
    pecArpaProvinciale: "",
  });

  const carica = useCallback(async () => {
    if (isDemoSession(user)) return; // In modalità demo non si caricano dati dal server.
    // Esegue le 2 fetch in parallelo per ridurre la latenza
    const risposte = await Promise.all([fetch("/api/config/province"), fetch("/api/config/regioni")]).catch(() => null);
    if (!risposte) {
      toast(ERRORE_CONNESSIONE);
      return;
    }
    const [resProvince, resRegioni] = risposte;
    const [dataProvince, dataRegioni] = await Promise.all([
      resProvince.json().catch(() => ({})),
      resRegioni.json().catch(() => ({})),
    ]);
    setProvince(dataProvince.province ?? []);
    setRegioni(dataRegioni.regioni ?? []);
  }, [user, toast]);
  useEffect(() => {
    carica();
  }, [carica]);

  function apriCrea() {
    setForm({ sigla: "", nome: "", regioneId: "", pecArpaProvinciale: "" });
    setEditingId(null);
    setDialog(true);
  }

  function apriModifica(p: Provincia) {
    setForm({
      sigla: p.sigla,
      nome: p.nome,
      regioneId: String(p.regioneId),
      pecArpaProvinciale: p.pecArpaProvinciale ?? "",
    });
    setEditingId(p.id);
    setDialog(true);
  }

  const { errori, segnala } = useErroriModulo(form);
  async function salva() {
    const campi: ErroriCampi = {};
    if (!form.sigla) campi["campo-admin-12"] = "Inserisci la sigla di due lettere.";
    if (!form.nome) campi["campo-admin-13"] = "Inserisci il nome della provincia.";
    if (!form.regioneId) campi["campo-admin-14"] = "Scegli la regione di appartenenza.";
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
    const url = editingId ? `/api/config/province/${editingId}` : "/api/config/province";
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
    toast({ title: editingId ? "Provincia aggiornata" : "Provincia creata" });
    setDialog(false);
    setForm({ sigla: "", nome: "", regioneId: "", pecArpaProvinciale: "" });
    setEditingId(null);
    carica();
  }

  function elimina(id: number, nome: string) {
    conferma.chiedi(
      `Eliminare la provincia «${nome}»? Non si può annullare. Il server blocca l'operazione se restano comuni o segnalazioni collegati.`,
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
    const res = await chiamaApi(toast, `/api/config/province/${id}`, { method: "DELETE" });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Operazione non riuscita", description: data.error ?? ERRORE_GENERICO, variant: "destructive" });
      return;
    }
    toast({ title: "Provincia eliminata" });
    carica();
  }

  return (
    <Card>
      {conferma.dialog}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Province</CardTitle>
          <CardDescription>Una provincia appartiene a una regione</CardDescription>
        </div>
        <Button size="sm" onClick={apriCrea}>
          <Plus className="w-4 h-4 mr-1" /> Nuova
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th scope="col" className="py-2 pr-2">
                  Sigla
                </th>
                <th scope="col" className="py-2 pr-2">
                  Nome
                </th>
                <th scope="col" className="py-2 pr-2">
                  Regione
                </th>
                <th scope="col" className="py-2 pr-2">
                  PEC ARPA prov.
                </th>
                <th scope="col" className="py-2 pr-2 text-right">
                  Comuni
                </th>
                <th scope="col" className="py-2 pr-2 text-center">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody>
              {province.map((p) => (
                <tr key={p.id} className="border-b hover:bg-accent/20">
                  <td className="py-2 pr-2 font-mono font-medium">{p.sigla}</td>
                  <td className="py-2 pr-2">{p.nome}</td>
                  <td className="py-2 pr-2">{p.regione?.regione}</td>
                  <td className="py-2 pr-2 text-xs">{p.pecArpaProvinciale ?? "n/d"}</td>
                  <td className="py-2 pr-2 text-right">{p._count?.comuni ?? 0}</td>
                  <td className="py-2 pr-2 text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Modifica ${p.nome}`}
                      onClick={() => apriModifica(p)}
                      className="h-7 w-7 p-0"
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Elimina ${p.nome}`}
                      onClick={() => elimina(p.id, p.nome)}
                      className="h-7 w-7 p-0"
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
              {province.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    Nessuna provincia configurata
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
            <DialogTitle>{editingId ? "Modifica provincia" : "Nuova provincia"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label htmlFor="campo-admin-12">Sigla (2 lettere)</Label>
              <Input
                id="campo-admin-12"
                {...attributiErrore("campo-admin-12", errori)}
                maxLength={2}
                value={form.sigla}
                onChange={(e) => setForm({ ...form, sigla: e.target.value.toUpperCase() })}
              />
              <ErroreCampo id="campo-admin-12" errori={errori} />
            </div>
            <div>
              <Label htmlFor="campo-admin-13">Nome</Label>
              <Input
                id="campo-admin-13"
                {...attributiErrore("campo-admin-13", errori)}
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
              />
              <ErroreCampo id="campo-admin-13" errori={errori} />
            </div>
            <div>
              <Label htmlFor="campo-admin-14">Regione</Label>
              <Select value={form.regioneId} onValueChange={(v) => setForm({ ...form, regioneId: v })}>
                <SelectTrigger id="campo-admin-14" {...attributiErrore("campo-admin-14", errori)}>
                  <SelectValue placeholder="Seleziona..." />
                </SelectTrigger>
                <SelectContent>
                  {regioni.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.regione}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <ErroreCampo id="campo-admin-14" errori={errori} />
            </div>
            <div>
              <Label htmlFor="campo-admin-15">PEC ARPA provinciale (opzionale)</Label>
              <Input
                id="campo-admin-15"
                value={form.pecArpaProvinciale}
                onChange={(e) => setForm({ ...form, pecArpaProvinciale: e.target.value })}
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
