# Plugin-architectuur — beslissingen en fase-afbakening

Status: fase 1 is gebouwd, gemerged en gepusht. Fase 2 t/m 5 zijn niet begonnen.
Anker: de fase 1-code staat op `main` sinds `a0f79d8`.

Dit document beschrijft **beslissingen en afbakening**, niet de implementatie. De code is de
bron van waarheid; waar dit document en de code verschillen, wint de code. Elke fase heeft
daarom een status en een verificatie die je kunt draaien.

Herzien na de ontwerpreview in `docs/reviews/plugin-architecture-review.md`. Die vroeg om
wijzigingen: de fase-2-belofte dat `app/router.py` een lus over de registry wordt, bleek niet te
kunnen, en aliassen, het view-contract en de omvang van fase 3 moesten opnieuw. Sectie 5 noemt
wat er is overgenomen en wat er afviel.

## 1. Wat is een plugin hier

Een plugin is **één sidebar-categorie met één of meer views**. Meer niet.

Wel:

- een beschrijving met een `id`, een label, en de views die eronder hangen
- per view een module en een factory
- later: eigen CSS, iconen, toegewezen routers, en een aan/uit-schakelaar

Niet, en dat is een bewuste grens:

- **geen isolatie of sandboxing.** Plugins delen het DOM en de global scope. `index.html` laadt
  markdown-it en DOMPurify globaal en de chatview leest `window.markdownit`. Een plugin krijgt
  dus volledige toegang tot de pagina. Zie fase 5 voor de drempel die dat stelt.
- **geen hot reload, geen versiebeheer per plugin, geen marketplace.**
- **geen package-manager.** Fase 5 gebruikt pip entry points voor discovery, niet als
  distributiemechanisme met versie-eisen.

## 2. Het contract zoals het nu is (fase 1)

### Manifest

`static/src/plugins/<id>/manifest.js`, data-only: strings, booleans en arrays, geen
geïmporteerde functies. Dat is de kern van het ontwerp — alleen een datavorm kan later door
Python geserveerd worden.

| Plugin-veld | Betekenis |
| --- | --- |
| `id` | stabiele plugin-id; bedoeld als settings-sleutel in fase 3, **nu nog nergens gelezen** |
| `label` | sidebar-sectiekop; leeg voor auxiliary plugins |
| `auxiliary` | `true` → los item onderaan de sidebar in plaats van een categorie |
| `views` | view-descriptors in sidebar-volgorde |

| View-veld | Betekenis |
| --- | --- |
| `id` | stabiele view-id |
| `route` | hash-route |
| `name` | sidebar-label |
| `icon` | symbol-id in `static/assets/icons.svg` |
| `tooltip` | optioneel; valt terug op `name` |
| `persistent` | view blijft in de DOM bij wegnavigeren |
| `module` | pad onder de static root, geresolveerd tegen `document.baseURI` |
| `factory` | geëxporteerde functienaam in die module; levert het view-element |

`module` en `factory` zijn strings en geen directe functies. Dat kost statische
verifieerbaarheid — een typefout breekt pas bij een klik — en dat is de prijs voor een vorm die
Python kan uitserveren. De testsuite compenseert dat.

### View-contract

Wat een view zelf moet zijn volgt uit de shell en stond tot deze herziening nergens beschreven.
Een plugin-auteur heeft dit nodig.

| | |
| --- | --- |
| factory | moet een DOM-element teruggeven; dat element wordt in de host geplaatst |
| `__onActivate()` | optioneel; aangeroepen zodra de view in de host staat (`static/app.js:172`) |
| `__onDeactivate()` | optioneel; aangeroepen bij wegnavigeren (`static/app.js:216`) |
| `WORKFLOW_BUSY_EVENT` | optioneel; meldt dat er werk loopt, waarop de sidebar een indicator toont. Vijf views doen dit |
| `__destroy()` | bestaat in twee views maar wordt door de router **nooit** aangeroepen. Reken er niet op |

Omdat een persistente view blijft bestaan, zijn `__onActivate`/`__onDeactivate` het paar waar
een view zijn polling start en stopt — niet constructie en opslag.

Replay meldt zijn status via een ouder event (`llm-workbench:replay-status`,
`static/src/workflows/replay/ui.js:4`) dat de shell apart afhandelt (`static/app.js:294`). Dat
is de enige view met een eigen signaal, en precies de hardcoding die fase 2 opruimt.

### Registry

`static/src/plugins/registry.js` is de enige plek die weet wat er bestaat:

| Export | Regel | Rol |
| --- | --- | --- |
| `PLUGINS` | 36 | de pluginlijst, in sidebar-volgorde |
| `ROUTE_ALIASES` | 48 | oude routenamen die blijven werken; **hoort in fase 2 naar de manifesten** |
| `WORKFLOWS` | 56 | alle views, plat |
| `normalizeRoute` | 60 | alias → routenaam |
| `getWorkflow` | 65 | route → view-descriptor |
| `loadView` | 75 | laadt de module en roept de factory aan; `retry` zet `?retry=<n>` |

De registry **laadt** views; hij bezit ze niet. Caching, activering en de DOM blijven van de
shell (`static/app.js`). Die grens is bewust: de registry is dan puur data + laden en hoeft geen
levenscyclus te kennen.

`WORKFLOWS_BY_ROUTE` (regel 58) is een `Map` over de routes: bij een dubbele route wint stil de
laatste. Zie sectie 4.

### Loadergedrag in de shell

Vier dingen bewaken het laden, alle in `static/app.js`:

- een gedeelde `pendingView` per route, zodat weg- en terugklikken tijdens een koude load de
  view niet twee keer bouwt;
- een generatie-teller (`mountGeneration`, regel 128) die een load weggooit die ná een nieuwere
  navigatie binnenkomt; op het succespad logt dat op `debug`, op het faalpad op `error`;
- een zichtbaar foutpaneel (`buildViewError`, regel 130) in plaats van een lege host, omdat
  `RouterCore.navigate()` de promise van `mount()` negeert;
- een retry met een verse module-URL, maar alleen als de `import()` zelf faalde — een manifest
  dat de verkeerde factory noemt wordt niet eindeloos opnieuw opgehaald.

### Waarom lazy loading

Views worden pas bij eerste activering geïmporteerd in plaats van alle 20 bij het opstarten.
Prijs: een koude view kost een networkrequest en kan even een placeholder tonen. Tweede prijs,
en die kostte een middag zoeken: een dynamic import valt buiten de cache-bypass van Ctrl+F5,
waardoor een gewijzigde view onzichtbaar kon blijven. Dat is server-side opgelost met
`Cache-Control: no-cache` (`app/main.py`, `RevalidatingStaticFiles`, regel 16).

## 3. Fasen

### Fase 1 — frontend leest zijn eigen configuratie ✅

| | |
| --- | --- |
| **Doel** | één plek die weet welke categorieën en views bestaan |
| **As-built** | 8 plugins (7 categorieën + 1 auxiliary), 20 views, 19 persistent, 4 aliassen |
| **Scopegrens** | geen backendwijziging, geen enable/disable, geen per-plugin assets, geen view-module aangeraakt |
| **Verificatie** | `node --test 'tests/js/**/*.test.mjs'` (6 tests, mutatie-geverifieerd), `./.venv/bin/python tests/browser/check_plugin_registry.py`, `pytest` onveranderd |
| **Hertoetsing** | drie reviewrondes: `docs/reviews/refactor-plugin-registry.md`, `docs/reviews/plugin-registry-hardening.md` |

### Fase 2 — Python wordt de bron van waarheid ⬜

**Doel: geen view zonder zijn backend.** Niet "router en sidebar kunnen niet meer uit elkaar
lopen" — dat is onhaalbaar. De view `icons` heeft geen backend en `replay_defaults_router` heeft
geen view, dus volledige gelijkschakeling kan niet bestaan. Consistentie is toetsbaar;
gelijkheid niet. Er is vandaag geen 1:1 op welke as dan ook: 8 plugins, 16 routers, 20 views.

Contractwijziging:

- Een **Python-pluginregistratie** beschrijft per plugin welke routers erbij horen. Expliciete
  mapping, **geen herindeling van `app/`**: `app/image_pool/training.py:18` importeert al
  `app/prompt_testing/pool_client`, dus pakketten per plugin herindelen zou het llm-pool-pakket
  een dependency van image-pool maken.
- De pluginlijst bereikt de browser als een **gegenereerde `plugins.js`** die één global zet,
  geladen met een blokkerende `<script>` vóór `app.js` — dezelfde vorm als het bestaande
  `window.__LLM_WORKBENCH_INITIAL_SHELL__` in `static/index.html:7-22`. Python blijft de bron van
  waarheid en de sidebar rendert synchroon. Geen fetch: de lijst verandert niet tijdens een
  sessie, dus een endpoint zou alleen een lege-sidebar-toestand en een async bootstrap toevoegen.
- **Aliassen verhuizen naar het manifest** van de plugin die het doel bezit. Dan reist een alias
  mee met de payload en verdwijnt hij automatisch met zijn plugin. Nu staan ze als globale
  constante in `registry.js:48-54` en blijven ze in JS achter zodra `PLUGINS` uit Python komt;
  in fase 3 zou een alias van een uitgeschakelde plugin naar een route wijzen die
  `getWorkflow()` niet kan oplossen, waarna de gebruiker stil op de defaultroute landt.

| | |
| --- | --- |
| **Scopegrens** | geen enable/disable (fase 3), geen per-plugin assets, geen `api-client.js`-herstructurering (fase 4), geen discovery buiten de repo (fase 5) |
| **Verificatie** | elke plugin met views heeft routers, behalve de auxiliary plugin — de toetsbare vorm van "geen view zonder zijn backend". De handgeschreven regressiepin verhuist mee naar Python, waar de bron van waarheid komt; de JS-suite houdt wat alleen JS kan controleren (module resolvet, factory geëxporteerd, icoon in de sprite). Die twee zijn geen duplicaat: de pin ontleent zijn waarde eraan dat hij een onafhankelijke, handgeschreven kopie is. Let op dat de JS-suite de pluginlijst dan niet meer importeert maar de gegenereerde global moet stubben — de tests verhuizen mee met de bron |

### Fase 3 — per-plugin assets en enable/disable ⬜

**Doel:** een installatie toont alleen wat ze nodig heeft, bijvoorbeeld LLM Pool-only.

Regels die nu al vastliggen:

- **`enabled` hoort niet in het manifest.** Een manifest beschrijft wat er *bestaat*, settings
  beschrijven wat *aan* staat. Twee payloads, bij het serveren samengevoegd. Zitten ze in één
  bestand, dan is het manifest geen statische data meer en verliest de regressiepin zijn betekenis.
- Afwezig betekent aan.
- Plugin-uit wint van view-aan.

| | |
| --- | --- |
| **Contractwijziging** | een plugin declareert zijn eigen CSS en iconen; `id` wordt de settings-sleutel |
| **Scopegrens** | geen hot reload; assets blijven statische bestanden zonder buildstap |
| **Verificatie** | een uitgeschakelde plugin levert geen sidebar-item én geen gemounte router |

### Fase 4 — de gedeelde api-client opsplitsen ⬜

Losgetrokken van fase 3 op advies van de review. `static/src/api-client.js` is 101 methodes in
één object (766 regels) en wordt door alle 20 views gebruikt. Dat is een herstructurering die
niets met enable/disable te maken heeft; zit hij in fase 3, dan is fase 3 de fase waarin het
misgaat.

| | |
| --- | --- |
| **Doel** | een plugin bezit zijn eigen API-calls, zodat `api-client.js` niet de nieuwe bottleneck wordt |
| **Scopegrens** | geen wijziging aan de endpoints zelf |

### Fase 5 — discovery buiten de repo ⬜

| | |
| --- | --- |
| **Doel** | een plugin kan in een eigen package leven |
| **Contractwijziging** | discovery via pip entry points; het manifestcontract blijft gelijk |
| **Scopegrens** | **alleen first-party.** Niet-isolatie is acceptabel zolang elke plugin code is die je sowieso zou draaien — hetzelfde vertrouwen als de repo zelf. Het moment dat je een plugin installeert zonder hem te lezen, is het klaar: het XSS-gat in `pluginItemMarkup` plus volledige DOM- en global-toegang maakt een manifest dan gelijk aan willekeurige code-uitvoering. Derden zijn dus geen aanscherping van dit ontwerp maar een ander ontwerp (iframe of worker), en dat is geen vervolgfase |

## 4. Bekende gaten en geaccepteerde schuld

Deze zijn bewust blijven liggen; ze horen bij een latere fase.

- `static/src/plugins/registry.js:27-45` — de 8 manifesten worden **handmatig** geïmporteerd en in
  een handmatige `PLUGINS`-array gezet. Een plugin toevoegen is dus map + import + arrayregel.
  Geen discovery. Fase 2 haalt dit weg.
- `app/router.py` heeft 16 handgeschreven `include_router`-regels, zonder enige koppeling met de
  plugin-indeling. Fase 2 maakt die koppeling expliciet.
- `ROUTE_ALIASES` staat globaal in `registry.js:48-54` in plaats van bij de plugin die het doel
  bezit. Fase 2 verplaatst ze.
- **Routebotsingen hebben geen gedefinieerd gedrag.** `WORKFLOWS_BY_ROUTE` (`registry.js:58`) laat
  bij een dubbele route stil de laatste winnen. De testsuite vangt dat voor de gecommitte set,
  maar vanaf fase 3 (settings) en zeker fase 5 (packages buiten de repo) is een botsing een
  runtime-geval zonder afgesproken uitkomst. Er moet een regel komen: weigeren bij het laden, of
  eerste-wint met een waarschuwing.
- Geen enable/disable, dus de hele workbench toont altijd alles.
- `css/app.css` is één globaal `@import`-manifest van 25 regels en er is één globale
  iconensprite; een plugin kan nog geen eigen assets bijdragen.
- `static/app.js:93`, `:106`, `:294`, `:327` — de shell hardcodeert `replay-translate`. Dat hoort
  **vóór** fase 2 als losse opruiming: het is een event-protocol tussen shell en view (vijf views
  doen het al via `WORKFLOW_BUSY_EVENT`), het is klein, en het haalt een hardcoded id weg voordat
  de bron van de sidebar verandert. In fase 2 meenemen maakt die diff onnodig groot.
- Het manifestveld `id` wordt in runtime nergens gelezen; het is gereserveerd voor fase 3.
- `static/app.js:60-68` (`pluginItemMarkup`) interpoleert `name`, `tooltip` en `route` ongeëscapet
  in `innerHTML`. Nu onschadelijk omdat de data statisch en gecommit is. Zodra manifesten van
  buiten de repo komen is dit een injectiepunt; `escapeHtml`/`escapeAttr` bestaan al in
  `static/src/shared/ui-helpers.js`.
- De defaultroute is impliciet `WORKFLOWS[0]` (`static/app.js:327`). Zodra plugins uit kunnen,
  wordt "eerste ingeschakelde plugin" een willekeurige landingspagina.

## 5. Genomen beslissingen, en wat afviel

| Beslissing | Afgevallen alternatief |
| --- | --- |
| Plugins als mappen in de repo, contract zo dat entry points later passen | Meteen pip-packages: veel ceremonie voor één gebruiker. Geen abstractie: overstappen wordt later een herontwerp |
| **Python als bron van waarheid via een gegenereerde `plugins.js`-global** | **Een endpoint `/api/plugins`** — dit document koos dat eerst, en de ontwerpreview keerde het om: de lijst verandert niet tijdens een sessie, dus een fetch levert niets op en voegt een lege-sidebar-toestand plus een async bootstrap toe. Een gedeeld JSON-bestand viel eerder al af omdat het de koppeling met de echte routers en settings verliest |
| **Expliciete mapping van plugin naar routers in de Python-registratie** | **`app/` herindelen zodat elk pakket één plugin is** — dan wordt `prompt_testing` gedeeld tussen llm-pool en image-pool, en dus een cross-plugin dependency |
| Data-only manifesten, `module`/`factory` als strings | Factory-functies direct importeren: werkt, maar valt niet uit te serveren |
| **Aliassen in het manifest van de plugin die het doel bezit** | Globaal laten in `registry.js`: dan blijft een deel van de configuratie in JS achter, wat fase 2 juist opheft |
| **`enabled` in settings, niet in het manifest** | In het manifest: dan is het manifest geen statische data meer en kan de regressiepin niets meer vastpinnen |
| **De `api-client.js`-splitsing als eigen fase** | In fase 3 laten: dat bundelt een herstructurering van 766 regels met enable/disable, en dan is fase 3 te groot om te reviewen |
| **`replay-translate` uit de shell halen als losse opruiming vóór fase 2** | In fase 2 meenemen: maakt de fase-2-diff groter zonder dat het iets met de bron van waarheid te maken heeft |
| Lazy loading bij eerste activering | Alles eager importeren: geen eerste-klik-kosten, maar ~21k regels JS parsen bij het opstarten |
| Registry laadt, shell bezit de levenscyclus en de DOM | Registry ook eigenaar van caching en activering: mengt data met DOM-beheer |

## 6. Nog open

1. Welke plugin bezit een router zonder view? `replay_defaults_router` bedient geen enkele view;
   hij zal aan `realtime-translation` gehangen moeten worden, maar dat is een aanname.
2. Is "elke plugin met views heeft routers, behalve de auxiliary plugin" genoeg als toets, of
   moet een view kunnen declareren dat hij geen backend nodig heeft? De auxiliary-vlag is nu de
   enige uitzondering, en dat is een plugin-eigenschap die toevallig samenvalt met een
   view-eigenschap.
3. De exacte vorm van de samengevoegde manifest-plus-settings-payload in fase 3.
4. Is de api-client-splitsing klaar wanneer elke plugin zijn eigen module heeft, of is een
   gedeelde namespace per domein beter?
