// Registrazione del service worker per PWA installabile.
// Caricato come script esterno per evitare dangerouslySetInnerHTML
// e permettere una CSP strict senza 'unsafe-inline'.
//
// Aggiornamenti: quando è disponibile una nuova versione dell'SW,
// mostriamo un messaggio in console per avvisare l'utente di ricaricare.
// In futuro si potrebbe integrare con il sistema di toast dell'app per
// un feedback più visibile.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .register("/sw.js", {
        scope: "/",
        // updateViaCache: "none" garantisce che il browser richieda
        // sempre la versione più recente di sw.js al server, senza
        // usare la cache HTTP per l'SW stesso.
        updateViaCache: "none",
      })
      .then(function (registration) {
        // Ascolta updatefound: scatta quando il browser scarica una
        // nuova versione dell'SW in background.
        registration.addEventListener("updatefound", function () {
          var newWorker = registration.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", function () {
            if (
              newWorker.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              // Una nuova versione è installata e c'è già un SW attivo:
              // l'utente sta usando la vecchia versione. Logga un
              // messaggio (in futuro, mostra un toast "Aggiornamento
              // disponibile, ricarica la pagina").
              console.info(
                "[SW] Nuova versione dell'app installata. Ricarica la pagina per attivarla."
              );
            }
          });
        });
      })
      .catch(function (e) {
        if (typeof console !== "undefined" && console.error) {
          console.error("SW registration failed:", e);
        }
      });
  });
}
