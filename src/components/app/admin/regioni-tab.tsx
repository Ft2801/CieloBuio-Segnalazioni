import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Plus, Edit, Trash2 } from "lucide-react";
import type { SessionUser } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { guardDemoReadOnly, isDemoSession } from "@/lib/demo-mode";
import { ERRORE_GENERICO, ErroreCampo, attributiErrore, chiamaApi, useConferma, useErroriModulo } from "./condivisi";
import type { Regione, ErroriCampi } from "./condivisi";

// ----------------------------------------------------------------
// Tab Regioni
// ----------------------------------------------------------------
export function RegioniTab({ toast, user }: { toast: ReturnType<typeof useToast>["toast"]; user: SessionUser }) {
  const conferma = useConferma();
  const [regioni, setRegioni] = useState<Regione[]>([]);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Partial<Regione>>({});
  const [editingId, setEditingId] = useState<number | null>(null);

  const carica = useCallback(async () => {
    if (isDemoSession(user)) return;
    const res = await chiamaApi(toast, "/api/config/regioni");
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    setRegioni(data.regioni ?? []);
  }, [user, toast]);
  useEffect(() => {
    carica();
  }, [carica]);

  function apriCrea() {
    setForm({});
    setEditingId(null);
    setDialog(true);
  }

  function apriModifica(r: Regione) {
    setForm({ ...r });
    setEditingId(r.id);
    setDialog(true);
  }

  const { errori, segnala } = useErroriModulo(form);
  async function salva() {
    const campi: ErroriCampi = {};
    if (!form.regione) campi["campo-admin-1"] = "Inserisci il nome della regione.";
    if (!form.riferimentoLegge) campi["campo-admin-3"] = "Inserisci il riferimento di legge.";
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
    const url = editingId ? `/api/config/regioni/${editingId}` : "/api/config/regioni";
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
    toast({ title: editingId ? "Regione aggiornata" : "Regione creata" });
    setDialog(false);
    setForm({});
    setEditingId(null);
    carica();
  }

  function elimina(id: number, nome: string) {
    conferma.chiedi(
      `Eliminare la regione «${nome}»? Non si può annullare. Il server blocca l'operazione se restano province, segnalazioni o referenti collegati.`,
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
    const res = await chiamaApi(toast, `/api/config/regioni/${id}`, { method: "DELETE" });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Operazione non riuscita", description: data.error ?? ERRORE_GENERICO, variant: "destructive" });
      return;
    }
    toast({ title: "Regione eliminata" });
    carica();
  }

  return (
    <Card>
      {conferma.dialog}
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Regioni e leggi</CardTitle>
          <CardDescription>Una riga per regione con il testo normativo inserito nella lettera PEC.</CardDescription>
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
                  Regione
                </th>
                <th scope="col" className="py-2 pr-2">
                  Riferimento legge
                </th>
                <th scope="col" className="py-2 pr-2">
                  PEC ARPA
                </th>
                <th scope="col" className="py-2 pr-2 text-right">
                  Province
                </th>
                <th scope="col" className="py-2 pr-2 text-right">
                  Segnalaz.
                </th>
                <th scope="col" className="py-2 pr-2 text-center">
                  Azioni
                </th>
              </tr>
            </thead>
            <tbody>
              {regioni.map((r) => (
                <tr key={r.id} className="border-b hover:bg-accent/20">
                  <td className="py-2 pr-2 font-medium">{r.regione}</td>
                  <td className="py-2 pr-2 text-xs">{r.riferimentoLegge}</td>
                  <td className="py-2 pr-2 text-xs">{r.pecArpaRegionale}</td>
                  <td className="py-2 pr-2 text-right">{r._count?.province ?? 0}</td>
                  <td className="py-2 pr-2 text-right">{r._count?.segnalazioni ?? 0}</td>
                  <td className="py-2 pr-2 text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Modifica ${r.regione}`}
                      onClick={() => apriModifica(r)}
                      className="h-7 w-7 p-0"
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Elimina ${r.regione}`}
                      onClick={() => elimina(r.id, r.regione)}
                      className="h-7 w-7 p-0"
                    >
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
              {regioni.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    Nessuna regione configurata
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={dialog} onOpenChange={setDialog}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingId ? "Modifica regione" : "Nuova regione"}</DialogTitle>
            <DialogDescription>
              Regione e riferimento legge sono obbligatori. Il testo immesso va testualmente nella lettera PEC.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="campo-admin-1">Regione</Label>
                <Input
                  id="campo-admin-1"
                  {...attributiErrore("campo-admin-1", errori)}
                  value={form.regione ?? ""}
                  onChange={(e) => setForm({ ...form, regione: e.target.value.toUpperCase() })}
                  placeholder="LOMBARDIA"
                />
                <ErroreCampo id="campo-admin-1" errori={errori} />
              </div>
              <div>
                <Label htmlFor="campo-admin-2">PEC ARPA regionale</Label>
                <Input
                  id="campo-admin-2"
                  value={form.pecArpaRegionale ?? ""}
                  onChange={(e) => setForm({ ...form, pecArpaRegionale: e.target.value })}
                  placeholder="arpa.x@pec.regione.it"
                />
              </div>
            </div>
            <div>
              <Label htmlFor="campo-admin-3">Riferimento legge</Label>
              <Input
                id="campo-admin-3"
                {...attributiErrore("campo-admin-3", errori)}
                value={form.riferimentoLegge ?? ""}
                onChange={(e) => setForm({ ...form, riferimentoLegge: e.target.value })}
                placeholder="Es. Legge Regionale della Lombardia n.31/2015"
              />
              <ErroreCampo id="campo-admin-3" errori={errori} />
            </div>
            <div>
              <Label htmlFor="campo-admin-4">Titolo esteso della legge</Label>
              <Textarea
                id="campo-admin-4"
                rows={2}
                value={form.titoloLegge ?? ""}
                onChange={(e) => setForm({ ...form, titoloLegge: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="campo-admin-5">Articolo progetto illuminotecnico</Label>
                <Input
                  id="campo-admin-5"
                  value={form.testoProgettoIlluminotecnico ?? ""}
                  onChange={(e) => setForm({ ...form, testoProgettoIlluminotecnico: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="campo-admin-6">Articolo deroghe modeste entità</Label>
                <Input
                  id="campo-admin-6"
                  value={form.testoDeroghe ?? ""}
                  onChange={(e) => setForm({ ...form, testoDeroghe: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="campo-admin-7">Articolo dati fotometrici</Label>
                <Input
                  id="campo-admin-7"
                  value={form.testoDatiFotometrici ?? ""}
                  onChange={(e) => setForm({ ...form, testoDatiFotometrici: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="campo-admin-8">Articolo approvazione</Label>
                <Input
                  id="campo-admin-8"
                  value={form.testoApprovazione ?? ""}
                  onChange={(e) => setForm({ ...form, testoApprovazione: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="campo-admin-9">Articolo installazione</Label>
                <Input
                  id="campo-admin-9"
                  value={form.testoInstallazione ?? ""}
                  onChange={(e) => setForm({ ...form, testoInstallazione: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="campo-admin-10">Articolo controllo Comuni</Label>
                <Input
                  id="campo-admin-10"
                  value={form.testoControllo ?? ""}
                  onChange={(e) => setForm({ ...form, testoControllo: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="campo-admin-11">Articolo sanzioni</Label>
                <Input
                  id="campo-admin-11"
                  value={form.testoSanzioni ?? ""}
                  onChange={(e) => setForm({ ...form, testoSanzioni: e.target.value })}
                />
              </div>
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
