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

/* ============================================================
   Consentement cookies + balises publicitaires (Google Ads / GA4, Meta)
   Rien n'est chargé tant que les identifiants ci-dessous sont vides,
   ni tant que le visiteur n'a pas accepté (RGPD / Consent Mode v2).
   ============================================================ */
(function () {
  "use strict";
  var TAGS = {
    google: "",   // ex. "AW-123456789" (Google Ads) ou "G-XXXXXXX" (GA4) — plusieurs séparés par des virgules
    googleLeadLabel: "", // ex. "AW-123456789/AbCdEfGh" : étiquette de conversion « lead »
    meta: ""      // ex. "123456789012345" (pixel Meta)
  };
  var actifs = !!(TAGS.google || TAGS.meta);
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag("consent", "default", { ad_storage: "denied", analytics_storage: "denied", ad_user_data: "denied", ad_personalization: "denied", wait_for_update: 500 });
  var CLE = "ecoroy_consent";
  function lire() { try { return localStorage.getItem(CLE); } catch (e) { return null; } }
  function ecrire(v) { try { localStorage.setItem(CLE, v); } catch (e) { /* ignoré */ } }
  var charge = false;
  function chargerBalises() {
    if (charge || !actifs) return; charge = true;
    gtag("consent", "update", { ad_storage: "granted", analytics_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" });
    if (TAGS.google) {
      var ids = TAGS.google.split(",").map(function (x) { return x.trim(); }).filter(Boolean);
      var s = document.createElement("script"); s.async = true; s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(ids[0]); document.head.appendChild(s);
      gtag("js", new Date()); ids.forEach(function (id) { gtag("config", id); });
    }
    if (TAGS.meta) {
      !function (f, b, e, v, n, t, s) { if (f.fbq) return; n = f.fbq = function () { n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments); }; if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = "2.0"; n.queue = []; t = b.createElement(e); t.async = !0; t.src = v; s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s); }(window, document, "script", "https://connect.facebook.net/en_US/fbevents.js");
      window.fbq("init", TAGS.meta); window.fbq("track", "PageView");
    }
  }
  // Conversion « lead » : déclenchée par l'événement lead_submitted déjà poussé par les formulaires
  var pushOrig = window.dataLayer.push;
  window.dataLayer.push = function () {
    for (var i = 0; i < arguments.length; i++) {
      var ev = arguments[i];
      if (ev && ev.event === "lead_submitted" && lire() === "oui") {
        if (TAGS.googleLeadLabel) gtag("event", "conversion", { send_to: TAGS.googleLeadLabel });
        if (TAGS.google) gtag("event", "generate_lead", { lead_source: ev.lead_source || "" });
        if (TAGS.meta && window.fbq) window.fbq("track", "Lead");
      }
    }
    return pushOrig.apply(window.dataLayer, arguments);
  };
  function bandeau() {
    if (!actifs || document.getElementById("bandeau-cookies")) return;
    var b = document.createElement("div"); b.id = "bandeau-cookies"; b.setAttribute("role", "dialog"); b.setAttribute("aria-label", "Cookies");
    b.innerHTML = '<p>Nous utilisons des cookies de mesure d’audience et publicitaires (Google, Meta) pour savoir d’où viennent nos demandes. Vous pouvez les refuser : le site fonctionne pareil. <a href="politique-confidentialite.html">En savoir plus</a></p><div class="bc-actions"><button type="button" class="btn btn-contour" data-c="non">Refuser</button><button type="button" class="btn btn-principal" data-c="oui">Accepter</button></div>';
    b.addEventListener("click", function (e) { var c = e.target.getAttribute && e.target.getAttribute("data-c"); if (!c) return; ecrire(c); b.remove(); if (c === "oui") chargerBalises(); });
    document.body.appendChild(b);
  }
  window.EcoRoy = window.EcoRoy || {};
  window.EcoRoy.gererCookies = function () { try { localStorage.removeItem(CLE); } catch (e) {} bandeau(); };
  if (actifs) {
    var choix = lire();
    if (choix === "oui") chargerBalises(); else if (choix !== "non") { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bandeau); else bandeau(); }
    var pied = document.querySelector(".pied-legal p");
    if (pied) { var a = document.createElement("a"); a.href = "#"; a.textContent = "Gérer les cookies"; a.addEventListener("click", function (e) { e.preventDefault(); window.EcoRoy.gererCookies(); }); pied.appendChild(document.createTextNode(" · ")); pied.appendChild(a); }
  }
})();
