BEGIN;
-- La competenza territoriale di una pratica è coerente con comune e provincia.
-- I vincoli impediscono ricollocazioni e scritture incoerenti anche concorrenti.
CREATE UNIQUE INDEX "province_id_regioneId_key" ON "province"("id", "regioneId");
CREATE UNIQUE INDEX "comuni_id_provinciaId_key" ON "comuni"("id", "provinciaId");
ALTER TABLE "segnalazioni" DROP CONSTRAINT "segnalazioni_comuneId_fkey";
ALTER TABLE "segnalazioni" DROP CONSTRAINT "segnalazioni_provinciaId_fkey";
ALTER TABLE "segnalazioni" ADD CONSTRAINT "segnalazioni_comuneId_provinciaId_fkey"
  FOREIGN KEY ("comuneId", "provinciaId") REFERENCES "comuni"("id", "provinciaId") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "segnalazioni" ADD CONSTRAINT "segnalazioni_provinciaId_regioneId_fkey"
  FOREIGN KEY ("provinciaId", "regioneId") REFERENCES "province"("id", "regioneId") ON DELETE RESTRICT ON UPDATE RESTRICT;
COMMIT;
