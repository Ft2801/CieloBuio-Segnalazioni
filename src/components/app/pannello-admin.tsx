"use client";

/**
 * Pannello di amministrazione: gestione regioni, province, comuni e utenti.
 * Visibile solo agli amministratori.
 * Autore: Fabio Tempera (2026)
 */

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Plus, Globe, MapPin, Building2, Users, Edit, Trash2, Save } from "lucide-react";
import { labelRuolo } from "@/lib/types";
import type { SessionUser } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { guardDemoReadOnly, isDemoSession } from "@/lib/demo-mode";

type Regione = {
  id: number;
  regione: string;
  riferimentoLegge: string;
  titoloLegge: string;
  testoProgettoIlluminotecnico: string;
  testoDeroghe: string;
  testoDatiFotometrici: string;
  testoApprovazione: string;
  testoInstallazione: string;
  testoControllo: string;
  testoSanzioni: string;
  pecArpaRegionale: string;
  _count?: { province: number; segnalazioni: number };
};

type Provincia = {
  id: number;
  sigla: string;
  nome: string;
  regioneId: number;
  pecArpaProvinciale: string | null;
  regione: { regione: string };
  _count?: { comuni: number; segnalazioni: number };
};

type Comune = {
  id: number;
  nome: string;
  cap: string;
  pecComune: string;
  nomeSindaco: string | null;
  noteAggiornamento: string | null;
  provinciaId: number;
  provincia: { sigla: string; nome: string; regione: { regione: string } };
};

type Utente = {
  id: string;
  email: string;
  nomeCognome: string;
  ruolo: string;
  provinciaId: number | null;
  regioneId: number | null;
  pec: string | null;
  emailOrdinaria: string | null;
  indirizzo: string | null;
  inizialiProtocollo: string | null;
  attivo: boolean;
  provincia?: { sigla: string; nome: string } | null;
  regione?: { regione: string } | null;
};

export function PannelloAdmin({ user }: { user: SessionUser }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("regioni");
  const demo = isDemoSession(user);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pannello di amministrazione</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Gestione delle tabelle di configurazione e degli utenti
        </p>
      </div>

      {demo && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          Account dimostrativo: qui non sono disponibili dati reali di configurazione
          (le tabelle sotto restano vuote finché non accedi con un account effettivo)
          e nessuna modifica può comunque essere salvata.
        </div>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2 sm:grid-cols-4">
          <TabsTrigger value="regioni" className="gap-1">
            <Globe className="w-3 h-3" /> Regioni
          </TabsTrigger>
          <TabsTrigger value="province" className="gap-1">
            <MapPin className="w-3 h-3" /> Province
          </TabsTrigger>
          <TabsTrigger value="comuni" className="gap-1">
            <Building2 className="w-3 h-3" /> Comuni
          </TabsTrigger>
          <TabsTrigger value="utenti" className="gap-1">
            <Users className="w-3 h-3" /> Utenti
          </TabsTrigger>
        </TabsList>

        <TabsContent value="regioni" className="mt-4">
          <RegioniTab toast={toast} user={user} />
        </TabsContent>
        <TabsContent value="province" className="mt-4">
          <ProvinceTab toast={toast} user={user} />
        </TabsContent>
        <TabsContent value="comuni" className="mt-4">
          <ComuniTab toast={toast} user={user} />
        </TabsContent>
        <TabsContent value="utenti" className="mt-4">
          <UtentiTab toast={toast} user={user} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ----------------------------------------------------------------
// Tab Regioni
// ----------------------------------------------------------------
function RegioniTab({ toast, user }: { toast: ReturnType<typeof useToast>["toast"]; user: SessionUser }) {
  const [regioni, setRegioni] = useState<Regione[]>([]);
  const [dialog, setDialog] = useState(false);
  const [form, setForm] = useState<Partial<Regione>>({});
  const [editingId, setEditingId] = useState<number | null>(null);

  async function carica() {
    if (isDemoSession(user)) return;
    const res = await fetch("/api/config/regioni");
    const data = await res.json().catch(() => ({}));
    setRegioni(data.regioni ?? []);
  }
  useEffect(() => { carica(); }, []);

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

  async function salva() {
    if (!form.regione || !form.riferimentoLegge) {
      toast({ title: "Regione e riferimento legge obbligatori", variant: "destructive" });
      return;
    }
    try { guardDemoReadOnly(user); } catch (e) {
      toast({ title: "Azione non disponibile", description: e instanceof Error ? e.message : "", variant: "destructive" });
      return;
    }
    const url = editingId ? `/api/config/regioni/${editingId}` : "/api/config/regioni";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Errore", description: data.error ?? "Errore sconosciuto", variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Regione aggiornata" : "Regione creata" });
    setDialog(false);
    setForm({});
    setEditingId(null);
    carica();
  }

  async function elimina(id: number) {
    if (!confirm("Eliminare questa regione? L'operazione è irreversibile.")) return;
    try { guardDemoReadOnly(user); } catch (e) {
      toast({ title: "Azione non disponibile", description: e instanceof Error ? e.message : "", variant: "destructive" });
      return;
    }
    const res = await fetch(`/api/config/regioni/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Errore", description: data.error ?? "Errore sconosciuto", variant: "destructive" });
      return;
    }
    toast({ title: "Regione eliminata" });
    carica();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Regioni e leggi</CardTitle>
          <CardDescription>
            Una riga per regione con il testo normativo che va nella lettera PEC. È il cuore del motore a regole.
          </CardDescription>
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
                <th className="py-2 pr-2">Regione</th>
                <th className="py-2 pr-2">Riferimento legge</th>
                <th className="py-2 pr-2">PEC ARPA</th>
                <th className="py-2 pr-2 text-right">Province</th>
                <th className="py-2 pr-2 text-right">Segnalaz.</th>
                <th className="py-2 pr-2 text-center">Azioni</th>
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
                    <Button size="sm" variant="ghost" onClick={() => apriModifica(r)} className="h-7 w-7 p-0">
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => elimina(r.id)} className="h-7 w-7 p-0">
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
              Tutti i campi sono obbligatori. Il testo immesso va testualmente nella lettera PEC.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Regione</Label>
                <Input value={form.regione ?? ""} onChange={(e) => setForm({ ...form, regione: e.target.value.toUpperCase() })} placeholder="LOMBARDIA" />
              </div>
              <div>
                <Label>PEC ARPA regionale</Label>
                <Input value={form.pecArpaRegionale ?? ""} onChange={(e) => setForm({ ...form, pecArpaRegionale: e.target.value })} placeholder="arpa.x@pec.regione.it" />
              </div>
            </div>
            <div>
              <Label>Riferimento legge</Label>
              <Input value={form.riferimentoLegge ?? ""} onChange={(e) => setForm({ ...form, riferimentoLegge: e.target.value })} placeholder="Legge Regionale della Lombardia n.31/15" />
            </div>
            <div>
              <Label>Titolo esteso della legge</Label>
              <Textarea rows={2} value={form.titoloLegge ?? ""} onChange={(e) => setForm({ ...form, titoloLegge: e.target.value })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Articolo progetto illuminotecnico</Label>
                <Input value={form.testoProgettoIlluminotecnico ?? ""} onChange={(e) => setForm({ ...form, testoProgettoIlluminotecnico: e.target.value })} />
              </div>
              <div>
                <Label>Articolo deroghe modeste entità</Label>
                <Input value={form.testoDeroghe ?? ""} onChange={(e) => setForm({ ...form, testoDeroghe: e.target.value })} />
              </div>
              <div>
                <Label>Articolo dati fotometrici</Label>
                <Input value={form.testoDatiFotometrici ?? ""} onChange={(e) => setForm({ ...form, testoDatiFotometrici: e.target.value })} />
              </div>
              <div>
                <Label>Articolo approvazione</Label>
                <Input value={form.testoApprovazione ?? ""} onChange={(e) => setForm({ ...form, testoApprovazione: e.target.value })} />
              </div>
              <div>
                <Label>Articolo installazione</Label>
                <Input value={form.testoInstallazione ?? ""} onChange={(e) => setForm({ ...form, testoInstallazione: e.target.value })} />
              </div>
              <div>
                <Label>Articolo controllo Comuni</Label>
                <Input value={form.testoControllo ?? ""} onChange={(e) => setForm({ ...form, testoControllo: e.target.value })} />
              </div>
              <div>
                <Label>Articolo sanzioni</Label>
                <Input value={form.testoSanzioni ?? ""} onChange={(e) => setForm({ ...form, testoSanzioni: e.target.value })} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Annulla</Button>
            <Button onClick={salva}>Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ----------------------------------------------------------------
// Tab Province
// ----------------------------------------------------------------
function ProvinceTab({ toast, user }: { toast: ReturnType<typeof useToast>["toast"]; user: SessionUser }) {
  const [province, setProvince] = useState<Provincia[]>([]);
  const [regioni, setRegioni] = useState<Regione[]>([]);
  const [dialog, setDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<{ sigla: string; nome: string; regioneId: string; pecArpaProvinciale: string }>({
    sigla: "", nome: "", regioneId: "", pecArpaProvinciale: "",
  });

  async function carica() {
    if (isDemoSession(user)) return; // vedi banner nel componente padre
    // Esegue le 2 fetch in parallelo per ridurre la latenza
    const [resProvince, resRegioni] = await Promise.all([
      fetch("/api/config/province"),
      fetch("/api/config/regioni"),
    ]);
    const [dataProvince, dataRegioni] = await Promise.all([
      resProvince.json().catch(() => ({})),
      resRegioni.json().catch(() => ({})),
    ]);
    setProvince(dataProvince.province ?? []);
    setRegioni(dataRegioni.regioni ?? []);
  }
  useEffect(() => { carica(); }, []);

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

  async function salva() {
    if (!form.sigla || !form.nome || !form.regioneId) {
      toast({ title: "Compila tutti i campi obbligatori", variant: "destructive" });
      return;
    }
    try {
      guardDemoReadOnly(user);
    } catch (e) {
      toast({ title: "Azione non disponibile", description: e instanceof Error ? e.message : "", variant: "destructive" });
      return;
    }
    const url = editingId ? `/api/config/province/${editingId}` : "/api/config/province";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Errore", description: data.error ?? "Errore sconosciuto", variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Provincia aggiornata" : "Provincia creata" });
    setDialog(false);
    setForm({ sigla: "", nome: "", regioneId: "", pecArpaProvinciale: "" });
    setEditingId(null);
    carica();
  }

  async function elimina(id: number) {
    if (!confirm("Eliminare questa provincia? L'operazione è irreversibile.")) return;
    try { guardDemoReadOnly(user); } catch (e) {
      toast({ title: "Azione non disponibile", description: e instanceof Error ? e.message : "", variant: "destructive" });
      return;
    }
    const res = await fetch(`/api/config/province/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Errore", description: data.error ?? "Errore sconosciuto", variant: "destructive" });
      return;
    }
    toast({ title: "Provincia eliminata" });
    carica();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
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
                <th className="py-2 pr-2">Sigla</th>
                <th className="py-2 pr-2">Nome</th>
                <th className="py-2 pr-2">Regione</th>
                <th className="py-2 pr-2">PEC ARPA prov.</th>
                <th className="py-2 pr-2 text-right">Comuni</th>
                <th className="py-2 pr-2 text-center">Azioni</th>
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
                    <Button size="sm" variant="ghost" onClick={() => apriModifica(p)} className="h-7 w-7 p-0">
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => elimina(p.id)} className="h-7 w-7 p-0">
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
              <Label>Sigla (2 lettere)</Label>
              <Input maxLength={2} value={form.sigla} onChange={(e) => setForm({ ...form, sigla: e.target.value.toUpperCase() })} />
            </div>
            <div>
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>Regione</Label>
              <Select value={form.regioneId} onValueChange={(v) => setForm({ ...form, regioneId: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                <SelectContent>
                  {regioni.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.regione}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>PEC ARPA provinciale (opzionale)</Label>
              <Input value={form.pecArpaProvinciale} onChange={(e) => setForm({ ...form, pecArpaProvinciale: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Annulla</Button>
            <Button onClick={salva}>Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ----------------------------------------------------------------
// Tab Comuni
// ----------------------------------------------------------------
function ComuniTab({ toast, user }: { toast: ReturnType<typeof useToast>["toast"]; user: SessionUser }) {
  const [comuni, setComuni] = useState<Comune[]>([]);
  const [province, setProvince] = useState<Provincia[]>([]);
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<{ nome: string; provinciaId: string; cap: string; pecComune: string; nomeSindaco: string; noteAggiornamento: string }>({
    nome: "", provinciaId: "", cap: "", pecComune: "", nomeSindaco: "", noteAggiornamento: "",
  });

  async function carica() {
    if (isDemoSession(user)) return; // vedi banner nel componente padre
    const url = search ? `/api/config/comuni?search=${encodeURIComponent(search)}` : "/api/config/comuni";
    // Esegue le 2 fetch in parallelo per ridurre la latenza
    const [resComuni, resProvince] = await Promise.all([
      fetch(url),
      fetch("/api/config/province"),
    ]);
    const [dataComuni, dataProvince] = await Promise.all([
      resComuni.json().catch(() => ({})),
      resProvince.json().catch(() => ({})),
    ]);
    setComuni(dataComuni.comuni ?? []);
    setProvince(dataProvince.province ?? []);
  }
  useEffect(() => { carica(); }, [search]);

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

  async function salva() {
    if (!form.nome || !form.provinciaId || !form.cap || !form.pecComune) {
      toast({ title: "Compila i campi obbligatori", variant: "destructive" });
      return;
    }
    try {
      guardDemoReadOnly(user);
    } catch (e) {
      toast({ title: "Azione non disponibile", description: e instanceof Error ? e.message : "", variant: "destructive" });
      return;
    }
    const url = editingId ? `/api/config/comuni/${editingId}` : "/api/config/comuni";
    const method = editingId ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Errore", description: data.error ?? "Errore sconosciuto", variant: "destructive" });
      return;
    }
    toast({ title: editingId ? "Comune aggiornato" : "Comune creato" });
    setDialog(false);
    setForm({ nome: "", provinciaId: "", cap: "", pecComune: "", nomeSindaco: "", noteAggiornamento: "" });
    setEditingId(null);
    carica();
  }

  async function elimina(id: number) {
    if (!confirm("Eliminare questo comune? L'operazione è irreversibile.")) return;
    try { guardDemoReadOnly(user); } catch (e) {
      toast({ title: "Azione non disponibile", description: e instanceof Error ? e.message : "", variant: "destructive" });
      return;
    }
    const res = await fetch(`/api/config/comuni/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Errore", description: data.error ?? "Errore sconosciuto", variant: "destructive" });
      return;
    }
    toast({ title: "Comune eliminato" });
    carica();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
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
                <th className="py-2 pr-2">Comune</th>
                <th className="py-2 pr-2">Prov.</th>
                <th className="py-2 pr-2">CAP</th>
                <th className="py-2 pr-2">PEC</th>
                <th className="py-2 pr-2">Sindaco</th>
                <th className="py-2 pr-2">Verifica</th>
                <th className="py-2 pr-2 text-center">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {comuni.map((c) => {
                // Verifica se il comune ha il dato del sindaco non verificato
                // da oltre 6 mesi. Validiamo esplicitamente che la stringa
                // sia una data ISO valida: noteAggiornamento è un campo
                // testuale libero, e `new Date(stringa-non-data).getTime()`
                // ritornerebbe NaN, facendo fallire il check (il comune
                // verrebbe marcato come "verificato" anche se non lo è).
                const SEI_MESI_MS = 6 * 30 * 24 * 60 * 60 * 1000;
                const parsedDate = c.noteAggiornamento ? new Date(c.noteAggiornamento) : null;
                const isValidDate = parsedDate !== null && !isNaN(parsedDate.getTime());
                const noteDate = isValidDate ? (parsedDate as Date).getTime() : 0;
                const needsCheck =
                  !c.nomeSindaco ||
                  !c.noteAggiornamento ||
                  !isValidDate ||
                  (Date.now() - noteDate > SEI_MESI_MS);
                return (
                  <tr key={c.id} className={`border-b hover:bg-accent/20 ${needsCheck ? "bg-amber-500/5" : ""}`}>
                    <td className="py-2 pr-2 font-medium">{c.nome}</td>
                    <td className="py-2 pr-2">{c.provincia?.sigla}</td>
                    <td className="py-2 pr-2">{c.cap}</td>
                    <td className="py-2 pr-2 text-xs">{c.pecComune}</td>
                    <td className="py-2 pr-2 text-xs">{c.nomeSindaco ?? "n/d"}</td>
                    <td className="py-2 pr-2 text-xs">
                      {needsCheck ? (
                        <span className="text-amber-700 dark:text-amber-400 font-medium">
                          Da verificare
                        </span>
                      ) : (
                        <span className="text-muted-foreground">{c.noteAggiornamento}</span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-center">
                      <Button size="sm" variant="ghost" onClick={() => apriModifica(c)} className="h-7 w-7 p-0">
                        <Edit className="w-3 h-3" />
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => elimina(c.id)} className="h-7 w-7 p-0">
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
              <Label>Nome</Label>
              <Input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <Label>Provincia</Label>
              <Select value={form.provinciaId} onValueChange={(v) => setForm({ ...form, provinciaId: v })}>
                <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                <SelectContent>
                  {province.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nome} ({p.sigla})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>CAP</Label>
              <Input value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} />
            </div>
            <div>
              <Label>PEC del Comune</Label>
              <Input value={form.pecComune} onChange={(e) => setForm({ ...form, pecComune: e.target.value })} />
            </div>
            <div>
              <Label>Nome del sindaco</Label>
              <Input value={form.nomeSindaco} onChange={(e) => setForm({ ...form, nomeSindaco: e.target.value })} />
            </div>
            <div>
              <Label>Data verifica (formato YYYY-MM-DD)</Label>
              <Input
                value={form.noteAggiornamento}
                onChange={(e) => setForm({ ...form, noteAggiornamento: e.target.value })}
                placeholder="2026-01-15"
                type="date"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Annulla</Button>
            <Button onClick={salva}>Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ----------------------------------------------------------------
// Tab Utenti
// ----------------------------------------------------------------
function UtentiTab({ toast, user }: { toast: ReturnType<typeof useToast>["toast"]; user: SessionUser }) {
  const [utenti, setUtenti] = useState<Utente[]>([]);
  const [province, setProvince] = useState<Provincia[]>([]);
  const [regioni, setRegioni] = useState<Regione[]>([]);
  const [dialog, setDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    email: string; nomeCognome: string; password: string; ruolo: string;
    provinciaId: string; regioneId: string; pec: string; emailOrdinaria: string;
    indirizzo: string; inizialiProtocollo: string;
  }>({
    email: "", nomeCognome: "", password: "", ruolo: "volontario",
    provinciaId: "", regioneId: "", pec: "", emailOrdinaria: "",
    indirizzo: "", inizialiProtocollo: "",
  });

  async function carica() {
    if (isDemoSession(user)) return; // vedi banner nel componente padre
    // Esegue le 3 fetch in parallelo per ridurre la latenza
    const [resUsers, resProvince, resRegioni] = await Promise.all([
      fetch("/api/config/users"),
      fetch("/api/config/province"),
      fetch("/api/config/regioni"),
    ]);
    const [dataUsers, dataProvince, dataRegioni] = await Promise.all([
      resUsers.json().catch(() => ({})),
      resProvince.json().catch(() => ({})),
      resRegioni.json().catch(() => ({})),
    ]);
    setUtenti(dataUsers.users ?? []);
    setProvince(dataProvince.province ?? []);
    setRegioni(dataRegioni.regioni ?? []);
  }
  useEffect(() => { carica(); }, []);

  function apriCrea() {
    setForm({
      email: "", nomeCognome: "", password: "", ruolo: "volontario",
      provinciaId: "", regioneId: "", pec: "", emailOrdinaria: "",
      indirizzo: "", inizialiProtocollo: "",
    });
    setEditingId(null);
    setDialog(true);
  }

  function apriModifica(u: Utente) {
    setForm({
      email: u.email,
      nomeCognome: u.nomeCognome,
      password: "",
      ruolo: u.ruolo,
      provinciaId: u.provinciaId ? String(u.provinciaId) : "",
      regioneId: u.regioneId ? String(u.regioneId) : "",
      pec: u.pec ?? "",
      emailOrdinaria: u.emailOrdinaria ?? "",
      indirizzo: u.indirizzo ?? "",
      inizialiProtocollo: u.inizialiProtocollo ?? "",
    });
    setEditingId(u.id);
    setDialog(true);
  }

  async function salva() {
    if (!form.email || !form.nomeCognome) {
      toast({ title: "Compila tutti i campi obbligatori", variant: "destructive" });
      return;
    }
    if (!editingId && !form.password) {
      toast({ title: "Password obbligatoria per i nuovi utenti", variant: "destructive" });
      return;
    }
    try {
      guardDemoReadOnly(user);
    } catch (e) {
      toast({ title: "Azione non disponibile", description: e instanceof Error ? e.message : "", variant: "destructive" });
      return;
    }
    if (editingId) {
      // PATCH: payload dinamico, newPassword solo se la password è stata compilata
      const payload: Record<string, unknown> = {
        email: form.email,
        nomeCognome: form.nomeCognome,
        ruolo: form.ruolo,
        provinciaId: form.provinciaId ? Number(form.provinciaId) : null,
        regioneId: form.regioneId ? Number(form.regioneId) : null,
        pec: form.pec || null,
        emailOrdinaria: form.emailOrdinaria || null,
        indirizzo: form.indirizzo || null,
        inizialiProtocollo: form.inizialiProtocollo || null,
      };
      if (form.password) {
        payload.newPassword = form.password;
      }
      const res = await fetch(`/api/config/users/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Errore", description: data.error ?? "Errore sconosciuto", variant: "destructive" });
        return;
      }
      toast({ title: "Utente aggiornato" });
    } else {
      const res = await fetch("/api/config/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Errore", description: data.error ?? "Errore sconosciuto", variant: "destructive" });
        return;
      }
      toast({ title: "Utente creato" });
    }
    setDialog(false);
    setForm({
      email: "", nomeCognome: "", password: "", ruolo: "volontario",
      provinciaId: "", regioneId: "", pec: "", emailOrdinaria: "",
      indirizzo: "", inizialiProtocollo: "",
    });
    setEditingId(null);
    carica();
  }

  async function elimina(id: string) {
    if (!confirm("Eliminare questo utente? L'operazione è irreversibile.")) return;
    try { guardDemoReadOnly(user); } catch (e) {
      toast({ title: "Azione non disponibile", description: e instanceof Error ? e.message : "", variant: "destructive" });
      return;
    }
    const res = await fetch(`/api/config/users/${id}`, { method: "DELETE" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Errore", description: data.error ?? "Errore sconosciuto", variant: "destructive" });
      return;
    }
    toast({ title: "Utente eliminato" });
    carica();
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-base">Utenti</CardTitle>
          <CardDescription>
            Volontari, referenti territoriali e amministratori
          </CardDescription>
        </div>
        <Button size="sm" onClick={apriCrea}>
          <Plus className="w-4 h-4 mr-1" /> Nuovo
        </Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left border-b">
                <th className="py-2 pr-2">Nome</th>
                <th className="py-2 pr-2">Email</th>
                <th className="py-2 pr-2">Ruolo</th>
                <th className="py-2 pr-2">Ambito</th>
                <th className="py-2 pr-2">Stato</th>
                <th className="py-2 pr-2 text-center">Azioni</th>
              </tr>
            </thead>
            <tbody>
              {utenti.map((u) => (
                <tr key={u.id} className="border-b hover:bg-accent/20">
                  <td className="py-2 pr-2 font-medium">{u.nomeCognome}</td>
                  <td className="py-2 pr-2 text-xs">{u.email}</td>
                  <td className="py-2 pr-2">
                    <Badge variant="outline">{labelRuolo(u.ruolo)}</Badge>
                  </td>
                  <td className="py-2 pr-2 text-xs">
                    {u.ruolo === "referente_provinciale" && u.provincia?.nome ? `Prov. ${u.provincia.nome}` :
                     u.ruolo === "referente_regionale" && u.regione?.regione ? u.regione.regione :
                     u.ruolo === "admin" ? "Nazionale" : "n/d"}
                  </td>
                  <td className="py-2 pr-2">
                    {u.attivo ? (
                      <Badge className="bg-emerald-600">Attivo</Badge>
                    ) : (
                      <Badge variant="secondary">Disattivato</Badge>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-center">
                    <Button size="sm" variant="ghost" onClick={() => apriModifica(u)} className="h-7 w-7 p-0">
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => elimina(u.id)} className="h-7 w-7 p-0">
                      <Trash2 className="w-3 h-3 text-destructive" />
                    </Button>
                  </td>
                </tr>
              ))}
              {utenti.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-muted-foreground">
                    Nessun utente configurato
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
            <DialogTitle>{editingId ? "Modifica utente" : "Nuovo utente"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Nome e cognome</Label>
                <Input value={form.nomeCognome} onChange={(e) => setForm({ ...form, nomeCognome: e.target.value })} />
              </div>
              <div>
                <Label>Iniziali protocollo (2 lettere)</Label>
                <Input maxLength={2} value={form.inizialiProtocollo} onChange={(e) => setForm({ ...form, inizialiProtocollo: e.target.value.toUpperCase() })} placeholder="DB" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <Label>Password</Label>
                <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
                <p className="text-xs text-muted-foreground mt-1">
                  Almeno 12 caratteri, con maiuscola, minuscola, numero e carattere speciale.
                </p>
              </div>
            </div>
            <div>
              <Label>Ruolo</Label>
              <Select value={form.ruolo} onValueChange={(v) => setForm({ ...form, ruolo: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="volontario">Volontario</SelectItem>
                  <SelectItem value="referente_provinciale">Referente provinciale</SelectItem>
                  <SelectItem value="referente_regionale">Referente regionale</SelectItem>
                  <SelectItem value="admin">Amministratore</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.ruolo === "referente_provinciale" && (
              <div>
                <Label>Provincia di competenza</Label>
                <Select value={form.provinciaId} onValueChange={(v) => setForm({ ...form, provinciaId: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>
                    {province.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.nome} ({p.sigla})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            {form.ruolo === "referente_regionale" && (
              <div>
                <Label>Regione di competenza</Label>
                <Select value={form.regioneId} onValueChange={(v) => setForm({ ...form, regioneId: v })}>
                  <SelectTrigger><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>
                    {regioni.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.regione}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>PEC</Label>
                <Input value={form.pec} onChange={(e) => setForm({ ...form, pec: e.target.value })} />
              </div>
              <div>
                <Label>Email ordinaria</Label>
                <Input value={form.emailOrdinaria} onChange={(e) => setForm({ ...form, emailOrdinaria: e.target.value })} />
              </div>
            </div>
            <div>
              <Label>Indirizzo</Label>
              <Input value={form.indirizzo} onChange={(e) => setForm({ ...form, indirizzo: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(false)}>Annulla</Button>
            <Button onClick={salva}>Salva</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
