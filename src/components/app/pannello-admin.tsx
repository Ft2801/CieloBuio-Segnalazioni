"use client";

/**
 * Pannello di amministrazione: gestione regioni, province, comuni e utenti.
 * Visibile solo agli amministratori.
 * Autore: Fabio Tempera (2026)
 */

import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Globe, MapPin, Building2, Users } from "lucide-react";
import type { SessionUser } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import { RegioniTab } from "./admin/regioni-tab";
import { ProvinceTab } from "./admin/province-tab";
import { ComuniTab } from "./admin/comuni-tab";
import { UtentiTab } from "./admin/utenti-tab";

export function PannelloAdmin({ user }: { user: SessionUser }) {
  const { toast } = useToast();
  const [tab, setTab] = useState("regioni");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pannello di amministrazione</h1>
        <p className="text-sm text-muted-foreground mt-1">Gestione delle tabelle di configurazione e degli utenti</p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid h-auto w-full grid-cols-2 sm:h-9 sm:grid-cols-4">
          <TabsTrigger value="regioni" className="min-h-9 gap-1 sm:min-h-0">
            <Globe className="w-3 h-3" /> Regioni
          </TabsTrigger>
          <TabsTrigger value="province" className="min-h-9 gap-1 sm:min-h-0">
            <MapPin className="w-3 h-3" /> Province
          </TabsTrigger>
          <TabsTrigger value="comuni" className="min-h-9 gap-1 sm:min-h-0">
            <Building2 className="w-3 h-3" /> Comuni
          </TabsTrigger>
          <TabsTrigger value="utenti" className="min-h-9 gap-1 sm:min-h-0">
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
