-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "regioni_leggi" (
    "id" SERIAL NOT NULL,
    "regione" TEXT NOT NULL,
    "riferimentoLegge" TEXT NOT NULL,
    "titoloLegge" TEXT NOT NULL,
    "testoProgettoIlluminotecnico" TEXT NOT NULL,
    "testoDeroghe" TEXT NOT NULL,
    "testoDatiFotometrici" TEXT NOT NULL,
    "testoApprovazione" TEXT NOT NULL,
    "testoInstallazione" TEXT NOT NULL,
    "testoControllo" TEXT NOT NULL,
    "testoSanzioni" TEXT NOT NULL,
    "pecArpaRegionale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regioni_leggi_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "province" (
    "id" SERIAL NOT NULL,
    "sigla" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "regioneId" INTEGER NOT NULL,
    "pecArpaProvinciale" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "province_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comuni" (
    "id" SERIAL NOT NULL,
    "nome" TEXT NOT NULL,
    "provinciaId" INTEGER NOT NULL,
    "cap" TEXT NOT NULL,
    "pecComune" TEXT NOT NULL,
    "nomeSindaco" TEXT,
    "noteAggiornamento" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comuni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nomeCognome" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "ruolo" TEXT NOT NULL DEFAULT 'volontario',
    "provinciaId" INTEGER,
    "regioneId" INTEGER,
    "indirizzo" TEXT,
    "pec" TEXT,
    "emailOrdinaria" TEXT,
    "firma" TEXT,
    "totpSecret" TEXT,
    "totpVerifiedAt" TIMESTAMP(3),
    "totpLastUsedTimestep" INTEGER,
    "inizialiProtocollo" TEXT,
    "attivo" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessioni" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scadenza" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessioni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "segnalazioni" (
    "id" TEXT NOT NULL,
    "numeroProtocollo" TEXT,
    "dataSegnalazione" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stato" TEXT NOT NULL DEFAULT 'bozza',
    "volontarioId" TEXT,
    "referenteApprovatoreId" TEXT,
    "notaRifiuto" TEXT,
    "indirizzoVia" TEXT NOT NULL,
    "comuneId" INTEGER,
    "cap" TEXT,
    "provinciaId" INTEGER,
    "regioneId" INTEGER,
    "latitudine" DOUBLE PRECISION,
    "longitudine" DOUBLE PRECISION,
    "nomeEsercizio" TEXT,
    "chkVetroPianoInclinato" BOOLEAN NOT NULL DEFAULT false,
    "chkVetroCurvo" BOOLEAN NOT NULL DEFAULT false,
    "chkAltroTipologia" BOOLEAN NOT NULL DEFAULT false,
    "notaAltroTipologia" TEXT,
    "chkLuceVersoAlto" BOOLEAN NOT NULL DEFAULT false,
    "chkAbbagliamento" BOOLEAN NOT NULL DEFAULT false,
    "chkLuceIntrusiva" BOOLEAN NOT NULL DEFAULT false,
    "chkAltroProblema" BOOLEAN NOT NULL DEFAULT false,
    "notaAltroProblema" TEXT,
    "descrizioneLibera" TEXT,
    "destinatarioNome" TEXT,
    "includiArpa" BOOLEAN NOT NULL DEFAULT false,
    "pecCcAggiuntive" TEXT,
    "oggettoPec" TEXT,
    "testoIntroduttivoPec" TEXT,
    "mittenteVisibile" BOOLEAN NOT NULL DEFAULT true,
    "dataInvio" TIMESTAMP(3),
    "dataChiusura" TIMESTAMP(3),
    "segnalazionePrecedenteId" TEXT,
    "livelloRecidiva" INTEGER NOT NULL DEFAULT 1,
    "invioPecLockToken" TEXT,
    "invioPecLockAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "segnalazioni_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allegati" (
    "id" TEXT NOT NULL,
    "segnalazioneId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "urlStorage" TEXT NOT NULL,
    "nomeOriginale" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allegati_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storico_stati" (
    "id" TEXT NOT NULL,
    "segnalazioneId" TEXT NOT NULL,
    "statoPrecedente" TEXT,
    "statoNuovo" TEXT,
    "userId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nota" TEXT,

    CONSTRAINT "storico_stati_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_invii_pec" (
    "id" TEXT NOT NULL,
    "segnalazioneId" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "destinatari" TEXT NOT NULL,
    "oggetto" TEXT NOT NULL,
    "esito" TEXT NOT NULL,
    "messaggioErrore" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_invii_pec_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT,
    "azione" TEXT NOT NULL,
    "dettagli" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "regioni_leggi_regione_key" ON "regioni_leggi"("regione");

-- CreateIndex
CREATE UNIQUE INDEX "province_sigla_key" ON "province"("sigla");

-- CreateIndex
CREATE INDEX "province_regioneId_idx" ON "province"("regioneId");

-- CreateIndex
CREATE INDEX "comuni_provinciaId_idx" ON "comuni"("provinciaId");

-- CreateIndex
CREATE UNIQUE INDEX "comuni_nome_provinciaId_key" ON "comuni"("nome", "provinciaId");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_ruolo_idx" ON "users"("ruolo");

-- CreateIndex
CREATE INDEX "users_provinciaId_idx" ON "users"("provinciaId");

-- CreateIndex
CREATE INDEX "users_regioneId_idx" ON "users"("regioneId");

-- CreateIndex
CREATE INDEX "users_attivo_idx" ON "users"("attivo");

-- CreateIndex
CREATE UNIQUE INDEX "sessioni_token_key" ON "sessioni"("token");

-- CreateIndex
CREATE INDEX "sessioni_userId_idx" ON "sessioni"("userId");

-- CreateIndex
CREATE INDEX "sessioni_scadenza_idx" ON "sessioni"("scadenza");

-- CreateIndex
CREATE UNIQUE INDEX "segnalazioni_numeroProtocollo_key" ON "segnalazioni"("numeroProtocollo");

-- CreateIndex
CREATE INDEX "segnalazioni_volontarioId_idx" ON "segnalazioni"("volontarioId");

-- CreateIndex
CREATE INDEX "segnalazioni_provinciaId_idx" ON "segnalazioni"("provinciaId");

-- CreateIndex
CREATE INDEX "segnalazioni_regioneId_idx" ON "segnalazioni"("regioneId");

-- CreateIndex
CREATE INDEX "segnalazioni_comuneId_idx" ON "segnalazioni"("comuneId");

-- CreateIndex
CREATE INDEX "segnalazioni_stato_idx" ON "segnalazioni"("stato");

-- CreateIndex
CREATE INDEX "segnalazioni_dataInvio_idx" ON "segnalazioni"("dataInvio");

-- CreateIndex
CREATE INDEX "segnalazioni_dataChiusura_idx" ON "segnalazioni"("dataChiusura");

-- CreateIndex
CREATE INDEX "segnalazioni_segnalazionePrecedenteId_idx" ON "segnalazioni"("segnalazionePrecedenteId");

-- CreateIndex
CREATE INDEX "allegati_segnalazioneId_idx" ON "allegati"("segnalazioneId");

-- CreateIndex
CREATE INDEX "storico_stati_segnalazioneId_idx" ON "storico_stati"("segnalazioneId");

-- CreateIndex
CREATE INDEX "storico_stati_userId_idx" ON "storico_stati"("userId");

-- CreateIndex
CREATE INDEX "storico_stati_timestamp_idx" ON "storico_stati"("timestamp");

-- CreateIndex
CREATE INDEX "log_invii_pec_segnalazioneId_idx" ON "log_invii_pec"("segnalazioneId");

-- CreateIndex
CREATE INDEX "log_invii_pec_timestamp_idx" ON "log_invii_pec"("timestamp");

-- CreateIndex
CREATE INDEX "log_invii_pec_esito_idx" ON "log_invii_pec"("esito");

-- CreateIndex
CREATE INDEX "AuditLog_azione_timestamp_idx" ON "AuditLog"("azione", "timestamp");

-- AddForeignKey
ALTER TABLE "province" ADD CONSTRAINT "province_regioneId_fkey" FOREIGN KEY ("regioneId") REFERENCES "regioni_leggi"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comuni" ADD CONSTRAINT "comuni_provinciaId_fkey" FOREIGN KEY ("provinciaId") REFERENCES "province"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_provinciaId_fkey" FOREIGN KEY ("provinciaId") REFERENCES "province"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_regioneId_fkey" FOREIGN KEY ("regioneId") REFERENCES "regioni_leggi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessioni" ADD CONSTRAINT "sessioni_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segnalazioni" ADD CONSTRAINT "segnalazioni_volontarioId_fkey" FOREIGN KEY ("volontarioId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segnalazioni" ADD CONSTRAINT "segnalazioni_referenteApprovatoreId_fkey" FOREIGN KEY ("referenteApprovatoreId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segnalazioni" ADD CONSTRAINT "segnalazioni_comuneId_fkey" FOREIGN KEY ("comuneId") REFERENCES "comuni"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segnalazioni" ADD CONSTRAINT "segnalazioni_provinciaId_fkey" FOREIGN KEY ("provinciaId") REFERENCES "province"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segnalazioni" ADD CONSTRAINT "segnalazioni_regioneId_fkey" FOREIGN KEY ("regioneId") REFERENCES "regioni_leggi"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "segnalazioni" ADD CONSTRAINT "segnalazioni_segnalazionePrecedenteId_fkey" FOREIGN KEY ("segnalazionePrecedenteId") REFERENCES "segnalazioni"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allegati" ADD CONSTRAINT "allegati_segnalazioneId_fkey" FOREIGN KEY ("segnalazioneId") REFERENCES "segnalazioni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storico_stati" ADD CONSTRAINT "storico_stati_segnalazioneId_fkey" FOREIGN KEY ("segnalazioneId") REFERENCES "segnalazioni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "storico_stati" ADD CONSTRAINT "storico_stati_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "log_invii_pec" ADD CONSTRAINT "log_invii_pec_segnalazioneId_fkey" FOREIGN KEY ("segnalazioneId") REFERENCES "segnalazioni"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

