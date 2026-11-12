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

  // Barre d'action fixe sur mobile (appel + simulation), sauf sur la page du simulateur
  if (!/eligibilite|espace-client/.test(location.pathname) && !document.querySelector(".barre-mobile")) {
    var bm = document.createElement("div");
    bm.className = "barre-mobile";
    bm.innerHTML = '<a class="bm-tel" href="tel:+33972149162">📞 Appeler</a><a class="bm-cta" href="eligibilite.html">Tester mon éligibilité</a>';
    document.body.appendChild(bm);
  }

  // Créneau de rappel : le visiteur choisit le jour et la plage horaire (lun-ven, 9 h - 19 h)
  var zones = document.querySelectorAll("[data-creneaux]");
  if (zones.length) {
    var PLAGES = [[9, 11], [11, 13], [14, 16], [16, 18], [18, 19]];
    var JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
    var MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
    var p2 = function (x) { return (x < 10 ? "0" : "") + x; };
    var maintenant = new Date();
    var jours = [];
    for (var j = 0; jours.length < 5 && j < 12; j++) {
      var d = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate() + j);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      var libres = PLAGES.filter(function (pl) { return new Date(d.getFullYear(), d.getMonth(), d.getDate(), pl[1] - 1, 0) > maintenant; });
      if (libres.length) jours.push({ d: d, plages: libres, nom: j === 0 ? "Aujourd'hui" : j === 1 ? "Demain" : JOURS[d.getDay()] + " " + d.getDate() + " " + MOIS[d.getMonth()] });
    }
    Array.prototype.forEach.call(zones, function (zone) {
      var choixJour = -1;
      zone.innerHTML = '<span class="etiquette-creneau">Quand souhaitez-vous être rappelé ?</span>' +
        '<div class="creneaux-jours" role="group" aria-label="Jour du rappel"></div><div class="creneaux-heures" role="group" aria-label="Plage horaire"></div>' +
        '<p class="aide creneau-resume" aria-live="polite">Sans choix de votre part, nous vous rappelons dès que possible (lundi au vendredi, 9 h - 19 h).</p>' +
        '<input type="hidden" id="rappel-le"><input type="hidden" id="rappel-libelle">';
      var zj = zone.querySelector(".creneaux-jours"), zh = zone.querySelector(".creneaux-heures"), res = zone.querySelector(".creneau-resume");
      var le = zone.querySelector("#rappel-le"), lib = zone.querySelector("#rappel-libelle");
      function bouton(txt, actif) { var b = document.createElement("button"); b.type = "button"; b.className = "creneau" + (actif ? " actif" : ""); b.textContent = txt; b.setAttribute("aria-pressed", actif ? "true" : "false"); return b; }
      function dessiner(plageChoisie) {
        zj.innerHTML = ""; zh.innerHTML = "";
        var asap = bouton("Dès que possible", choixJour === -1);
        asap.addEventListener("click", function () { choixJour = -1; le.value = ""; lib.value = ""; res.textContent = "Nous vous rappelons dès que possible (lundi au vendredi, 9 h - 19 h)."; dessiner(); });
        zj.appendChild(asap);
        jours.forEach(function (jr, i) {
          var b = bouton(jr.nom, choixJour === i);
          b.addEventListener("click", function () { choixJour = i; le.value = ""; lib.value = ""; res.textContent = "Choisissez maintenant une plage horaire."; dessiner(); });
          zj.appendChild(b);
        });
        if (choixJour >= 0) jours[choixJour].plages.forEach(function (pl) {
          var cle = pl[0] + "-" + pl[1];
          var b = bouton(pl[0] + " h - " + pl[1] + " h", plageChoisie === cle);
          b.addEventListener("click", function () {
            var jr = jours[choixJour], d = jr.d;
            le.value = d.getFullYear() + "-" + p2(d.getMonth() + 1) + "-" + p2(d.getDate()) + "T" + p2(pl[0]) + ":00";
            lib.value = jr.nom + " entre " + pl[0] + " h et " + pl[1] + " h";
            res.textContent = "Un conseiller vous rappelle " + lib.value.charAt(0).toLowerCase() + lib.value.slice(1) + ".";
            dessiner(cle);
          });
          zh.appendChild(b);
        });
      }
      dessiner();
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
