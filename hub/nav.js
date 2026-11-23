/*
 * d'Alba shared top menu.
 *
 * Add this one line to any d'Alba tool and the same menu appears at the top:
 *   <script src="https://dalba-hub.vercel.app/nav.js" defer></script>
 *
 * To add, rename or re-point a menu item, edit TOOLS below. Every site picks
 * up the change on its next page load.
 */
(function () {
  if (window.__dalbaNav || window.top !== window.self) return;
  window.__dalbaNav = true;

  var HUB = "https://dalba-hub.vercel.app/";
  var TOOLS = [
    { ko: "계약 관리", en: "Contracts", url: "https://dalba-creator-contracts.vercel.app/", host: "dalba-creator-contracts.vercel.app" },
    { ko: "콘텐츠 분석기", en: "Content analyzer", url: "https://dalba-content-analyzer.vercel.app/", host: "dalba-content-analyzer.vercel.app" },
    { ko: "매출 분석기", en: "Sales analyzer", url: "https://project-zizml.vercel.app/why.html", host: "project-zizml.vercel.app" },
    { ko: "메일 아웃리치", en: "Email outreach", url: "https://dalba-outreach.vercel.app/index.html", host: "dalba-outreach.vercel.app" },
    { ko: "PM 트래커", en: "PM tracker", url: "https://price-scraper-3bee.vercel.app/", host: "price-scraper-3bee.vercel.app" },
  ];

  function lang() {
    var m = document.cookie.match(/(?:^|; )dalba_lang=(\w+)/);
    if (m) return m[1] === "en" ? "en" : "ko";
    return (document.documentElement.lang || "").slice(0, 2) === "en" && !/[가-힣]/.test(document.title) ? "en" : "ko";
  }

  function build() {
    if (document.getElementById("dalba-nav")) return;
    var l = lang();
    var host = document.createElement("div");
    host.id = "dalba-nav";
    // Shadow DOM keeps each site's own styles from leaking into the menu, and the reverse.
    var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
    var css =
      ":host{all:initial;display:block}" +
      ".bar{display:flex;align-items:center;gap:6px;background:#141414;color:#fff;padding:0 14px;height:40px;overflow-x:auto;white-space:nowrap;" +
      "font:600 13px/1 system-ui,-apple-system,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;-webkit-font-smoothing:antialiased;scrollbar-width:none}" +
      ".bar::-webkit-scrollbar{display:none}" +
      "a{color:#cfcdc4;text-decoration:none;padding:7px 12px;border-radius:999px;flex:none}" +
      "a:hover{color:#fff;background:rgba(255,255,255,.1)}" +
      "a.on{background:#f2c029;color:#141414}" +
      "a.home{color:#fff;font-weight:800;letter-spacing:-.01em;padding-left:4px;margin-right:6px}" +
      "a.home:hover{background:none;color:#f2c029}";
    var html = '<a class="home" href="' + HUB + '">d\'Alba</a>';
    for (var i = 0; i < TOOLS.length; i++) {
      var t = TOOLS[i];
      html += '<a href="' + t.url + '"' + (location.hostname === t.host ? ' class="on" aria-current="page"' : "") + ">" + (l === "en" ? t.en : t.ko) + "</a>";
    }
    root.innerHTML = "<style>" + css + '</style><nav class="bar" aria-label="d\'Alba tools">' + html + "</nav>";
    document.body.insertBefore(host, document.body.firstChild);
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
