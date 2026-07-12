// Registrazione del service worker per PWA installabile.
// Caricato come script esterno per evitare dangerouslySetInnerHTML
// e permettere una CSP strict senza 'unsafe-inline'.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("/sw.js").catch(function (e) {
      if (typeof console !== "undefined" && console.error) {
        console.error("SW registration failed:", e);
      }
    });
  });
}
