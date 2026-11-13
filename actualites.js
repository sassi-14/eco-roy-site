/* Eco-Roy — actualités : articles publiés depuis le CRM (statut « publie ») */
(function () {
  "use strict";
  var API = "https://script.google.com/macros/s/AKfycbxWwNz2tSdQk_rWAayu3kLpJKNFqvpUZ0C4-IuY5-xJ9FirAxQFi5eE2tPSR5o4Byja/exec?action=actus";
  var MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
  function dateFr(s) { var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? (+m[3]) + " " + MOIS[+m[2] - 1] + " " + m[1] : ""; }
  function txt(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  // Nettoyage : on ne garde que quelques balises de mise en forme et les liens http(s)
  function propre(html) {
    var tpl = document.createElement("template"); tpl.innerHTML = String(html || "");
    var OK = { P: 1, H2: 1, H3: 1, UL: 1, OL: 1, LI: 1, STRONG: 1, EM: 1, A: 1, BR: 1, BLOCKQUOTE: 1 };
    (function net(n) {
      Array.prototype.slice.call(n.childNodes).forEach(function (c) {
        if (c.nodeType === 3) return;
        if (c.nodeType !== 1 || !OK[c.tagName]) { if (c.nodeType === 1) { net(c); while (c.firstChild) n.insertBefore(c.firstChild, c); } n.removeChild(c); return; }
        var href = c.tagName === "A" ? c.getAttribute("href") : null;
        Array.prototype.slice.call(c.attributes).forEach(function (a) { c.removeAttribute(a.name); });
        if (href && /^https?:\/\//i.test(href)) { c.setAttribute("href", href); c.setAttribute("rel", "noopener nofollow"); c.setAttribute("target", "_blank"); }
        net(c);
      });
    })(tpl.content);
    return tpl.innerHTML;
  }
  function charger() { return fetch(API).then(function (r) { return r.json(); }).then(function (j) { return j.articles || []; }); }

  // Bloc « dernières actualités » sur l'accueil
  var bloc = document.getElementById("actus-accueil");
  if (bloc) {
    charger().then(function (L) {
      if (!L.length) return;
      bloc.querySelector(".actu-cartes").innerHTML = L.slice(0, 3).map(function (a) {
        return '<a class="actu-carte" href="actualites.html?a=' + encodeURIComponent(a.slug) + '"><span class="actu-meta">' + txt(a.categorie || "Actualité") + " · " + dateFr(a.date) + "</span><strong>" + txt(a.titre) + "</strong><span>" + txt(a.resume) + "</span></a>";
      }).join("");
      bloc.hidden = false;
    }).catch(function () {});
  }

  // Page Actualités
  var liste = document.getElementById("actu-liste");
  if (!liste) return;
  var art = document.getElementById("actu-article");
  var slug = new URLSearchParams(location.search).get("a");
  charger().then(function (L) {
    if (slug) {
      var a = L.filter(function (x) { return x.slug === slug; })[0];
      if (a) {
        document.title = a.titre + " | Actualités Eco-Roy";
        document.getElementById("actu-titre").textContent = a.titre;
        document.getElementById("actu-chapo").textContent = a.resume;
        var src = String(a.sources || "").split(/\s+/).filter(function (u) { return /^https?:\/\//.test(u); });
        art.innerHTML = '<p class="actu-meta">' + txt(a.categorie || "Actualité") + " · publié le " + dateFr(a.date) + "</p>" + propre(a.contenu) +
          (src.length ? '<h3>Sources</h3><ul>' + src.map(function (u) { return '<li><a href="' + txt(u) + '" target="_blank" rel="noopener nofollow">' + txt(u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]) + "</a></li>"; }).join("") + "</ul>" : "") +
          '<p><a href="actualites.html">← Toutes les actualités</a></p>';
        art.hidden = false; liste.hidden = true; return;
      }
    }
    liste.innerHTML = L.length ? L.map(function (a) {
      return '<a class="actu-carte" href="actualites.html?a=' + encodeURIComponent(a.slug) + '"><span class="actu-meta">' + txt(a.categorie || "Actualité") + " · " + dateFr(a.date) + "</span><strong>" + txt(a.titre) + "</strong><span>" + txt(a.resume) + "</span></a>";
    }).join("") : '<p class="mention">Les premières actualités arrivent très bientôt.</p>';
  }).catch(function () { liste.innerHTML = '<p class="mention">Les actualités ne peuvent pas être chargées pour le moment. Réessayez dans quelques instants.</p>'; });
})();
