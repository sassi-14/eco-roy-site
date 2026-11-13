/* Eco-Roy — simulateur d'éligibilité + formulaire de rappel.
   Envoi des demandes vers le CRM (Google Apps Script). Aucun script tiers chargé. */
(function () {
  "use strict";

  var CRM_URL = "https://script.google.com/macros/s/AKfycbxWwNz2tSdQk_rWAayu3kLpJKNFqvpUZ0C4-IuY5-xJ9FirAxQFi5eE2tPSR5o4Byja/exec";
  var TEL_AFFICHE = "09 72 14 91 62";

  /* ==================================================================
     CONFIGURATION — montants et paramètres à mettre à jour ici.
     Tous les résultats affichés sont des estimations indicatives.
  ================================================================== */
  var CONFIG = {
    // Prime CEE « Coup de pouce chauffage » pour une PAC air/eau, versée via notre délégataire
    // et déduite directement du devis (€, par profil MaPrimeRénov').
    cee: { bleu: 5800, jaune: 4000, violet: 4000, rose: 4000 }, ceeBleuSansMPR: 7500, // montants affichés au client (part CEE pure, hors commission). 4600 possible selon machine : on affiche le bas.
    // Le Coup de pouce vise le remplacement d'une chaudière fossile : pour les autres chauffages,
    // le montant reste affiché mais signalé « à confirmer ».
    ceeChauffagesCoupDePouce: ["Chaudière gaz", "Chaudière fioul"],
    // MaPrimeRénov' forfait PAC air/eau (€), versée par l'Anah après les travaux.
    mpr: { bleu: 5000, jaune: 4000, violet: 3000, rose: 0 },
    // Écrêtement Anah : MaPrimeRénov' + CEE ne peuvent pas dépasser ce pourcentage de la dépense TTC.
    // MaPrimeRénov' est réduite d'autant. Mettre ecretement: null pour désactiver.
    ecretement: { bleu: 0.90, jaune: 0.75, violet: 0.60, rose: 0.40 },

    // Prix TTC indicatifs (TVA 5,5 %) par puissance commerciale (kW), pose comprise.
    prix: { 6: 11400, 8: 11400, 11: 12400, 12: 12400, 14: 13700, 16: 13700, 22: 15900 },
    prixEcs: 900,              // supplément module ECS / ballon intégré
    tva: 5.5,
    gammes: [6, 8, 11, 12, 14, 16, 22],

    // Coefficient G (W/m³.K) selon la période de construction
    gBase: { "avant-1975": 1.6, "1975-1989": 1.2, "1990-2005": 0.95, "2006-2012": 0.75, "apres-2012": 0.6 },
    reductionIsolation: 0.10,  // -10 % de G par poste isolé (combles, murs, fenêtres), cumul additif
    gMin: 0.6,
    tInterieure: 19,           // °C de consigne
    marge: 1.1,                // puissance PAC = déperditions × 1,1
    // Température extérieure de base (°C) par département
    tbase: {
      "06": -2, "08": -12, "13": -5, "17": -5, "19": -8, "21": -10, "25": -12, "27": -7, "28": -7, "33": -5,
      "34": -5, "38": -10, "41": -7, "45": -7, "47": -5, "55": -12, "59": -9, "60": -7, "61": -7, "62": -9,
      "63": -8, "67": -15, "68": -15, "70": -10, "71": -10, "75": -5, "77": -7, "78": -7, "87": -8, "88": -15,
      "91": -7, "92": -5, "93": -5, "94": -5, "95": -7
    },
    tbaseDefaut: -7,
    // Correction d'altitude : -1 °C par tranche de 200 m au-delà de 200 m
    // (tranche 400-800 m comptée à 800 m et « plus de 800 m » à 1 000 m, par prudence).
    altitude: { "moins-200": 0, "200-400": -1, "400-800": -3, "plus-800": -4 },
    seuilTriphaseKw: 14,
    ballonLitres: 200, ballonLitresGrand: 300, ballonSeuilPersonnes: 5,

    // Photos avant chantier
    photosMax: 8,
    photoMaxPx: 1600,
    photoQualite: 0.75,
    photoMaxCaracteres: 2600000 // ≈ 1,9 Mo binaire une fois le base64 décodé
  };

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
  var AIDE_PAC = CONFIG.mpr;
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
  function envoyerAuCrm(payload, delaiMs) {
    var ctrl = ("AbortController" in window) ? new AbortController() : null;
    var minuteur = ctrl ? setTimeout(function () { ctrl.abort(); }, delaiMs || 20000) : null;
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
        rappelLe: (document.getElementById("rappel-le") || {}).value || "", creneau: (document.getElementById("rappel-libelle") || {}).value || "",
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
      html += '<p class="sous">Un conseiller Eco-Roy vous rappelle <strong>au créneau que vous avez choisi</strong> (ou dès que possible) pour vérifier votre projet et répondre à vos questions.</p>';

      if (collectif) {
        html += '<div class="alerte alerte-info"><p class="mb-0">Avec un chauffage collectif, une pompe à chaleur individuelle n\'est pas adaptée. Votre conseiller fera le point avec vous sur les autres solutions possibles.</p></div>';
      } else if (couleur) {
        html += '<div class="resultat-couleur c-' + couleur + '"><span class="disque" aria-hidden="true"></span><div><span class="mention">Votre profil MaPrimeRénov\' estimé</span><strong>' + LIBELLES[couleur] + '</strong><span class="mention">' + DESCRIPTIONS[couleur] + '</span></div></div>';
        if (produit() === "Ballon thermodynamique") {
          html += '<p>Pour un <strong>ballon thermodynamique</strong>, le montant des aides dépend de votre profil et de l\'équipement retenu : votre conseiller vous le précisera lors de l\'appel.</p>';
        } else {
          // Étape A — « Vos aides » : CEE déduite du devis + MaPrimeRénov' versée après travaux
          if (!mprPossible) {
            html += '<p>' + (etat.statut === "Locataire"
              ? "MaPrimeRénov' est demandée par le propriétaire du logement : elle n'est pas comptée ci-dessous. Votre conseiller vous expliquera comment l'impliquer."
              : "MaPrimeRénov' est réservée aux logements construits depuis plus de 15 ans : elle n'est pas comptée ci-dessous. La prime CEE peut en revanche s'appliquer.") + '</p>';
          } else if (!(aide > 0)) {
            html += '<p>Au-delà des plafonds de revenus, MaPrimeRénov\' ne finance pas l\'installation d\'une PAC seule, mais la <strong>prime CEE</strong> reste accessible pour réduire votre reste à charge.</p>';
          }
          var pre = dimensionner(prelimDimensionnement());
          var aidesA = calculAides(couleur, pre.prixTTC, mprPossible ? aide : 0, etat.chauffage);
          html += blocAides(aidesA, pre.prixTTC,
            "Prix indicatif d'une PAC air/eau " + pre.puissanceConseilleeKw + " kW",
            "Pré-estimation d'après votre surface, avant le questionnaire de dimensionnement");
        }
      } else {
        html += '<div class="alerte alerte-info"><p class="mb-0">Sans votre revenu fiscal de référence, nous ne pouvons pas encore estimer votre profil. Votre conseiller le calculera avec vous à partir de votre avis d\'impôt.</p></div>';
      }
      var tunnelPossible = !collectif && produit() === "PAC air/eau";
      if (tunnelPossible) {
        html += '<div class="cta-tunnel"><h3>Recevez votre pré-devis en 2 minutes</h3><p>8 questions sur votre maison pour calculer la puissance adaptée, puis l\'envoi de quelques photos : un technicien RGE valide votre note et vous recevez votre devis définitif par e-mail.</p><button type="button" class="btn btn-principal" id="btn-dimensionnement">Calculer ma PAC et mon pré-devis</button></div>';
      }
      html += '<p class="mention">Estimation indicative, sous réserve d\'éligibilité, de la visite technique et de l\'instruction des dossiers par l\'Anah et le délégataire CEE. Barèmes au 1<sup>er</sup> janvier 2026, susceptibles d\'évoluer.</p>';
      html += '<div class="actions mt-2"><a class="btn btn-vert" href="aides-renovation-2026.html">Comprendre les aides 2026</a><a class="btn btn-contour" href="tel:+33972149162">Appeler le ' + TEL_AFFICHE + '</a></div>';

      ecranResultat.innerHTML = html;
      if (tunnelPossible) {
        var ctxTunnel = {
          etat: etat, couleur: couleur, mprMontant: mprPossible ? aide : 0, mprPossible: mprPossible,
          tel: telNormalise(document.getElementById("f-tel").value.trim()),
          nom: document.getElementById("f-nom").value.trim(),
          prenom: document.getElementById("f-prenom").value.trim(),
          email: document.getElementById("f-email").value.trim(),
          adresse: document.getElementById("f-adresse").value.trim(),
          ville: document.getElementById("f-ville").value.trim(),
          token: (reponse && typeof reponse.token === "string") ? reponse.token : "",
          formSimulateur: form
        };
        document.getElementById("btn-dimensionnement").addEventListener("click", function () { ouvrirTunnel(ctxTunnel); });
      }
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

    // Hypothèses par défaut pour la pré-estimation de l'étape A (affinées à l'étape B)
    function prelimDimensionnement() {
      return {
        annee: etat.age === "non" ? "apres-2012" : "1975-1989", isolation: [], surface: etat.surface,
        hauteur: 2.5, niveaux: "", emetteurs: "", ecs: false, nbPersonnes: etat.personnes,
        altitude: "moins-200", compteur: "nsp", cp: etat.cp
      };
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
        zoneErreur.innerHTML += '<p class="mb-0">Vous pouvez aussi nous appeler directement au <a href="tel:+33972149162"><strong>' + TEL_AFFICHE + '</strong></a>.</p>';
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

  function echapper(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; });
  }
  function kw(n, dec) { return new Intl.NumberFormat("fr-FR", { maximumFractionDigits: dec == null ? 1 : dec, minimumFractionDigits: dec == null ? 1 : dec }).format(n) + " kW"; }

  /* ==================================================================
     CALCULS — aides et dimensionnement indicatif
  ================================================================== */

  /**
   * Aides pour une PAC air/eau.
   * - CEE « Coup de pouce » selon le profil : déduite du devis (reste à charge à la signature = prix − CEE).
   * - MaPrimeRénov' : versée par l'Anah après travaux (reste à charge final = prix − CEE − MPR, plancher 0).
   * - Écrêtement : si CEE + MPR > taux × prix TTC, MPR est réduite (CONFIG.ecretement).
   * couleur absente → aides non calculées (seul le prix est affiché).
   */
  function calculAides(couleur, prixTTC, mprMontant, chauffage) {
    var cee = couleur ? (CONFIG.cee[couleur] || 0) : 0;
    if (couleur === "bleu" && !(mprMontant > 0) && CONFIG.ceeBleuSansMPR) cee = CONFIG.ceeBleuSansMPR; // bleu sans MaPrimeRénov' : prime CEE majorée
    var mprBrut = couleur ? Math.max(0, mprMontant || 0) : 0;
    var mpr = mprBrut, ecrete = false;
    if (couleur && CONFIG.ecretement && CONFIG.ecretement[couleur] != null) {
      var plafondAides = Math.floor(prixTTC * CONFIG.ecretement[couleur]);
      if (cee + mpr > plafondAides) { mpr = Math.max(0, plafondAides - cee); ecrete = mpr < mprBrut; }
    }
    var racSignature = Math.max(0, prixTTC - cee);
    return {
      connu: !!couleur, couleur: couleur || "", cee: cee, mpr: mpr, mprBrut: mprBrut, ecrete: ecrete,
      tauxEcretement: (couleur && CONFIG.ecretement) ? CONFIG.ecretement[couleur] : null,
      ceeAConfirmer: !!couleur && CONFIG.ceeChauffagesCoupDePouce.indexOf(chauffage) === -1,
      racSignature: racSignature, racFinal: Math.max(0, racSignature - mpr)
    };
  }

  /** Tableau prix − CEE = signature − MPR = final (HTML) */
  function blocAides(a, prixTTC, libellePrix, sousPrix) {
    var reserve = "sous réserve d'éligibilité, de la visite technique et de l'instruction des dossiers";
    var h = '<div class="bloc-aides"><h3>Vos aides et votre reste à charge</h3>';
    if (a.connu) {
      h += '<p>La <strong>prime CEE</strong> est déduite directement de votre devis : vous n\'avez pas à l\'avancer. <strong>MaPrimeRénov\'</strong> est versée par l\'Anah après les travaux ; en tant que mandataire, nous montons le dossier pour vous.</p>';
    }
    h += '<dl class="devis">';
    h += '<div><dt>' + echapper(libellePrix) + ' <small>' + echapper(sousPrix) + ' · TTC, TVA ' + String(CONFIG.tva).replace(".", ",") + ' %</small></dt><dd>' + euros(prixTTC) + '</dd></div>';
    if (a.connu) {
      h += '<div class="moins"><dt>Prime CEE « Coup de pouce chauffage » <small>Versée via notre délégataire, déduite du devis' + (a.ceeAConfirmer ? ' · à confirmer : le Coup de pouce vise le remplacement d\'une chaudière gaz ou fioul' : '') + '</small></dt><dd>− ' + euros(a.cee) + '</dd></div>';
      h += '<div class="total"><dt>Reste à charge à la signature</dt><dd>' + euros(a.racSignature) + '</dd></div>';
      h += '<div class="moins"><dt>MaPrimeRénov\' estimée <small>Versée par l\'Anah après les travaux' + (a.ecrete ? ' · ajustée : le total des aides est plafonné à ' + Math.round(a.tauxEcretement * 100) + ' % du prix TTC (au lieu de ' + euros(a.mprBrut) + ')' : '') + '</small></dt><dd>− ' + euros(a.mpr) + '</dd></div>';
      h += '<div class="total final"><dt>' + (a.racFinal === 0
        ? 'Reste à charge final estimé : 0 € <small>(' + reserve + ')</small>'
        : 'Reste à charge final après versement de MaPrimeRénov\'') + '</dt><dd>' + euros(a.racFinal) + '</dd></div>';
    }
    h += '</dl>';
    if (a.connu && a.racFinal > 0) {
      h += '<div class="encadre encadre-vert mt-2"><p class="mb-0"><strong>Vous ne voulez pas payer ce reste à charge ? Une solution s\'offre à vous.</strong><br>' +
        'Devenez <strong>Partenaire Vitrine Eco Roy</strong> : vous accueillez notre panneau devant votre maison pendant les travaux et quelques mois après, et vous partagez votre témoignage avec photos avant/après sur notre site. ' +
        'En échange, Eco Roy peut prendre en charge tout ou partie de votre reste à charge.</p>' +
        '<p class="mention mb-0">Offre sous conditions et en nombre limité. La remise est indiquée sur votre devis. Votre conseiller vous la présente lors de son appel.</p></div>';
    }
    if (!a.connu) h += '<p class="mention mt-2 mb-0">Sans votre profil MaPrimeRénov\', les aides (prime CEE et MaPrimeRénov\') seront calculées par votre conseiller et déduites de ce prix.</p>';
    h += '<p class="mention mt-2 mb-0">Estimation indicative, ' + reserve + '.</p></div>';
    return h;
  }

  function departement(cp) {
    cp = String(cp || "");
    if (cp.slice(0, 2) === "20") return parseInt(cp, 10) < 20200 ? "2A" : "2B";
    return cp.slice(0, 2);
  }

  /**
   * Dimensionnement indicatif — méthode G × V × ΔT (coefficient volumique de déperditions).
   *   V  = surface chauffée (m²) × hauteur sous plafond (m)                     [m³]
   *   G  = coefficient selon la période de construction (W/m³.K),
   *        réduit de 10 % par poste isolé déclaré (combles, murs, fenêtres),
   *        en cumul additif (G × (1 − 0,10 × n)), sans descendre sous 0,6.
   *   Tbase = température extérieure de base du département (CONFIG.tbase, défaut −7 °C)
   *        + correction d'altitude (−1 °C par tranche de 200 m au-delà de 200 m).
   *   ΔT = 19 °C − Tbase
   *   Déperditions (W) = G × V × ΔT
   *   Puissance conseillée = déperditions × 1,1, arrondie à la gamme commerciale supérieure
   *        (6, 8, 11, 12, 14, 16, 22 kW).
   * Ce calcul est une approche simplifiée : il ne remplace pas l'étude thermique pièce par pièce
   * (NF EN 12831) faite par le technicien lors de la visite.
   */
  function dimensionner(d) {
    var postes = (d.isolation || []).filter(function (p) { return p === "combles" || p === "murs" || p === "fenetres"; });
    var gBase = CONFIG.gBase[d.annee] || CONFIG.gBase["1975-1989"];
    var g = Math.max(CONFIG.gMin, gBase * (1 - CONFIG.reductionIsolation * postes.length));
    g = Math.round(g * 1000) / 1000;
    var volume = Math.round(d.surface * d.hauteur * 10) / 10;
    var dep = departement(d.cp);
    var tbaseDep = CONFIG.tbase.hasOwnProperty(dep) ? CONFIG.tbase[dep] : CONFIG.tbaseDefaut;
    var corrAlt = CONFIG.altitude[d.altitude] || 0;
    var tbase = tbaseDep + corrAlt;
    var deltaT = CONFIG.tInterieure - tbase;
    var deperditionsW = Math.round(g * volume * deltaT);
    var puissanceCalculeeKw = Math.round(deperditionsW * CONFIG.marge / 10) / 100;
    var gamme = null;
    for (var i = 0; i < CONFIG.gammes.length; i++) if (CONFIG.gammes[i] >= puissanceCalculeeKw - 1e-9) { gamme = CONFIG.gammes[i]; break; }
    var horsGamme = gamme === null;
    if (horsGamme) gamme = CONFIG.gammes[CONFIG.gammes.length - 1];

    var hauteTemp = d.emetteurs === "fonte" || d.emetteurs === "acier-alu" || d.emetteurs === "mixte";
    var typePac = d.emetteurs === "plancher" ? "PAC air/eau basse température (35-45 °C)"
      : hauteTemp ? "PAC air/eau haute température (55-65 °C)" : "PAC air/eau";
    var ballon = d.ecs ? ((d.nbPersonnes || 0) >= CONFIG.ballonSeuilPersonnes ? CONFIG.ballonLitresGrand : CONFIG.ballonLitres) : 0;
    var ecsLibelle = d.ecs ? "Module ECS / ballon " + ballon + " L" : "Non (chauffage seul)";
    var prixTTC = CONFIG.prix[gamme] + (d.ecs ? CONFIG.prixEcs : 0);
    var alertes = [];
    if (gamme >= CONFIG.seuilTriphaseKw && d.compteur === "mono") alertes.push("Vérifier le passage en triphasé / la puissance du compteur.");
    if (gamme >= CONFIG.seuilTriphaseKw && d.compteur === "nsp") alertes.push("Puissance élevée : le technicien vérifiera votre compteur (monophasé ou triphasé, puissance souscrite).");
    if (horsGamme) alertes.push("Besoin supérieur à 22 kW : une étude spécifique est nécessaire (isolation préalable ou installation en cascade). Le prix affiché correspond à 22 kW.");
    if (d.emetteurs === "mixte") alertes.push("Radiateurs + plancher chauffant : prévoir un kit 2 zones (vanne mélangeuse) pour le plancher.");

    return {
      anneeConstruction: d.annee, gBase: gBase, isolation: postes, g: g,
      surface: d.surface, hauteur: d.hauteur, volume: volume, niveaux: d.niveaux,
      emetteurs: d.emetteurs, ecs: !!d.ecs, nbPersonnes: d.nbPersonnes || null, ballonLitres: ballon || null,
      altitude: d.altitude, compteur: d.compteur,
      cp: d.cp, departement: dep, tbaseDepartement: tbaseDep, correctionAltitude: corrAlt, tbase: tbase,
      tInterieure: CONFIG.tInterieure, deltaT: deltaT,
      deperditionsW: deperditionsW, deperditionsKw: Math.round(deperditionsW / 100) / 10,
      puissanceCalculeeKw: puissanceCalculeeKw, puissanceConseilleeKw: gamme, horsGamme: horsGamme,
      hauteTemperature: hauteTemp, typePac: typePac, ecsLibelle: ecsLibelle,
      alerteTriphase: gamme >= CONFIG.seuilTriphaseKw && d.compteur === "mono",
      alertes: alertes, prixTTC: prixTTC,
      produit: typePac.replace(/ \(.*\)$/, "") + " " + gamme + " kW" + (d.ecs ? " + module ECS / ballon " + ballon + " L" : "")
    };
  }

  window.EcoRoy.dimensionner = dimensionner;
  window.EcoRoy.calculAides = calculAides;
  window.EcoRoy.CONFIG = CONFIG;

  /* ==================================================================
     TUNNEL APRÈS SIMULATION : questionnaire → note + pré-devis → photos → envoi
  ================================================================== */
  var tunnel = null;
  function ouvrirTunnel(ctx) {
    if (!tunnel) tunnel = creerTunnel(ctx);
    tunnel.ouvrir();
  }

  var LIB = {
    annee: { "avant-1975": "Avant 1975", "1975-1989": "1975 à 1989", "1990-2005": "1990 à 2005", "2006-2012": "2006 à 2012", "apres-2012": "Après 2012" },
    isolation: { combles: "combles", murs: "murs", fenetres: "fenêtres double vitrage" },
    niveaux: { "1": "Plain-pied", "2": "2 niveaux", "3+": "3 niveaux ou plus" },
    emetteurs: { fonte: "Radiateurs fonte", "acier-alu": "Radiateurs acier / alu", plancher: "Plancher chauffant", mixte: "Mixte (radiateurs + plancher)" },
    altitude: { "moins-200": "Moins de 200 m", "200-400": "200 à 400 m", "400-800": "400 à 800 m", "plus-800": "Plus de 800 m" },
    compteur: { mono: "Monophasé", tri: "Triphasé", nsp: "Ne sait pas" }
  };
  var TYPES_PHOTOS = [
    { kind: "chaudiere", titre: "Votre chaudière actuelle", aide: "Vue d'ensemble, avec les tuyaux et raccordements visibles." },
    { kind: "unite-exterieure", titre: "Emplacement prévu de l'unité extérieure", aide: "Le mur choisi, pris avec du recul pour voir le sol, les fenêtres et l'espace autour." },
    { kind: "radiateur", titre: "Un radiateur", aide: "Un radiateur entier, si possible avec sa vanne." },
    { kind: "tableau-electrique", titre: "Tableau électrique et compteur", aide: "Le compteur et le disjoncteur général, étiquettes lisibles." },
    { kind: "plaque-chaudiere", titre: "Plaque signalétique de la chaudière", facultatif: true, aide: "L'étiquette avec la marque, le modèle et la puissance." }
  ];

  /** Compression navigateur : 1600 px max, JPEG 0,75 (puis plus fort si encore trop lourd). */
  function compresserImage(fichier) {
    function charger() {
      if (window.createImageBitmap) {
        return createImageBitmap(fichier, { imageOrientation: "from-image" }).catch(function () { return createImageBitmap(fichier); });
      }
      return new Promise(function (ok, ko) {
        var url = URL.createObjectURL(fichier);
        var img = new Image();
        img.onload = function () { URL.revokeObjectURL(url); ok(img); };
        img.onerror = function () { URL.revokeObjectURL(url); ko(new Error("image illisible")); };
        img.src = url;
      });
    }
    return charger().then(function (img) {
      function rendre(maxPx, qualite) {
        var l = img.width, h = img.height, r = Math.min(1, maxPx / Math.max(l, h));
        var c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(l * r)); c.height = Math.max(1, Math.round(h * r));
        var cx = c.getContext("2d");
        cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
        cx.drawImage(img, 0, 0, c.width, c.height);
        return c.toDataURL("image/jpeg", qualite);
      }
      var url = rendre(CONFIG.photoMaxPx, CONFIG.photoQualite);
      if (url.length > CONFIG.photoMaxCaracteres) url = rendre(1280, 0.6);
      if (url.length > CONFIG.photoMaxCaracteres) url = rendre(1024, 0.5);
      if (img.close) img.close();
      return url;
    });
  }

  function attendre(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }

  /** Altitude (m) de la maison : géocodage BAN puis altimétrie IGN. Résout null en cas d'échec (on garde « moins de 200 m »). */
  function trouverAltitude(adresse, cp, ville) {
    var q = [adresse, cp, ville].filter(Boolean).join(" ");
    if (!q || !window.fetch) return Promise.resolve(null);
    var delai = function (p) { return Promise.race([p, new Promise(function (ok) { setTimeout(function () { ok(null); }, 6000); })]); };
    return delai(fetch("https://api-adresse.data.gouv.fr/search/?limit=1&q=" + encodeURIComponent(q) + (cp ? "&postcode=" + encodeURIComponent(cp) : ""))
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var f = j && j.features && j.features[0]; if (!f) return null;
        var c = f.geometry.coordinates;
        return fetch("https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json?resource=ign_rge_alti_wld&zonly=true&lon=" + c[0] + "&lat=" + c[1])
          .then(function (r) { return r.json(); })
          .then(function (a) { var z = a && a.elevations && a.elevations[0]; z = typeof z === "object" && z ? z.z : z; return (typeof z === "number" && z > -100) ? z : null; });
      })).catch(function () { return null; });
  }

  function creerTunnel(ctx) {
    var form = document.getElementById("dimensionnement");
    var formSim = ctx.formSimulateur;
    var sections = {};
    Array.prototype.forEach.call(form.querySelectorAll("[data-detape]"), function (s) { sections[s.getAttribute("data-detape")] = s; });
    var QUESTIONS = ["annee", "isolation", "volume", "niveaux", "emetteurs", "ecs", "compteur"];
    var ORDRE = QUESTIONS.concat(["note", "photos", "fin"]);
    var btnRetour = document.getElementById("dim-retour");
    var btnSuivant = document.getElementById("dim-suivant");
    var nav = document.getElementById("dim-nav");
    var barre = document.getElementById("dim-barre");
    var texteProg = document.getElementById("dim-prog-texte");
    var zoneProg = document.getElementById("dim-progression");
    var zoneErreur = document.getElementById("dim-erreur-envoi");
    var rep = { altitude: "moins-200" };
    var resultat = null, aides = null;
    // Altitude trouvée automatiquement à partir de l'adresse (Base Adresse Nationale + IGN), sans question au client
    trouverAltitude(ctx.adresse, ctx.etat.cp, ctx.ville).then(function (m) {
      if (typeof m === "number" && isFinite(m)) { rep.altitudeM = Math.round(m); rep.altitude = m < 200 ? "moins-200" : m < 400 ? "200-400" : m < 800 ? "400-800" : "plus-800"; }
    });
    var courante = null;
    var photos = [];      // {id, kind, name, dataUrl, envoyee}
    var compteurId = 0;
    var envoiEnCours = false, dimEnvoye = false, envoiTente = false;

    // Pré-remplissages depuis le simulateur
    var champSurface = document.getElementById("d-surface");
    champSurface.value = ctx.etat.surface || "";
    var nbP = ctx.etat.personnes;
    document.getElementById("d-ecs-sous").textContent = "Votre foyer compte " + nbP + " personne" + (nbP > 1 ? "s" : "") +
      " : la PAC chaufferait un ballon de " + (nbP >= CONFIG.ballonSeuilPersonnes ? CONFIG.ballonLitresGrand : CONFIG.ballonLitres) + " L pour l'eau chaude sanitaire.";
    if (ctx.etat.age === "non") { var r5 = document.getElementById("d-an-5"); if (r5) r5.checked = true; }

    function valeurRadio(nom) { var r = form.querySelector('input[name="' + nom + '"]:checked'); return r ? r.value : ""; }
    function erreurEtape(msg) { var z = sections[courante].querySelector(".erreur-etape"); if (z) z.textContent = msg || ""; return !msg; }

    function afficher(nom) {
      Object.keys(sections).forEach(function (k) { sections[k].hidden = (k !== nom); });
      courante = nom;
      var iq = QUESTIONS.indexOf(nom);
      var pct, txt;
      if (iq !== -1) { pct = Math.round(iq / (QUESTIONS.length + 2) * 100); txt = "Question " + (iq + 1) + " sur " + QUESTIONS.length; }
      else if (nom === "note") { pct = Math.round(QUESTIONS.length / (QUESTIONS.length + 2) * 100); txt = "Votre note et pré-devis"; }
      else if (nom === "photos") { pct = Math.round((QUESTIONS.length + 1) / (QUESTIONS.length + 2) * 100); txt = "Photos avant chantier"; }
      else { pct = 100; txt = "Dossier envoyé"; }
      barre.style.width = Math.max(4, pct) + "%";
      texteProg.textContent = txt;
      zoneProg.setAttribute("aria-valuenow", String(pct));
      nav.hidden = (nom === "fin");
      btnSuivant.hidden = (nom === "photos");
      btnSuivant.textContent = sections[nom].getAttribute("data-bouton") || "Continuer";
      if (nom === "compteur") btnSuivant.textContent = "Voir ma note et mon pré-devis";
      zoneErreur.hidden = true;
      var titre = sections[nom].querySelector("legend, h2");
      if (titre) { titre.setAttribute("tabindex", "-1"); titre.focus({ preventScroll: true }); }
      if (form.getBoundingClientRect().top < 0) form.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    function valider(nom) {
      erreurEtape("");
      if (nom === "isolation") {
        var coches = Array.prototype.map.call(form.querySelectorAll('input[name="dIsolation"]:checked'), function (c) { return c.value; });
        if (!coches.length) return erreurEtape("Cochez les travaux réalisés, ou « Aucun de ces travaux ».");
        rep.isolation = coches.filter(function (v) { return v !== "aucun"; });
        return true;
      }
      if (nom === "volume") {
        var vs = parseInt(champSurface.value, 10);
        if (!(vs >= 15 && vs <= 1000)) { champSurface.focus(); return marquerErreur(champSurface, "Indiquez une surface entre 15 et 1 000 m²."); }
        marquerErreur(champSurface, "");
        rep.surface = vs;
        rep.hauteur = parseFloat(valeurRadio("dHauteur") || "2.5");
        return true;
      }
      var champs = { annee: "dAnnee", niveaux: "dNiveaux", emetteurs: "dEmetteurs", ecs: "dEcs", compteur: "dCompteur" };
      if (champs[nom]) {
        var v = valeurRadio(champs[nom]);
        if (!v) return erreurEtape("Merci de choisir une réponse pour continuer.");
        rep[nom] = v;
      }
      return true;
    }

    function calculer() {
      resultat = dimensionner({
        annee: rep.annee, isolation: rep.isolation, surface: rep.surface, hauteur: rep.hauteur, niveaux: rep.niveaux,
        emetteurs: rep.emetteurs, ecs: rep.ecs === "oui", nbPersonnes: ctx.etat.personnes,
        altitude: rep.altitude, compteur: rep.compteur, cp: ctx.etat.cp
      });
      aides = calculAides(ctx.couleur, resultat.prixTTC, ctx.mprMontant, ctx.etat.chauffage);
      var r = resultat;
      var ligne = function (dt, dd) { return '<div><dt>' + dt + '</dt><dd>' + dd + '</dd></div>'; };
      var nf = function (n) { return String(n).replace(".", ","); };
      var h = '<h2 tabindex="-1">Note de dimensionnement indicative</h2>';
      h += '<p class="sous">Calculée à partir de vos réponses. Un technicien RGE la vérifie avant tout devis définitif.</p>';
      h += '<div class="preco"><div><span>Puissance conseillée</span><strong>' + r.puissanceConseilleeKw + ' kW</strong></div>' +
           '<div><span>Déperditions estimées</span><strong>' + kw(r.deperditionsKw) + '</strong></div>' +
           '<div><span>Type de PAC</span><strong style="font-size:1.1rem">' + echapper(r.typePac) + '</strong></div>' +
           '<div><span>Eau chaude sanitaire</span><strong style="font-size:1.1rem">' + echapper(r.ecsLibelle) + '</strong></div></div>';
      r.alertes.forEach(function (a) { h += '<div class="alerte alerte-attention"><p class="mb-0">' + echapper(a) + '</p></div>'; });
      h += '<details class="faq" style="margin-top:8px"><summary>Le détail du calcul</summary><div><dl class="note-recap">';
      h += ligne("Construction", LIB.annee[r.anneeConstruction]);
      h += ligne("Isolation déjà faite", r.isolation.length ? r.isolation.map(function (p) { return LIB.isolation[p]; }).join(", ") : "aucune");
      h += ligne("Surface chauffée", r.surface + " m²");
      h += ligne("Hauteur sous plafond", nf(r.hauteur) + " m");
      h += ligne("Volume chauffé", nf(r.volume) + " m³");
      h += ligne("Niveaux", LIB.niveaux[r.niveaux]);
      h += ligne("Émetteurs", LIB.emetteurs[r.emetteurs]);
      h += ligne("Compteur", LIB.compteur[r.compteur]);
      h += ligne("Coefficient G", nf(r.g) + " W/m³.K");
      h += ligne("Temp. de base (" + r.departement + ", " + (rep.altitudeM != null ? "altitude " + rep.altitudeM + " m" : LIB.altitude[r.altitude].toLowerCase()) + ")", nf(r.tbase) + " °C");
      h += ligne("Écart de température", nf(r.deltaT) + " °C");
      h += ligne("Puissance calculée (+10 %)", kw(r.puissanceCalculeeKw, 2));
      h += '</dl><p class="mention mt-2 mb-0">Méthode : déperditions = G × volume × (19 °C − température de base), puissance = déperditions × 1,1 arrondie à la gamme supérieure.</p></div></details>';
      h += '<h2 class="mt-2" style="font-size:clamp(1.25rem,4vw,1.5rem)">Pré-devis indicatif</h2>';
      h += blocAides(aides, r.prixTTC, r.produit, "Fourniture et pose");
      h += '<div class="alerte alerte-info"><p class="mb-0"><strong>Devis définitif après validation des photos et visite technique par un technicien RGE.</strong></p></div>';
      document.getElementById("dim-note").innerHTML = h;
    }

    function preDevis() {
      return {
        prixTTC: resultat.prixTTC, cee: aides.connu ? aides.cee : null, mpr: aides.connu ? aides.mpr : null,
        racSignature: aides.connu ? aides.racSignature : null, racFinal: aides.connu ? aides.racFinal : null,
        puissance: resultat.puissanceConseilleeKw, produit: resultat.produit
      };
    }

    function avancer() {
      if (envoiEnCours) return;
      if (!valider(courante)) return;
      if (courante === "compteur") calculer();
      var i = ORDRE.indexOf(courante);
      if (ORDRE[i + 1]) afficher(ORDRE[i + 1]);
    }

    form.addEventListener("submit", function (e) { e.preventDefault(); avancer(); });
    btnRetour.addEventListener("click", function () {
      if (envoiEnCours) return;
      var i = ORDRE.indexOf(courante);
      if (i <= 0) { form.hidden = true; formSim.hidden = false; var t = document.getElementById("res-titre"); if (t) t.focus({ preventScroll: true }); formSim.scrollIntoView({ block: "start" }); return; }
      afficher(ORDRE[i - 1]);
    });
    form.addEventListener("pointerup", function (e) {
      var label = e.target.closest ? e.target.closest(".choix label") : null;
      if (!label) return;
      var input = document.getElementById(label.getAttribute("for"));
      if (!input || input.type !== "radio" || courante === "volume") return;
      setTimeout(function () { if (input.checked && sections[courante] && sections[courante].contains(input)) avancer(); }, 180);
    });
    // « Aucun » est exclusif des autres cases
    form.addEventListener("change", function (e) {
      if (e.target.name !== "dIsolation") return;
      if (e.target.value === "aucun" && e.target.checked) {
        Array.prototype.forEach.call(form.querySelectorAll('input[name="dIsolation"]'), function (c) { if (c.value !== "aucun") c.checked = false; });
      } else if (e.target.checked) {
        document.getElementById("d-iso-aucun").checked = false;
      }
    });

    /* ----- Photos ----- */
    var liste = document.getElementById("ph-liste");
    var erreurPh = document.getElementById("ph-erreur");
    var btnEnvoyer = document.getElementById("ph-envoyer");
    var btnPlusTard = document.getElementById("ph-plus-tard");
    var progZone = document.getElementById("ph-progression");
    var progTexte = document.getElementById("ph-prog-texte");
    var progBarre = document.getElementById("ph-barre");
    var progRole = document.getElementById("ph-barre-zone");
    var erreurEnvoi = document.getElementById("ph-erreur-envoi");
    var compteurTxt = document.getElementById("ph-compteur");

    liste.innerHTML = TYPES_PHOTOS.map(function (t) {
      var id = "ph-" + t.kind;
      return '<li class="photo-item" data-kind="' + t.kind + '"><h3 id="' + id + '-titre">' + echapper(t.titre) + (t.facultatif ? ' <small>(facultatif)</small>' : '') + '</h3>' +
        '<p id="' + id + '-aide">' + echapper(t.aide) + '</p>' +
        '<input type="file" id="' + id + '" accept="image/*" multiple aria-describedby="' + id + '-aide">' +
        '<label class="btn btn-contour" for="' + id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>Ajouter une photo<span class="sr-only"> : ' + echapper(t.titre) + '</span></label>' +
        '<ul class="vignettes" aria-label="Photos ajoutées : ' + echapper(t.titre) + '"></ul></li>';
    }).join("");

    function majPhotos() {
      TYPES_PHOTOS.forEach(function (t) {
        var li = liste.querySelector('[data-kind="' + t.kind + '"]');
        var ph = photos.filter(function (p) { return p.kind === t.kind; });
        li.classList.toggle("fait", ph.length > 0);
        li.querySelector(".vignettes").innerHTML = ph.map(function (p, i) {
          return '<li><img src="' + p.dataUrl + '" alt="' + echapper(t.titre) + ', photo ' + (i + 1) + '">' +
            (p.envoyee ? '<span class="statut">Envoyée</span>' : '<button type="button" data-suppr="' + p.id + '" aria-label="Supprimer la photo ' + (i + 1) + ' : ' + echapper(t.titre) + '">×</button>') + '</li>';
        }).join("");
        li.querySelector('input[type="file"]').disabled = envoiEnCours || photos.length >= CONFIG.photosMax;
      });
      compteurTxt.textContent = photos.length + " photo" + (photos.length > 1 ? "s" : "") + " sur " + CONFIG.photosMax + " maximum";
      btnEnvoyer.disabled = envoiEnCours || photos.length === 0;
      btnPlusTard.disabled = envoiEnCours;
      var restantes = photos.filter(function (p) { return !p.envoyee; }).length;
      btnEnvoyer.textContent = (photos.length && restantes && (envoiTente || restantes < photos.length)) ? "Reprendre l'envoi" : (photos.length > 1 ? "Envoyer mes " + photos.length + " photos" : "Envoyer mes photos");
    }

    liste.addEventListener("change", function (e) {
      var input = e.target;
      if (input.type !== "file") return;
      var kind = input.closest(".photo-item").getAttribute("data-kind");
      var fichiers = Array.prototype.slice.call(input.files || []);
      input.value = "";
      erreurPh.textContent = "";
      var place = CONFIG.photosMax - photos.length;
      if (fichiers.length > place) {
        erreurPh.textContent = "Maximum " + CONFIG.photosMax + " photos : " + (fichiers.length - place) + " photo(s) non ajoutée(s).";
        fichiers = fichiers.slice(0, Math.max(0, place));
      }
      fichiers.reduce(function (p, f) {
        return p.then(function () {
          if (!/^image\//.test(f.type || "image/")) { erreurPh.textContent = "« " + f.name + " » n'est pas une image."; return; }
          return compresserImage(f).then(function (dataUrl) {
            photos.push({ id: ++compteurId, kind: kind, name: (f.name || "photo").replace(/\.[^.]+$/, "") + ".jpg", dataUrl: dataUrl, envoyee: false });
          }, function () { erreurPh.textContent = "La photo « " + f.name + " » n'a pas pu être lue. Essayez une autre photo."; });
        });
      }, Promise.resolve()).then(majPhotos);
    });
    liste.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-suppr]") : null;
      if (!b || envoiEnCours) return;
      var id = parseInt(b.getAttribute("data-suppr"), 10);
      var kind = (photos.filter(function (p) { return p.id === id; })[0] || {}).kind;
      photos = photos.filter(function (p) { return p.id !== id; });
      majPhotos();
      var lab = liste.querySelector('[data-kind="' + kind + '"] label');
      if (lab) document.getElementById(lab.getAttribute("for")).focus();
    });

    function base() {
      var b = { tel: ctx.tel, nom: ctx.nom };
      if (ctx.token) b.token = ctx.token;
      return b;
    }

    function progression(fait, total, texte) {
      var pct = total ? Math.round(fait / total * 100) : 100;
      progBarre.style.width = Math.max(4, pct) + "%";
      progRole.setAttribute("aria-valuenow", String(pct));
      progTexte.textContent = texte;
    }

    /** Une requête par photo ; 3 tentatives (attente 1 s puis 3 s) ; reprise manuelle ensuite. */
    function envoyerPhotos() {
      var rang = function (k) { for (var i = 0; i < TYPES_PHOTOS.length; i++) if (TYPES_PHOTOS[i].kind === k) return i; return 99; };
      photos.sort(function (x, y) { return (y.envoyee - x.envoyee) || (rang(x.kind) - rang(y.kind)) || (x.id - y.id); });
      var aEnvoyer = photos.filter(function (p) { return !p.envoyee; });
      var total = photos.length;
      return aEnvoyer.reduce(function (chaine, p) {
        return chaine.then(function () {
          var n = photos.indexOf(p) + 1;
          progression(n - 1, total, "Envoi de la photo " + n + " sur " + total + "…");
          var payload = base();
          payload.action = "leadPhotos";
          payload.index = n; payload.total = total;
          payload.photos = [{ kind: p.kind, name: p.name, dataUrl: p.dataUrl }];
          var essai = function (k) {
            return envoyerAuCrm(payload, 60000).catch(function (err) {
              if (k >= 2) throw err;
              return attendre(k === 0 ? 1000 : 3000).then(function () { return essai(k + 1); });
            });
          };
          return essai(0).then(function () { p.envoyee = true; majPhotos(); });
        });
      }, Promise.resolve()).then(function () { progression(total, total, total + " photo" + (total > 1 ? "s" : "") + " envoyée" + (total > 1 ? "s" : "") + "."); });
    }

    function envoyerDimensionnement(plusTard) {
      var envoyees = photos.filter(function (p) { return p.envoyee; }).length;
      var d = {};
      Object.keys(resultat).forEach(function (k) { d[k] = resultat[k]; });
      d.couleurMPR = ctx.couleur || "";
      d.chauffageActuel = ctx.etat.chauffage || "";
      d.photosEnvoyees = envoyees;
      d.photosPlusTard = !!plusTard;
      var payload = base();
      payload.action = "leadDimensionnement";
      payload.prenom = ctx.prenom; payload.email = ctx.email; payload.cp = ctx.etat.cp || "";
      payload.dimensionnement = d;
      payload.preDevis = preDevis();
      payload.utm = utm();
      var essai = function (k) {
        return envoyerAuCrm(payload, 20000).catch(function (err) {
          if (k >= 2) throw err;
          return attendre(k === 0 ? 1000 : 3000).then(function () { return essai(k + 1); });
        });
      };
      return essai(0).then(function () {
        dimEnvoye = true;
        pousserDataLayer({ event: "dimensionnement_submitted", lead_puissance: resultat.puissanceConseilleeKw, lead_photos: envoyees });
      });
    }

    function terminer(plusTard) {
      if (envoiEnCours) return;
      envoiEnCours = true;
      erreurEnvoi.hidden = true;
      majPhotos();
      var etapePhotos = (!plusTard && photos.some(function (p) { return !p.envoyee; }));
      if (etapePhotos) envoiTente = true;
      if (etapePhotos) progZone.hidden = false;
      var chaine = etapePhotos ? envoyerPhotos() : Promise.resolve();
      var echecPhotos = false;
      chaine.catch(function (err) { echecPhotos = true; throw err; })
        .then(function () {
          if (dimEnvoye) return;
          if (etapePhotos) progTexte.textContent = "Envoi de votre note de dimensionnement…";
          return envoyerDimensionnement(plusTard);
        })
        .then(function () {
          envoiEnCours = false;
          var nb = photos.filter(function (p) { return p.envoyee; }).length;
          document.getElementById("dim-fin-photos").textContent = nb
            ? nb + " photo" + (nb > 1 ? "s" : "") + " reçue" + (nb > 1 ? "s" : "") + " avec votre note de dimensionnement."
            : "Vous pourrez envoyer vos photos plus tard : votre conseiller vous indiquera comment, ou montrez-les lors de la visite technique.";
          afficher("fin");
          form.scrollIntoView({ block: "start", behavior: "smooth" });
        })
        .catch(function () {
          envoiEnCours = false;
          majPhotos();
          var restantes = photos.filter(function (p) { return !p.envoyee; }).length;
          erreurEnvoi.innerHTML = (echecPhotos
            ? "<p><strong>L'envoi s'est interrompu</strong> (" + restantes + " photo" + (restantes > 1 ? "s" : "") + " restante" + (restantes > 1 ? "s" : "") + "). Les photos déjà envoyées sont conservées : appuyez sur « Reprendre l'envoi » pour continuer.</p>"
            : "<p><strong>Votre note n'a pas pu être envoyée.</strong> Vos réponses et vos photos sont conservées : réessayez dans un instant avec l'un des boutons ci-dessus.</p>") +
            '<p class="mb-0">Vous pouvez aussi nous appeler au <a href="tel:+33972149162"><strong>' + TEL_AFFICHE + '</strong></a>.</p>';
          erreurEnvoi.hidden = false;
          erreurEnvoi.focus();
        });
    }

    btnEnvoyer.addEventListener("click", function () { terminer(false); });
    btnPlusTard.addEventListener("click", function () { terminer(true); });
    majPhotos();

    return {
      ouvrir: function () {
        formSim.hidden = true;
        form.hidden = false;
        afficher(courante || "annee");
        form.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    };
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
        rappelLe: (document.getElementById("rappel-le") || {}).value || "", creneau: (document.getElementById("rappel-libelle") || {}).value || "",
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
        retour.innerHTML = "<p class=\"mb-0\"><strong>Merci, votre demande est bien enregistrée.</strong> Un conseiller vous rappelle au créneau choisi, ou dès que possible.</p>";
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
