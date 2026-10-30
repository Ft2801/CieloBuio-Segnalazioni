// Il database è sacrificabile: la suite cancella tutte le tabelle applicative.
// Non usa DATABASE_URL implicitamente e non accetta nomi di produzione.
const url = process.env.TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== "/cielobuio_integration") {
  throw new Error(
    "TEST_DATABASE_URL deve indicare il database dedicato cielobuio_integration, mai un database operativo.",
  );
}
process.env.DATABASE_URL = url;
