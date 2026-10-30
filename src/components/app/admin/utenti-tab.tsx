import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2 } from "lucide-react";
import { labelRuolo } from "@/lib/types";
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
import type { Regione, Provincia, Utente, ErroriCampi } from "./condivisi";

// ----------------------------------------------------------------
// Tab Utenti
// ----------------------------------------------------------------
export function UtentiTab({ toast, user }: { toast: ReturnType<typeof useToast>["toast"]; user: SessionUser }) {
  const conferma = useConferma();
  const [utenti, setUtenti] = useState<Utente[]>([]);
  const [province, setProvince] = useState<Provincia[]>([]);
  const [regioni, setRegioni] = useState<Regione[]>([]);
  const [dialog, setDialog] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<{
    email: string;
    nomeCognome: string;
    password: string;
    ruolo: string;
    provinciaId: string;
    regioneId: string;
    pec: string;
    emailOrdinaria: string;
    indirizzo: string;
    inizialiProtocollo: string;
    attivo: boolean;
  }>({
    email: "",
    nomeCognome: "",
    password: "",
    ruolo: "volontario",
    provinciaId: "",
    regioneId: "",
    pec: "",
    emailOrdinaria: "",
    indirizzo: "",
    inizialiProtocollo: "",
    attivo: true,
  });

  const carica = useCallback(async () => {
    if (isDemoSession(user)) return; // In modalità demo non si caricano dati dal server.
    // Esegue le 3 fetch in parallelo per ridurre la latenza
    const risposte = await Promise.all([
      fetch("/api/config/users"),
      fetch("/api/config/province"),
      fetch("/api/config/regioni"),
    ]).catch(() => null);
    if (!risposte) {
      toast(ERRORE_CONNESSIONE);
      return;
    }
    const [resUsers, resProvince, resRegioni] = risposte;
    const [dataUsers, dataProvince, dataRegioni] = await Promise.all([
      resUsers.json().catch(() => ({})),
      resProvince.json().catch(() => ({})),
      resRegioni.json().catch(() => ({})),
    ]);
    setUtenti(dataUsers.users ?? []);
    setProvince(dataProvince.province ?? []);
    setRegioni(dataRegioni.regioni ?? []);
  }, [user, toast]);
  useEffect(() => {
    carica();
  }, [carica]);

  function apriCrea() {
    setForm({
      email: "",
      nomeCognome: "",
      password: "",
      ruolo: "volontario",
      provinciaId: "",
      regioneId: "",
      pec: "",
      emailOrdinaria: "",
      indirizzo: "",
      inizialiProtocollo: "",
      attivo: true,
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
      attivo: u.attivo,
    });
    setEditingId(u.id);
    setDialog(true);
  }

  const { errori, segnala } = useErroriModulo(form);
  async function salva() {
    const campi: ErroriCampi = {};
    if (!form.nomeCognome) campi["campo-admin-22"] = "Inserisci nome e cognome.";
    if (!form.email) campi["campo-admin-24"] = "Inserisci l'email.";
    if (!editingId && !form.password) campi["campo-admin-25"] = "Inserisci una password per il nuovo utente.";
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
        attivo: form.attivo,
      };
      if (form.password) {
        payload.newPassword = form.password;
      }
      const res = await chiamaApi(toast, `/api/config/users/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Operazione non riuscita", description: data.error ?? ERRORE_GENERICO, variant: "destructive" });
        return;
      }
      toast({ title: "Utente aggiornato" });
    } else {
      // Stessa normalizzazione del PATCH: gli ID di territorio vanno inviati come
      // numeri o null (lo schema non accetta stringhe vuote).
      const payload = {
        email: form.email,
        nomeCognome: form.nomeCognome,
        password: form.password,
        ruolo: form.ruolo,
        attivo: form.attivo,
        provinciaId: form.provinciaId ? Number(form.provinciaId) : null,
        regioneId: form.regioneId ? Number(form.regioneId) : null,
        pec: form.pec || null,
        emailOrdinaria: form.emailOrdinaria || null,
        indirizzo: form.indirizzo || null,
        inizialiProtocollo: form.inizialiProtocollo || null,
      };
      const res = await chiamaApi(toast, "/api/config/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Operazione non riuscita", description: data.error ?? ERRORE_GENERICO, variant: "destructive" });
        return;
      }
      toast({ title: "Utente creato" });
    }
    setDialog(false);
    setForm({
      email: "",
      nomeCognome: "",
      password: "",
      ruolo: "volontario",
      provinciaId: "",
      regioneId: "",
      pec: "",
      emailOrdinaria: "",
      indirizzo: "",
      inizialiProtocollo: "",
      attivo: true,
    });
    setEditingId(null);
    carica();
  }

  function elimina(id: string, nome: string) {
    conferma.chiedi(
      `Eliminare l'utente «${nome}»? Le sessioni attive vengono chiuse e non si può annullare. Il server blocca l'operazione se l'utente ha segnalazioni collegate.`,
      () => void eliminaConfermata(id),
    );
  }

  async function eliminaConfermata(id: string) {
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
    const res = await chiamaApi(toast, `/api/config/users/${id}`, { method: "DELETE" });
    if (!res) return;
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast({ title: "Operazione non riuscita", description: data.error ?? ERRORE_GENERICO, variant: "destructive" });
      return;
    }
    toast({ title: "Utente eliminato" });
    carica();
  }

  return (
    <Card>
      {conferma.dialog}
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <div>
          <CardTitle className="text-base">Utenti</CardTitle>
          <CardDescription>Volontari, referenti territoriali e amministratori</CardDescription>
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
                <th scope="col" className="py-2 pr-2">
                  Nome
                </th>
                <th scope="col" className="py-2 pr-2">
                  Email
                </th>
                <th scope="col" className="py-2 pr-2">
                  Ruolo
                </th>
                <th scope="col" className="py-2 pr-2">
                  Ambito
                </th>
                <th scope="col" className="py-2 pr-2">
                  Stato
                </th>
                <th scope="col" className="py-2 pr-2 text-center">
                  Azioni
                </th>
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
                    {u.ruolo === "referente_provinciale" && u.provincia?.nome
                      ? `Prov. ${u.provincia.nome}`
                      : u.ruolo === "referente_regionale" && u.regione?.regione
                        ? u.regione.regione
                        : u.ruolo === "admin"
                          ? "Nazionale"
                          : "n/d"}
                  </td>
                  <td className="py-2 pr-2">
                    {u.attivo ? (
                      <Badge className="bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-100 ring-1 ring-inset ring-emerald-300 dark:ring-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-950">
                        Attivo
                      </Badge>
                    ) : (
                      <Badge variant="secondary">Disattivato</Badge>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-center">
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Modifica ${u.nomeCognome}`}
                      onClick={() => apriModifica(u)}
                      className="h-7 w-7 p-0"
                    >
                      <Edit className="w-3 h-3" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Elimina ${u.nomeCognome}`}
                      onClick={() => elimina(u.id, u.nomeCognome)}
                      className="h-7 w-7 p-0"
                    >
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
                <Label htmlFor="campo-admin-22">Nome e cognome</Label>
                <Input
                  id="campo-admin-22"
                  {...attributiErrore("campo-admin-22", errori)}
                  value={form.nomeCognome}
                  onChange={(e) => setForm({ ...form, nomeCognome: e.target.value })}
                />
                <ErroreCampo id="campo-admin-22" errori={errori} />
              </div>
              <div>
                <Label htmlFor="campo-admin-23">Iniziali protocollo (2 lettere)</Label>
                <Input
                  id="campo-admin-23"
                  maxLength={2}
                  value={form.inizialiProtocollo}
                  onChange={(e) => setForm({ ...form, inizialiProtocollo: e.target.value.toUpperCase() })}
                  placeholder="DB"
                />
              </div>
            </div>
            <div className="flex items-center gap-3 py-2">
              <Switch checked={form.attivo} onCheckedChange={(v) => setForm({ ...form, attivo: v })} id="user-attivo" />
              <Label htmlFor="user-attivo" className="cursor-pointer">
                Utente attivo
                <span className="block text-xs text-muted-foreground font-normal">
                  Disattivato: l&apos;utente non può accedere ma i suoi record restano per audit
                </span>
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="campo-admin-24">Email</Label>
                <Input
                  id="campo-admin-24"
                  {...attributiErrore("campo-admin-24", errori)}
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <ErroreCampo id="campo-admin-24" errori={errori} />
              </div>
              <div>
                <Label htmlFor="campo-admin-25">Password</Label>
                <Input
                  id="campo-admin-25"
                  {...attributiErrore("campo-admin-25", errori)}
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  autoComplete="new-password"
                />
                <ErroreCampo id="campo-admin-25" errori={errori} />
                <p className="text-xs text-muted-foreground mt-1">
                  Almeno 12 caratteri, con maiuscola, minuscola, numero e carattere speciale.
                </p>
              </div>
            </div>
            <div>
              <Label htmlFor="campo-admin-26">Ruolo</Label>
              <Select value={form.ruolo} onValueChange={(v) => setForm({ ...form, ruolo: v })}>
                <SelectTrigger id="campo-admin-26">
                  <SelectValue />
                </SelectTrigger>
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
                <Label htmlFor="campo-admin-27">Provincia di competenza</Label>
                <Select value={form.provinciaId} onValueChange={(v) => setForm({ ...form, provinciaId: v })}>
                  <SelectTrigger id="campo-admin-27">
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
              </div>
            )}
            {form.ruolo === "referente_regionale" && (
              <div>
                <Label htmlFor="campo-admin-28">Regione di competenza</Label>
                <Select value={form.regioneId} onValueChange={(v) => setForm({ ...form, regioneId: v })}>
                  <SelectTrigger id="campo-admin-28">
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
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="campo-admin-29">PEC</Label>
                <Input
                  id="campo-admin-29"
                  value={form.pec}
                  onChange={(e) => setForm({ ...form, pec: e.target.value })}
                />
              </div>
              <div>
                <Label htmlFor="campo-admin-30">Email ordinaria</Label>
                <Input
                  id="campo-admin-30"
                  value={form.emailOrdinaria}
                  onChange={(e) => setForm({ ...form, emailOrdinaria: e.target.value })}
                />
              </div>
            </div>
            <div>
              <Label htmlFor="campo-admin-31">Indirizzo</Label>
              <Input
                id="campo-admin-31"
                value={form.indirizzo}
                onChange={(e) => setForm({ ...form, indirizzo: e.target.value })}
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
