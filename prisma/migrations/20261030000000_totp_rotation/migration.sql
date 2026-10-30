-- Durante la rotazione il secret TOTP verificato resta attivo fino alla
-- conferma del nuovo codice. Un setup abbandonato non disattiva il 2FA.
ALTER TABLE "users" ADD COLUMN "totpPendingSecret" TEXT;
