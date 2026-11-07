/* Eco-Roy — script commun à toutes les pages (aucune dépendance) */
(function () {
  "use strict";

  // Menu mobile
  var bouton = document.querySelector(".nav-bouton");
  var nav = document.getElementById("nav-principale");
  if (bouton && nav) {
    bouton.addEventListener("click", function () {
      var ouvert = nav.classList.toggle("ouvert");
      bouton.setAttribute("aria-expanded", ouvert ? "true" : "false");
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && nav.classList.contains("ouvert")) {
        nav.classList.remove("ouvert");
        bouton.setAttribute("aria-expanded", "false");
        bouton.focus();
      }
    });
  }

  // Année du pied de page
  var annee = document.querySelectorAll("[data-annee]");
  for (var i = 0; i < annee.length; i++) annee[i].textContent = new Date().getFullYear();

  // Suivi de campagne : on garde les paramètres utm_* / gclid de la page d'arrivée
  // pendant la session (stockage local au navigateur, jamais transmis hors du formulaire).
  var CLE = "ecoroy_utm";
  function lireUrl() {
    var p = new URLSearchParams(window.location.search);
    var o = {};
    ["utm_source", "utm_medium", "utm_campaign", "gclid"].forEach(function (k) {
      var v = p.get(k);
      if (v) o[k] = v.slice(0, 200);
    });
    return o;
  }
  var depuisUrl = lireUrl();
  if (Object.keys(depuisUrl).length) {
    try { sessionStorage.setItem(CLE, JSON.stringify(depuisUrl)); } catch (e) { /* stockage indisponible */ }
  }

  window.EcoRoy = window.EcoRoy || {};
  /** Chaîne "source/medium/campaign" (+ " gclid=..." si présent) */
  window.EcoRoy.utm = function () {
    var o = lireUrl();
    if (!Object.keys(o).length) {
      try { o = JSON.parse(sessionStorage.getItem(CLE) || "{}") || {}; } catch (e) { o = {}; }
    }
    if (!o.utm_source && !o.utm_medium && !o.utm_campaign && !o.gclid) return "";
    var s = [o.utm_source || "", o.utm_medium || "", o.utm_campaign || ""].join("/");
    if (o.gclid) s += " gclid=" + o.gclid;
    return s;
  };
})();
