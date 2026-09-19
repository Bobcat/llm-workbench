# Plugin-architectuur — beslissingen en fase-afbakening

Status: fase 1 en 2 zijn gebouwd. Fase 3 t/m 5 zijn niet begonnen.
Anker: sectie 2 beschrijft de code op deze branch. Fase 1 landde met `783f0bd` en de
replay-opruiming met `8d73503`; de pdf-fix `a0f79d8` staat op `main` maar raakt deze architectuur
niet.

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

## 2. Het contract zoals het nu is

### De registratie

`app/plugins.py` is de bron van waarheid. Twee dingen komen daaruit voort: `app/router.py` mount
de routers die erin genoemd staan, en FastAPI genereert `/plugins.js` uit dezelfde gegevens.
Daardoor kunnen de routetabel en de sidebar niet uit elkaar lopen zonder dat een test het merkt.

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
| `routers` | de routers die deze view bedienen; één router mag door meerdere views gedeeld worden |
| `aliases` | gepensioneerde routenamen die naar deze view wijzen |
| `backend` | `false` voor een view die aantoonbaar geen API heeft; alleen `icons` |

`module` en `factory` zijn strings en geen directe functies. Dat kost statische
verifieerbaarheid — een typefout breekt pas bij een klik — en dat is de prijs voor een vorm die
de backend kan uitserveren. De JS-testsuite compenseert dat.

Naar de browser gaat alleen data: `frontend_payload()` laat `routers` en `backend` weg, want de
frontend heeft ze niet nodig. `/plugins.js` zet die payload als één global,
`window.__LLM_WORKBENCH_PLUGINS__`, en `static/index.html` laadt dat bestand met een blokkerende
`<script>` vóór `app.js`. Een fetch zou niets opleveren — de lijst verandert niet tijdens een
sessie — en wel een lege-sidebar-toestand om gedrag voor te verzinnen.

### View-contract

Wat een view zelf moet zijn volgt uit de shell en stond tot deze herziening nergens beschreven.
Een plugin-auteur heeft dit nodig.

| | |
| --- | --- |
| factory | moet een DOM-element teruggeven; dat element wordt in de host geplaatst |
| `__onActivate()` | optioneel; aangeroepen zodra de view in de host staat (`static/app.js:163`) |
| `__onDeactivate()` | optioneel; aangeroepen bij wegnavigeren (`static/app.js:207`) |
| `WORKFLOW_BUSY_EVENT` | optioneel; meldt dat er werk loopt, waarop de sidebar een indicator toont. Vijf views doen dit |
| `__destroy()` | bestaat in twee views maar wordt door de router **nooit** aangeroepen. Reken er niet op |

Omdat een persistente view blijft bestaan, zijn `__onActivate`/`__onDeactivate` het paar waar
een view zijn polling start en stopt — niet constructie en opslag.

Replay meldde zijn status eerder via een eigen event (`llm-workbench:replay-status`) dat de shell
apart afhandelde. Dat is de losse opruiming vóór fase 2 geworden: ook replay publiceert nu
`WORKFLOW_BUSY_EVENT`, en de shell kent geen enkele view meer bij naam — op de fallback voor een
lege registry na, die in sectie 4 staat.

### Registry

`static/src/plugins/registry.js` leest die gegenereerde lijst en leidt er de sidebar, de
routetabel en de loader uit af:

| Export | Regel | Rol |
| --- | --- | --- |
| `PLUGINS` | 38 | de pluginlijst uit de gegenereerde global; ontbreekt die, dan gooit de module een fout |
| `ROUTE_ALIASES` | 42 | oude routenamen, opgebouwd uit de `aliases` per view |
| `WORKFLOWS` | 48 | alle views, plat |
| `normalizeRoute` | 52 | alias → routenaam |
| `getWorkflow` | 57 | route → view-descriptor |
| `loadView` | 67 | laadt de module en roept de factory aan; `retry` zet `?retry=<n>` |

De registry **laadt** views; hij bezit ze niet. Caching, activering en de DOM blijven van de
shell (`static/app.js`). Die grens is bewust: de registry is dan puur data + laden en hoeft geen
levenscyclus te kennen.

`WORKFLOWS_BY_ROUTE` (regel 58) is een `Map` over de routes: bij een dubbele route wint stil de
laatste. Zie sectie 4.

### Loadergedrag in de shell

Vier dingen bewaken het laden, alle in `static/app.js`:

- een gedeelde `pendingView` per route, zodat weg- en terugklikken tijdens een koude load de
  view niet twee keer bouwt;
- een generatie-teller (`mountGeneration`, regel 119) die een load weggooit die ná een nieuwere
  navigatie binnenkomt; op het succespad logt dat op `debug`, op het faalpad op `error`;
- een zichtbaar foutpaneel (`buildViewError`, regel 121) in plaats van een lege host, omdat
  `RouterCore.navigate()` de promise van `mount()` negeert;
- een retry met een verse module-URL, maar alleen als de `import()` zelf faalde — een registratie
  die de verkeerde factory noemt wordt niet eindeloos opnieuw opgehaald.

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

### Fase 2 — Python wordt de bron van waarheid ✅

**Doel: geen view zonder zijn backend.** Niet "router en sidebar kunnen niet meer uit elkaar
lopen" — dat is onhaalbaar, want de view `icons` heeft geen backend. Die asymmetrie loopt één
kant op: alle 16 routers worden vanuit `api-client.js` aangeroepen, dus er is geen router zonder
view. Consistentie is toetsbaar; gelijkheid niet. Er is geen 1:1 op welke as dan ook:
8 plugins, 16 routers, 20 views.

Gebouwd:

- **`app/plugins.py`** is de registratie: per plugin het label en de views, per view de routers die
  hem bedienen, zijn aliassen, en of hij überhaupt een backend heeft. De mapping is met de hand
  geschreven en per **view**, niet per plugin — een toets per plugin blijft groen als één view van
  een plugin zijn backend verliest: verdwijnt `app/prompt_testing/chat.py`, dan houdt `llm-pool`
  routers via `models.py` en `text_generation.py` en zou de view `chat` ongemerkt stuk zijn. Een
  view zonder backend zegt dat expliciet (`backend=False`; alleen `icons`), zodat "vergeten te
  koppelen" en "heeft er geen" te onderscheiden zijn. Geen herindeling van `app/`:
  `app/image_pool/training.py:18` importeert al `app/prompt_testing/pool_client`, dus pakketten per
  plugin herindelen zou het llm-pool-pakket een dependency van image-pool maken.
- **`/plugins.js`** wordt uit die registratie gegenereerd en met een blokkerende `<script>` vóór
  `app.js` geladen — dezelfde vorm als het bestaande `window.__LLM_WORKBENCH_INITIAL_SHELL__` in
  `static/index.html:7-22`. Python blijft de bron van waarheid en de sidebar rendert synchroon.
  Naar de browser gaat alleen data: `routers` en `backend` blijven thuis.
- **`app/router.py`** mount de routers uit de registratie in plaats van zestien handgeschreven
  `include_router`-regels. Gemeten: het enige verschil in het API-oppervlak is de nieuwe
  `GET /plugins.js`; alle 116 bestaande routes zijn identiek.
- **Aliassen** staan op de view die ze vervangen. Ze reizen mee met de payload en verdwijnen met
  hun plugin. Stonden ze globaal in `registry.js`, dan zou in fase 3 een alias van een
  uitgeschakelde plugin naar een route wijzen die `getWorkflow()` niet kan oplossen, waarna de
  gebruiker stil op de defaultroute landt.
- **`static/src/plugins/*/manifest.js` is weg.** `registry.js` leest de gegenereerde global en
  gooit een fout als die ontbreekt, in plaats van een lege sidebar te tonen.

| | |
| --- | --- |
| **Scopegrens** | geen enable/disable (fase 3), geen per-plugin assets, geen `api-client.js`-herstructurering (fase 4), geen discovery buiten de repo (fase 5) |
| **Verificatie** | twee toetsen en een verhuizing, hieronder uitgewerkt |

**Verificatie van fase 2.**

1. *De declaratie.* Elke view verwijst naar minstens één router of is expliciet als backend-loos
   gemarkeerd — het doel en de toets op dezelfde granulariteit.
2. *Het bewijs, onafhankelijk van de declaratie.* Lees uit `static/src/api-client.js` de tabel
   methode → pad; alle 101 methodes hebben een statisch pad. Verzamel vervolgens in de **eigen**
   bestanden van de view de aangeroepen `api.<methode>()`-namen en controleer dat elk gevonden pad
   door een gemounte route wordt bediend.

   De gedeelde client moet buiten die verzameling blijven. Hij zit in elke view-subtree — elke view
   importeert hem — dus een wandeling over de subtree vindt in *elke* view alle 101 paden, waarmee
   de toets per view niets meer zegt. De paden staan niet in de views zelf: die roepen
   `api.runChatPrompt()` aan. Gemeten over de 20 views levert de toets zoals hier beschreven
   **0 paden voor `icons`** en **2 tot 15 paden voor de andere 19**, wat precies is wat je wilt
   zien.

   Tot fase 4 rust deze toets op `api-client.js`. Daarna liggen de paden in de subtree van de
   plugin zelf en wordt de toets wat hij zegt. Dat is tijdelijk, en het hoort er te staan: het
   wringt met de motivering hierboven, waar een afleiding uit `api-client.js` juist wordt
   afgewezen omdat fase 4 dat bestand opsplitst.
3. *De pin is verhuisd.* De handgeschreven regressiepin staat nu in Python, waar de bron van
   waarheid is; de JS-suite houdt wat alleen JS kan controleren (module resolvet, factory
   geëxporteerd, icoon in de sprite). Die twee zijn geen duplicaat: de pin ontleent zijn waarde
   eraan dat hij een onafhankelijke, handgeschreven kopie is. De JS-suite haalt de pluginlijst via
   een subprocess bij `app/plugins.py` en stubt daarmee de global, want een tweede kopie in JS is
   precies wat deze fase opheft.

Deze drie zitten in `tests/test_plugin_registry.py` (17 tests) en
`tests/js/plugin-registry.test.mjs` (4 tests). Allebei de pins zijn mutatie-gecontroleerd: één
router niet mounten laat drie tests falen, waaronder de onafhankelijke padaanalyse; een
sidebarlabel hernoemen laat de pin falen. De browsercheck controleert daarnaast dat de sidebar
écht uit de gegenereerde global komt.

### Fase 3 — per-plugin assets en enable/disable ⬜

**Doel:** een installatie toont alleen wat ze nodig heeft, bijvoorbeeld LLM Pool-only.

Regels die nu al vastliggen:

- **`enabled` hoort niet in de registratie.** De registratie beschrijft wat er *bestaat*, settings
  beschrijven wat *aan* staat. Twee payloads, bij het serveren samengevoegd. Zitten ze in één
  bestand, dan is de registratie geen statische data meer en verliest de regressiepin zijn betekenis.
- Afwezig betekent aan.
- Plugin-uit wint van view-aan.

| | |
| --- | --- |
| **Contractwijziging** | een plugin declareert zijn eigen CSS en iconen; `id` wordt de settings-sleutel |
| **Scopegrens** | geen hot reload; assets blijven statische bestanden zonder buildstap |
| **Verificatie** | een uitgeschakelde plugin levert geen sidebar-item én geen gemounte router |

### Fase 4 — de gedeelde api-client opsplitsen ⬜

Losgetrokken van fase 3 op advies van de review. `static/src/api-client.js` is 101 methodes in
één object (766 regels) en wordt door 19 van de 20 views gebruikt — alleen `icons` raakt hem
niet. Dat is een herstructurering die niets met enable/disable te maken heeft; zit hij in fase 3,
dan is fase 3 de fase waarin het misgaat.

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

- ~~`registry.js` importeert de manifesten handmatig, `app/router.py` heeft 16 handgeschreven
  `include_router`-regels, en `ROUTE_ALIASES` staat globaal.~~ **Opgelost in fase 2.** De
  registratie in `app/plugins.py` is één bron voor de sidebar én de routetabel, en de aliassen
  hangen aan de view die ze vervangen.
- **Routebotsingen hebben geen gedefinieerd gedrag.** `WORKFLOWS_BY_ROUTE`
  (`registry.js:50`) laat bij een dubbele route stil de laatste winnen. De testsuite vangt dat voor
  de gecommitte set, maar vanaf fase 3 (settings) en zeker fase 5 (packages buiten de repo) is een
  botsing een runtime-geval zonder afgesproken uitkomst. Er moet een regel komen: weigeren bij het
  laden, of eerste-wint met een waarschuwing.
- **Een view mag endpoints van een andere plugin gebruiken.** `image-train` (image-pool) haalt zijn
  modellenlijst uit `/api/models/admin`, dat van llm-pool is. In fase 3 betekent dat: zet je
  llm-pool uit, dan verliest een image-pool-view een deel van zijn backend. Dat is een echte
  ontwerpvraag voor enable/disable, geen detail, en hij staat hier zodat hij niet pas bij het
  bouwen opduikt.
- Geen enable/disable, dus de hele workbench toont altijd alles.
- `css/app.css` is één globaal `@import`-manifest van 25 regels en er is één globale
  iconensprite; een plugin kan nog geen eigen assets bijdragen.
- ~~De shell hardcodeert `replay-translate`.~~ **Opgelost** als losse opruiming vóór fase 2, in een
  eigen commit op de fase-2-branch. Replay publiceert nu `WORKFLOW_BUSY_EVENT` zoals de vijf andere
  views, en `app.js` noemt geen enkele view meer bij naam — op één na: de fallback
  `WORKFLOWS[0]?.route || 'replay-translate'` voor een lege registry, en dat is het laatste punt
  in deze lijst.
- Het registratieveld `id` wordt in runtime nergens gelezen; het is gereserveerd voor fase 3.
- `static/app.js:59-67` (`pluginItemMarkup`) interpoleert `name`, `tooltip` en `route` ongeëscapet
  in `innerHTML`. Nu onschadelijk omdat de data statisch en gecommit is. Zodra plugins van
  buiten de repo komen is dit een injectiepunt; `escapeHtml`/`escapeAttr` bestaan al in
  `static/src/shared/ui-helpers.js`.
- De defaultroute is impliciet `WORKFLOWS[0]` (`static/app.js:311`). Zodra plugins uit kunnen,
  wordt "eerste ingeschakelde plugin" een willekeurige landingspagina.

## 5. Genomen beslissingen, en wat afviel

| Beslissing | Afgevallen alternatief |
| --- | --- |
| Plugins als mappen in de repo, contract zo dat entry points later passen | Meteen pip-packages: veel ceremonie voor één gebruiker. Geen abstractie: overstappen wordt later een herontwerp |
| **Python als bron van waarheid via een gegenereerde `plugins.js`-global** | **Een endpoint `/api/plugins`** — dit document koos dat eerst, en de ontwerpreview keerde het om: de lijst verandert niet tijdens een sessie, dus een fetch levert niets op en voegt een lege-sidebar-toestand plus een async bootstrap toe. Een gedeeld JSON-bestand viel eerder al af omdat het de koppeling met de echte routers en settings verliest |
| **Expliciete mapping van plugin naar routers in de Python-registratie** | **`app/` herindelen zodat elk pakket één plugin is** — dan wordt `prompt_testing` gedeeld tussen llm-pool en image-pool, en dus een cross-plugin dependency |
| Data-only manifesten, `module`/`factory` als strings | Factory-functies direct importeren: werkt, maar valt niet uit te serveren |
| **Aliassen in de registratie, op de view die het doel bezit** | Globaal laten in `registry.js`: dan blijft een deel van de configuratie in JS achter, wat fase 2 juist opheft |
| **`enabled` in settings, niet in het manifest** | In het manifest: dan is het manifest geen statische data meer en kan de regressiepin niets meer vastpinnen |
| **De `api-client.js`-splitsing als eigen fase** | In fase 3 laten: dat bundelt een herstructurering van 766 regels met enable/disable, en dan is fase 3 te groot om te reviewen |
| **`replay-translate` uit de shell halen als losse opruiming vóór fase 2** | In fase 2 meenemen: maakt de fase-2-diff groter zonder dat het iets met de bron van waarheid te maken heeft. Gedaan in een eigen commit op de fase-2-branch |
| **De koppeling view → routers met de hand schrijven, met een onafhankelijke padaanalyse als bewijs** | Afleiden uit `api-client.js`: dat werkt vandaag, maar fase 4 splitst dat bestand juist op, dus de afleiding verdwijnt precies wanneer je hem nodig hebt |
| **Een view zonder backend zegt dat zelf: `backend=False` op de view** | De auxiliary-vlag op plugin-niveau als uitzondering gebruiken: dat is een plugin-eigenschap die toevallig samenvalt met een view-eigenschap, en dan lopen plugin en view door elkaar op de enige plek waar de toets ze wil scheiden |
| Lazy loading bij eerste activering | Alles eager importeren: geen eerste-klik-kosten, maar ~21k regels JS parsen bij het opstarten |
| Registry laadt, shell bezit de levenscyclus en de DOM | Registry ook eigenaar van caching en activering: mengt data met DOM-beheer |

## 6. Nog open

1. De exacte vorm van de samengevoegde registratie-plus-settings-payload in fase 3, en wat
   enable/disable doet met een view die endpoints van een andere plugin gebruikt (zie sectie 4).
2. Is de api-client-splitsing klaar wanneer elke plugin zijn eigen module heeft, of is een
   gedeelde namespace per domein beter?
