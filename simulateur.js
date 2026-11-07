/* Eco-Roy — simulateur d'éligibilité + formulaire de rappel.
   Envoi des demandes vers le CRM (Google Apps Script). Aucun script tiers chargé. */
(function () {
  "use strict";

  var CRM_URL = "https://script.google.com/macros/s/AKfycbxWwNz2tSdQk_rWAayu3kLpJKNFqvpUZ0C4-IuY5-xJ9FirAxQFi5eE2tPSR5o4Byja/exec";
  var TEL_AFFICHE = "09 72 14 91 62";

  /* ------------------------------------------------------------------
     Barèmes MaPrimeRénov' 2026 (Anah, janvier 2026) — RFR ≤ plafond
     [1, 2, 3, 4, 5 personnes, par personne supplémentaire]
  ------------------------------------------------------------------ */
  var PLAFONDS = {
    idf: {
      bleu: [24031, 35270, 42357, 49455, 56580, 7116],
      jaune: [29253, 42933, 51564, 60208, 68877, 8663],
      violet: [40851, 60051, 71846, 84562, 96817, 12257]
    },
    horsIdf: {
      bleu: [17363, 25393, 30540, 35676, 40835, 5151],
      jaune: [22259, 32553, 39148, 45735, 52348, 6598],
      violet: [31185, 45842, 55196, 64550, 73907, 9357]
    }
  };
  var AIDE_PAC = { bleu: 5000, jaune: 4000, violet: 3000, rose: 0 };
  var DEPTS_IDF = ["75", "77", "78", "91", "92", "93", "94", "95"];
  var LIBELLES = { bleu: "Bleu", jaune: "Jaune", violet: "Violet", rose: "Rose" };
  var DESCRIPTIONS = {
    bleu: "Ménages aux revenus très modestes",
    jaune: "Ménages aux revenus modestes",
    violet: "Ménages aux revenus intermédiaires",
    rose: "Ménages aux revenus supérieurs"
  };

  function estIdf(cp) { return DEPTS_IDF.indexOf(String(cp).slice(0, 2)) !== -1; }

  function plafond(liste, n) {
    if (n <= 5) return liste[n - 1];
    return liste[4] + (n - 5) * liste[5];
  }

  /** Renvoie "bleu" | "jaune" | "violet" | "rose" */
  function couleurMPR(cp, nbPersonnes, rfr) {
    var b = estIdf(cp) ? PLAFONDS.idf : PLAFONDS.horsIdf;
    var n = Math.max(1, Math.floor(nbPersonnes));
    if (rfr <= plafond(b.bleu, n)) return "bleu";
    if (rfr <= plafond(b.jaune, n)) return "jaune";
    if (rfr <= plafond(b.violet, n)) return "violet";
    return "rose";
  }

  window.EcoRoy = window.EcoRoy || {};
  window.EcoRoy.couleurMPR = couleurMPR;

  function euros(n) {
    return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(n) + " €";
  }

  function utm() { return (window.EcoRoy && window.EcoRoy.utm) ? window.EcoRoy.utm() : ""; }

  function pousserDataLayer(donnees) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(donnees);
  }

  /** POST vers le CRM. Résout avec la réponse JSON, rejette avec {type:"reseau"|"serveur", message} */
  function envoyerAuCrm(payload) {
    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var minuteur = ctrl ? setTimeout(function () { ctrl.abort(); }, 20000) : null;
    return fetch(CRM_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      redirect: "follow",
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (rep) {
      if (minuteur) clearTimeout(minuteur);
      if (!rep.ok) throw { type: "serveur", message: "HTTP " + rep.status };
      return rep.json().catch(function () { throw { type: "serveur", message: "Réponse illisible" }; });
    }, function () {
      if (minuteur) clearTimeout(minuteur);
      throw { type: "reseau", message: "Connexion impossible" };
    }).then(function (json) {
      if (!json || json.error || json.ok !== true) {
        throw { type: "serveur", message: (json && json.error) ? String(json.error) : "Réponse inattendue" };
      }
      return json;
    });
  }

  /* Validations */
  var RE_TEL = /^(?:(?:\+|00)33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4}$/;
  var RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function telNormalise(t) { return String(t).replace(/[\s.-]/g, ""); }

  function marquerErreur(input, message) {
    var zone = document.getElementById(input.id + "-erreur");
    if (message) {
      input.setAttribute("aria-invalid", "true");
      if (zone) zone.textContent = message;
    } else {
      input.removeAttribute("aria-invalid");
      if (zone) zone.textContent = "";
    }
    return !message;
  }

  /* ==================================================================
     SIMULATEUR
  ================================================================== */
  var racine = document.getElementById("simulateur");
  if (racine) initSimulateur(racine);

  function initSimulateur(form) {
    var etat = {};
    var historique = [];
    var courante = null;

    var ORDRE = ["habitat", "chauffageAppart", "collectif", "statut", "age", "chauffage", "electrique",
      "surface", "cp", "personnes", "rfr", "coordonnees"];

    function horsCollectif() { return !(etat.habitat === "Appartement" && etat.chauffageAppart === "collectif"); }
    var CONDITIONS = {
      chauffageAppart: function () { return etat.habitat === "Appartement"; },
      collectif: function () { return !horsCollectif(); },
      statut: horsCollectif, age: horsCollectif, chauffage: horsCollectif,
      electrique: function () { return horsCollectif() && etat.chauffage === "Électrique"; },
      surface: horsCollectif, cp: horsCollectif, personnes: horsCollectif, rfr: horsCollectif
    };
    function visible(nom) { return CONDITIONS[nom] ? CONDITIONS[nom]() : true; }
    function etapesVisibles() { return ORDRE.filter(visible); }
    function suivante(nom) {
      for (var i = ORDRE.indexOf(nom) + 1; i < ORDRE.length; i++) if (visible(ORDRE[i])) return ORDRE[i];
      return null;
    }

    var sections = {};
    Array.prototype.forEach.call(form.querySelectorAll("[data-etape]"), function (s) { sections[s.getAttribute("data-etape")] = s; });
    var btnRetour = document.getElementById("sim-retour");
    var btnSuivant = document.getElementById("sim-suivant");
    var barre = document.getElementById("sim-barre");
    var texteProg = document.getElementById("sim-prog-texte");
    var navSim = document.getElementById("sim-nav");
    var zoneProg = document.getElementById("sim-progression");
    var ecranResultat = document.getElementById("sim-resultat");
    var zoneErreur = document.getElementById("sim-erreur-envoi");

    function valeurRadio(nom) {
      var r = form.querySelector('input[name="' + nom + '"]:checked');
      return r ? r.value : "";
    }

    function afficher(nom, versLArriere) {
      Object.keys(sections).forEach(function (k) { sections[k].hidden = (k !== nom); });
      courante = nom;
      var liste = etapesVisibles();
      var idx = liste.indexOf(nom);
      var pct = Math.round(((idx) / liste.length) * 100);
      barre.style.width = Math.max(4, pct) + "%";
      texteProg.textContent = "Étape " + (idx + 1) + " sur " + liste.length;
      zoneProg.setAttribute("aria-valuenow", String(pct));
      btnRetour.hidden = historique.length === 0;
      var sec = sections[nom];
      btnSuivant.textContent = sec.getAttribute("data-bouton") || "Continuer";
      if (nom === "coordonnees") btnSuivant.textContent = "Recevoir mon estimation";
      zoneErreur.hidden = true;
      var titre = sec.querySelector("legend, h2");
      if (titre) { titre.setAttribute("tabindex", "-1"); titre.focus({ preventScroll: true }); }
      var haut = form.getBoundingClientRect().top;
      if (haut < 0 || versLArriere === "scroll") form.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    function erreurEtape(msg) {
      var z = sections[courante].querySelector(".erreur-etape");
      if (z) z.textContent = msg || "";
      return !msg;
    }

    function valider(nom) {
      var sec = sections[nom];
      erreurEtape("");
      var radios = sec.querySelectorAll('input[type="radio"]');
      if (radios.length && nom !== "coordonnees") {
        var n = radios[0].name;
        var v = valeurRadio(n);
        if (!v) return erreurEtape("Merci de choisir une réponse pour continuer.");
        etat[n] = v;
        return true;
      }
      if (nom === "collectif") return true;
      if (nom === "surface") {
        var s = document.getElementById("f-surface");
        var vs = parseInt(s.value, 10);
        if (!(vs >= 15 && vs <= 1000)) return marquerErreur(s, "Indiquez une surface entre 15 et 1 000 m².");
        marquerErreur(s, ""); etat.surface = vs; return true;
      }
      if (nom === "cp") {
        var c = document.getElementById("f-cp");
        var vc = c.value.replace(/\s/g, "");
        if (!/^\d{5}$/.test(vc)) return marquerErreur(c, "Le code postal doit comporter 5 chiffres.");
        if (/^(97|98|00)/.test(vc)) return marquerErreur(c, "Nous intervenons uniquement en France métropolitaine.");
        marquerErreur(c, ""); etat.cp = vc; return true;
      }
      if (nom === "personnes") {
        var p = document.getElementById("f-personnes");
        var vp = parseInt(p.value, 10);
        if (!(vp >= 1 && vp <= 15)) return marquerErreur(p, "Indiquez un nombre entre 1 et 15.");
        marquerErreur(p, ""); etat.personnes = vp; return true;
      }
      if (nom === "rfr") {
        var r = document.getElementById("f-rfr");
        var inconnu = document.getElementById("f-rfr-inconnu").checked;
        etat.rfrInconnu = inconnu;
        if (inconnu) { marquerErreur(r, ""); etat.rfr = ""; return true; }
        var vr = parseInt(String(r.value).replace(/[\s.€]/g, ""), 10);
        if (isNaN(vr) || vr < 0 || vr > 2000000) return marquerErreur(r, "Indiquez votre revenu fiscal de référence (en euros), ou cochez « Je ne le connais pas ».");
        marquerErreur(r, ""); etat.rfr = vr; return true;
      }
      if (nom === "coordonnees") return validerCoordonnees();
      return true;
    }

    function validerCoordonnees() {
      var ok = true;
      var civ = valeurRadio("civilite");
      var zc = document.getElementById("f-civilite-erreur");
      zc.textContent = civ ? "" : "Merci d'indiquer votre civilité.";
      if (!civ) ok = false;
      [["f-nom", "Indiquez votre nom."], ["f-prenom", "Indiquez votre prénom."],
       ["f-adresse", "Indiquez l'adresse du logement."], ["f-ville", "Indiquez la ville."]].forEach(function (c) {
        var el = document.getElementById(c[0]);
        if (!marquerErreur(el, el.value.trim().length < 2 ? c[1] : "")) ok = false;
      });
      var tel = document.getElementById("f-tel");
      if (!marquerErreur(tel, RE_TEL.test(tel.value.trim()) ? "" : "Numéro invalide (ex. : 06 12 34 56 78).")) ok = false;
      var em = document.getElementById("f-email");
      if (!marquerErreur(em, RE_EMAIL.test(em.value.trim()) ? "" : "Adresse e-mail invalide.")) ok = false;
      var cons = document.getElementById("f-consentement");
      var zcons = document.getElementById("f-consentement-erreur");
      zcons.textContent = cons.checked ? "" : "Votre accord est nécessaire pour que nous puissions vous recontacter.";
      if (!cons.checked) ok = false;
      if (!ok) {
        var premier = sections.coordonnees.querySelector('[aria-invalid="true"]') || (!civ ? sections.coordonnees.querySelector('input[name="civilite"]') : null) || (!cons.checked ? cons : null);
        if (premier) premier.focus();
      }
      return ok;
    }

    function produit() {
      return (etat.chauffage === "Électrique" && etat.electrique === "ballon") ? "Ballon thermodynamique" : "PAC air/eau";
    }

    function calculLocal() {
      if (!horsCollectif() || etat.rfrInconnu || etat.rfr === "" || etat.rfr == null || !etat.cp || !etat.personnes) return null;
      var couleur = couleurMPR(etat.cp, etat.personnes, etat.rfr);
      return { couleur: couleur, aide: AIDE_PAC[couleur] };
    }

    function construirePayload() {
      var g = function (id) { return document.getElementById(id).value.trim(); };
      var collectif = !horsCollectif();
      var anneeCourante = new Date().getFullYear();
      var local = calculLocal();
      var lignes = [];
      lignes.push("Civilité : " + valeurRadio("civilite"));
      lignes.push("Logement : " + etat.habitat + (etat.habitat === "Appartement" ? " (chauffage " + etat.chauffageAppart + ")" : ""));
      if (collectif) {
        lignes.push("Chauffage collectif : non éligible PAC individuelle — demande de rappel quand même.");
      } else {
        lignes.push("Statut : " + etat.statut);
        lignes.push("Logement de plus de 15 ans : " + (etat.age === "oui" ? "oui" : "non"));
        lignes.push("Chauffage actuel : " + etat.chauffage);
        if (etat.chauffage === "Électrique") lignes.push("Électrique : " + (etat.electrique === "ballon" ? "intéressé par un ballon thermodynamique" : "dispose d'un circuit à eau (radiateurs / plancher)"));
        lignes.push("Surface : " + etat.surface + " m²");
        lignes.push("Code postal : " + etat.cp + (estIdf(etat.cp) ? " (Île-de-France)" : ""));
        lignes.push("Personnes au foyer : " + etat.personnes);
        lignes.push("RFR : " + (etat.rfrInconnu ? "non communiqué" : euros(etat.rfr)));
        if (local) lignes.push("Estimation site : profil " + LIBELLES[local.couleur] + ", aide MPR indicative " + euros(local.aide));
      }
      lignes.push("Produit : " + produit());

      return {
        action: "lead",
        source: "Site internet",
        nom: g("f-nom"),
        prenom: g("f-prenom"),
        tel: telNormalise(g("f-tel")),
        email: g("f-email"),
        adresse: g("f-adresse"),
        cp: etat.cp || "",
        ville: g("f-ville"),
        habitat: etat.habitat === "Appartement" ? "Appartement" : "Maison individuelle",
        proprietaire: collectif ? "" : etat.statut,
        chauffage: collectif ? "" : etat.chauffage,
        surface: collectif ? "" : etat.surface,
        anneeConstruction: collectif ? "" : (etat.age === "oui" ? 1990 : anneeCourante - 5),
        nbPersonnes: collectif ? "" : etat.personnes,
        rfr: collectif ? "" : etat.rfr,
        produit: produit(),
        message: lignes.join("\n"),
        utm: utm(),
        website: document.getElementById("f-website").value
      };
    }

    function afficherResultat(reponse) {
      var collectif = !horsCollectif();
      var local = calculLocal();
      var couleurServeur = reponse && typeof reponse.couleur === "string" ? reponse.couleur.toLowerCase().trim() : "";
      var couleur = LIBELLES[couleurServeur] ? couleurServeur : (local ? local.couleur : "");
      var aide = (reponse && typeof reponse.aideMPR === "number") ? reponse.aideMPR : (couleur ? AIDE_PAC[couleur] : null);
      var mprPossible = !collectif && etat.statut !== "Locataire" && etat.age === "oui";

      var html = "";
      html += '<h2 tabindex="-1" id="res-titre">Merci ' + echapper(document.getElementById("f-prenom").value.trim()) + ', votre demande est bien enregistrée.</h2>';
      html += '<p class="sous">Un conseiller Eco-Roy vous rappelle <strong>sous 24 h ouvrées</strong> pour vérifier votre projet et répondre à vos questions.</p>';

      if (collectif) {
        html += '<div class="alerte alerte-info"><p class="mb-0">Avec un chauffage collectif, une pompe à chaleur individuelle n\'est pas adaptée. Votre conseiller fera le point avec vous sur les autres solutions possibles.</p></div>';
      } else if (couleur) {
        html += '<div class="resultat-couleur c-' + couleur + '"><span class="disque" aria-hidden="true"></span><div><span class="mention">Votre profil MaPrimeRénov\' estimé</span><strong>' + LIBELLES[couleur] + '</strong><span class="mention">' + DESCRIPTIONS[couleur] + '</span></div></div>';
        if (produit() === "Ballon thermodynamique") {
          html += '<p>Pour un <strong>ballon thermodynamique</strong>, le montant des aides dépend de votre profil et de l\'équipement retenu : votre conseiller vous le précisera lors de l\'appel.</p>';
        } else if (!mprPossible) {
          html += '<p class="montant">CEE uniquement</p>';
          html += '<p>' + (etat.statut === "Locataire"
            ? "MaPrimeRénov' est demandée par le propriétaire du logement. Votre conseiller vous expliquera comment l'impliquer et quelles primes CEE peuvent s'appliquer."
            : "MaPrimeRénov' est réservée aux logements construits depuis plus de 15 ans. Les primes CEE (certificats d'économies d'énergie) peuvent en revanche s'appliquer.") + '</p>';
        } else if (aide > 0) {
          html += '<p class="mention mb-0">Aide MaPrimeRénov\' estimée pour une PAC air/eau</p><p class="montant">' + euros(aide) + '</p>';
          html += '<p>À laquelle peut s\'ajouter une <strong>prime CEE</strong>, selon votre situation. En tant que mandataire, Eco-Roy peut avancer ces aides et les déduire directement de votre devis.</p>';
        } else {
          html += '<p class="montant">CEE uniquement</p>';
          html += '<p>Au-delà des plafonds de revenus, MaPrimeRénov\' ne finance pas l\'installation d\'une PAC seule, mais la <strong>prime CEE</strong> reste accessible pour réduire votre reste à charge.</p>';
        }
      } else {
        html += '<div class="alerte alerte-info"><p class="mb-0">Sans votre revenu fiscal de référence, nous ne pouvons pas encore estimer votre profil. Votre conseiller le calculera avec vous à partir de votre avis d\'impôt.</p></div>';
      }
      html += '<p class="mention">Estimation indicative, sous réserve d\'éligibilité et de l\'instruction du dossier par l\'Anah et le délégataire CEE. Barèmes au 1<sup>er</sup> janvier 2026, susceptibles d\'évoluer.</p>';
      html += '<div class="actions mt-2"><a class="btn btn-vert" href="aides-renovation-2026.html">Comprendre les aides 2026</a><a class="btn btn-contour" href="tel:+33972149162">Appeler le ' + TEL_AFFICHE + '</a></div>';

      ecranResultat.innerHTML = html;
      Object.keys(sections).forEach(function (k) { sections[k].hidden = true; });
      navSim.hidden = true;
      barre.style.width = "100%";
      texteProg.textContent = "Demande envoyée";
      zoneProg.setAttribute("aria-valuenow", "100");
      ecranResultat.hidden = false;
      var t = document.getElementById("res-titre");
      if (t) t.focus({ preventScroll: true });
      form.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    function echapper(s) {
      return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
    }

    var envoiEnCours = false;
    function soumettre() {
      if (envoiEnCours) return;
      envoiEnCours = true;
      zoneErreur.hidden = true;
      btnSuivant.disabled = true;
      btnSuivant.textContent = "Envoi en cours…";
      var payload = construirePayload();
      envoyerAuCrm(payload).then(function (rep) {
        var local = calculLocal();
        pousserDataLayer({
          event: "lead_submitted",
          lead_source: "simulateur",
          lead_produit: payload.produit,
          lead_couleur: (rep && rep.couleur) || (local ? local.couleur : "inconnue"),
          lead_departement: (payload.cp || "").slice(0, 2)
        });
        afficherResultat(rep);
      }).catch(function (err) {
        zoneErreur.innerHTML = (err && err.type === "reseau")
          ? "<p><strong>Votre demande n'a pas pu être envoyée</strong> (problème de connexion). Vos réponses sont conservées : réessayez dans un instant.</p>"
          : "<p><strong>Votre demande n'a pas pu être enregistrée.</strong> Vos réponses sont conservées : réessayez dans un instant.</p>";
        zoneErreur.innerHTML += '<p class="mb-0">Vous pouvez aussi nous appeler directement au <a href="tel:+33972149162"><strong>' + TEL_AFFICHE + '</strong></a> (ou au <a href="tel:+33614724041">06 14 72 40 41</a>).</p>';
        zoneErreur.hidden = false;
        zoneErreur.focus();
      }).then(function () {
        envoiEnCours = false;
        btnSuivant.disabled = false;
        if (courante === "coordonnees") btnSuivant.textContent = "Réessayer l'envoi";
      });
    }

    function avancer() {
      if (!valider(courante)) return;
      if (courante === "coordonnees") { soumettre(); return; }
      var suiv = suivante(courante);
      if (!suiv) return;
      historique.push(courante);
      afficher(suiv);
    }

    // btnSuivant est le bouton submit du formulaire : Entrée et clic passent par "submit"
    btnRetour.addEventListener("click", function () {
      if (!historique.length) return;
      afficher(historique.pop());
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); avancer(); });

    // Avance automatique au toucher/clic sur un choix (pas au clavier, pour rester accessible)
    form.addEventListener("pointerup", function (e) {
      var label = e.target.closest ? e.target.closest(".choix label") : null;
      if (!label || courante === "coordonnees") return;
      var input = document.getElementById(label.getAttribute("for"));
      if (!input) return;
      setTimeout(function () {
        if (input.checked && sections[courante] && sections[courante].contains(input)) avancer();
      }, 180);
    });

    // Compteur de personnes
    var champPers = document.getElementById("f-personnes");
    Array.prototype.forEach.call(form.querySelectorAll("[data-pas]"), function (b) {
      b.addEventListener("click", function () {
        var v = parseInt(champPers.value, 10) || 1;
        v = Math.min(15, Math.max(1, v + parseInt(b.getAttribute("data-pas"), 10)));
        champPers.value = v;
      });
    });
    var rfrInconnu = document.getElementById("f-rfr-inconnu");
    rfrInconnu.addEventListener("change", function () {
      var r = document.getElementById("f-rfr");
      r.disabled = rfrInconnu.checked;
      if (rfrInconnu.checked) { r.value = ""; marquerErreur(r, ""); }
    });

    // Reprise depuis un lien (ex. accueil : ?logement=maison)
    var q = new URLSearchParams(window.location.search);
    var depart = "habitat";
    if (q.get("logement") === "maison" || q.get("logement") === "appartement") {
      var radio = document.getElementById(q.get("logement") === "maison" ? "r-maison" : "r-appart");
      if (radio) { radio.checked = true; etat.habitat = radio.value; historique.push("habitat"); depart = suivante("habitat"); }
    }
    form.hidden = false;
    var noscript = document.getElementById("sim-chargement");
    if (noscript) noscript.hidden = true;
    afficher(depart, "init");
  }

  /* ==================================================================
     FORMULAIRE DE RAPPEL (page contact)
  ================================================================== */
  var rappel = document.getElementById("form-rappel");
  if (rappel) {
    rappel.addEventListener("submit", function (e) {
      e.preventDefault();
      var g = function (id) { return document.getElementById(id); };
      var ok = true;
      [["c-nom", "Indiquez votre nom."], ["c-prenom", "Indiquez votre prénom."]].forEach(function (c) {
        if (!marquerErreur(g(c[0]), g(c[0]).value.trim().length < 2 ? c[1] : "")) ok = false;
      });
      if (!marquerErreur(g("c-tel"), RE_TEL.test(g("c-tel").value.trim()) ? "" : "Numéro invalide (ex. : 06 12 34 56 78).")) ok = false;
      var em = g("c-email").value.trim();
      if (!marquerErreur(g("c-email"), (!em || RE_EMAIL.test(em)) ? "" : "Adresse e-mail invalide.")) ok = false;
      if (!marquerErreur(g("c-cp"), /^\d{5}$/.test(g("c-cp").value.trim()) ? "" : "Le code postal doit comporter 5 chiffres.")) ok = false;
      g("c-consentement-erreur").textContent = g("c-consentement").checked ? "" : "Votre accord est nécessaire pour que nous puissions vous recontacter.";
      if (!g("c-consentement").checked) ok = false;
      if (!ok) { var p = rappel.querySelector('[aria-invalid="true"]') || g("c-consentement"); p.focus(); return; }

      var bouton = rappel.querySelector('button[type="submit"]');
      var retour = g("c-retour");
      bouton.disabled = true; bouton.textContent = "Envoi en cours…";
      var payload = {
        action: "lead", source: "Site internet",
        nom: g("c-nom").value.trim(), prenom: g("c-prenom").value.trim(),
        tel: telNormalise(g("c-tel").value.trim()), email: em,
        adresse: "", cp: g("c-cp").value.trim(), ville: "",
        habitat: "", proprietaire: "", chauffage: "", surface: "", anneeConstruction: "",
        nbPersonnes: "", rfr: "", produit: g("c-projet").value,
        message: "[Formulaire de contact] Projet : " + g("c-projet").value + "\n" + g("c-message").value.trim(),
        utm: utm(), website: g("c-website").value
      };
      envoyerAuCrm(payload).then(function () {
        pousserDataLayer({ event: "lead_submitted", lead_source: "contact", lead_produit: payload.produit, lead_departement: payload.cp.slice(0, 2) });
        rappel.reset();
        retour.className = "alerte alerte-info";
        retour.innerHTML = "<p class=\"mb-0\"><strong>Merci, votre demande est bien enregistrée.</strong> Un conseiller vous rappelle sous 24 h ouvrées.</p>";
      }).catch(function () {
        retour.className = "alerte alerte-erreur";
        retour.innerHTML = '<p class="mb-0"><strong>L\'envoi a échoué.</strong> Réessayez dans un instant ou appelez-nous au <a href="tel:+33972149162">' + TEL_AFFICHE + '</a>.</p>';
      }).then(function () {
        retour.hidden = false; retour.focus();
        bouton.disabled = false; bouton.textContent = "Être rappelé";
      });
    });
  }
})();
