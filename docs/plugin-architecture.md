# Plugin-architectuur — beslissingen en fase-afbakening

Status: fase 1 en 2 zijn gebouwd en staan op `main`. Fase 3 wordt op deze branch gebouwd; fase 4
en 5 zijn niet begonnen.
Anker: sectie 1 en 2 beschrijven de code op deze branch. Fase 1 landde met `783f0bd` en de
replay-opruiming met `8d73503`; de pdf-fix `a0f79d8` staat op `main` maar raakt deze architectuur
niet.

Dit document beschrijft **beslissingen en afbakening**, niet de implementatie. De code is de
bron van waarheid; waar dit document en de code verschillen, wint de code. Elke fase heeft
daarom een status en een verificatie die je kunt draaien.

Herzien na de ontwerpreview in `docs/reviews/plugin-architecture-review.md`. Die vroeg om
wijzigingen: de fase-2-belofte dat `app/router.py` een lus over de registry wordt, bleek niet te
kunnen, en aliassen, het view-contract en de omvang van fase 3 moesten opnieuw. Sectie 5 noemt
wat er is overgenomen en wat er afviel.

Herzien voor fase 3, na de vraag wat een plugin eigenlijk bezit. De kern daarvan: **de core bezit
de service-adressen en een plugin is alleen menu.** Daarmee vervalt de koppeling view → routers die
fase 2 bouwde, en kan geen enkele categorie meer van een andere afhangen.

## 1. Wat is een plugin hier

Een plugin is **één sidebar-categorie met één of meer views**. Meer niet.

De workbench zelf — de core — kent de services en hun adressen, en die zijn er altijd, ongeacht
welke plugins aan staan. Een plugin voegt dus geen adressen toe en beheert ze niet: hij bepaalt
alleen wat er in het menu staat.

Wel:

- een beschrijving met een `id`, een label, en de views die eronder hangen
- per view een module en een factory
- een aan/uit-schakelaar; uit betekent dat de categorie niet in het menu staat
- later: eigen CSS en iconen

Niet, en dat is een bewuste grens:

- **geen eigen adressen.** Een plugin gebruikt wat de core aanbiedt. Daardoor kan geen enkele view
  stukgaan doordat een andere categorie uit staat, en kan een workbench met één categorie volledig
  werken. Fase 5 kan hierop terugkomen: een plugin van buiten de repo zou een eigen backend willen
  meenemen, en dat is een andere beslissing dan deze.
- **geen isolatie of sandboxing.** Plugins delen het DOM en de global scope. `index.html` laadt
  markdown-it en DOMPurify globaal en de chatview leest `window.markdownit`. Een plugin krijgt
  dus volledige toegang tot de pagina. Zie fase 5 voor de drempel die dat stelt.
- **geen hot reload, geen versiebeheer per plugin, geen marketplace.**
- **geen package-manager.** Fase 5 gebruikt pip entry points voor discovery, niet als
  distributiemechanisme met versie-eisen.

## 2. Het contract zoals het nu is

### De registratie

`app/plugins.py` is de bron van waarheid voor **het menu**. FastAPI genereert `/plugins.js` daaruit
en `static/index.html` laadt dat bestand vóór `app.js`.

De service-adressen staan daar los van: `app/router.py` mount ze allemaal, altijd. Dat is de kern
van deze architectuur — een categorie uitzetten verandert niets aan wat de workbench kan, alleen
aan wat ze toont.

| Plugin-veld | Betekenis |
| --- | --- |
| `id` | stabiele plugin-id; de sleutel in `plugins.enabled` |
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
| `aliases` | gepensioneerde routenamen die naar deze view wijzen |

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
| `__onActivate()` | optioneel; aangeroepen zodra de view in de host staat (`static/app.js:170`) |
| `__onDeactivate()` | optioneel; aangeroepen bij wegnavigeren (`static/app.js:214`) |
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

| Export | Regel in `static/src/plugins/registry.js` | Rol |
| --- | --- | --- |
| `PLUGINS` | 41 | de pluginlijst uit de gegenereerde global; ontbreekt die, dan staat `pluginLoadError` gezet |
| `ROUTE_ALIASES` | 45 | oude routenamen, opgebouwd uit de `aliases` per view |
| `WORKFLOWS` | 51 | alle views, plat |
| `normalizeRoute` | 55 | alias → routenaam |
| `getWorkflow` | 60 | route → view-descriptor |
| `loadView` | 70 | laadt de module en roept de factory aan; `retry` zet `?retry=<n>` |

De registry **laadt** views; hij bezit ze niet. Caching, activering en de DOM blijven van de
shell (`static/app.js`). Die grens is bewust: de registry is dan puur data + laden en hoeft geen
levenscyclus te kennen.

`WORKFLOWS_BY_ROUTE` (`static/src/plugins/registry.js:53`) is een `Map` over de routes: bij een dubbele route wint stil de
laatste. Zie sectie 4.

### Loadergedrag in de shell

Vier dingen bewaken het laden, alle in `static/app.js`:

- een gedeelde `pendingView` per route, zodat weg- en terugklikken tijdens een koude load de
  view niet twee keer bouwt;
- een generatie-teller (`static/app.js:119`, `mountGeneration`) die een load weggooit die ná een nieuwere
  navigatie binnenkomt; op het succespad logt dat op `debug`, op het faalpad op `error`;
- een zichtbaar foutpaneel (`static/app.js:134`, `buildViewError`) in plaats van een lege host, omdat
  `RouterCore.navigate()` de promise van `mount()` negeert;
- een retry met een verse module-URL, maar alleen als de `import()` zelf faalde — een registratie
  die de verkeerde factory noemt wordt niet eindeloos opnieuw opgehaald.

### Waarom lazy loading

Views worden pas bij eerste activering geïmporteerd in plaats van alle 20 bij het opstarten.
Prijs: een koude view kost een networkrequest en kan even een placeholder tonen. Tweede prijs,
en die kostte een middag zoeken: een dynamic import valt buiten de cache-bypass van Ctrl+F5,
waardoor een gewijzigde view onzichtbaar kon blijven. Dat is server-side opgelost met
`Cache-Control: no-cache` (`app/main.py:17`, `RevalidatingStaticFiles`).

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

*Fase 3 legt het mounten weer bij de core en haalt de velden `routers`, `websockets` en `backend`
van een view. Deze sectie beschrijft wat fase 2 bouwde en waarom; hoe de adressen nu gemount worden
staat in sectie 1 en 2.*

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
  `GET /plugins.js`; de 113 `/api`-routes zijn identiek, en de twee websockets worden nu ook uit de
  registratie geregistreerd.
- **Aliassen** staan op de view die ze vervangen. Ze reizen mee met de payload en verdwijnen met
  hun plugin. Stonden ze globaal in `registry.js`, dan zou in fase 3 een alias van een
  uitgeschakelde plugin naar een route wijzen die `getWorkflow()` niet kan oplossen, waarna de
  gebruiker stil op de defaultroute landt.
- **`static/src/plugins/*/manifest.js` is weg.** `registry.js` leest de gegenereerde global en
  meldt een fout als die ontbreekt — als `pluginLoadError`, die `app.js` in de host toont, in
  plaats van een module-level throw die de gebruiker met een lege schil achterlaat.
- **Na de review van PR #16 (ronde 1)** zijn drie dingen aangescherpt. `routers` op een view is nu
  elke router die een door die view aangeroepen endpoint bedient, inclusief routers van andere
  plugins; daarmee is het veld kloppend en wordt een verwisselde router door een toets gevangen in
  plaats van erdoor te glippen. De twee websockets komen uit de registratie in plaats van met de
  hand uit `app/main.py`, zodat ook dat oppervlak onder het doel valt. En een ontbrekende
  pluginlijst is nu zichtbaar op het scherm: de laadorde was al gegarandeerd, maar de faalmodus was
  alleen in de console te zien.

| | |
| --- | --- |
| **Scopegrens** | geen enable/disable (fase 3), geen per-plugin assets, geen `api-client.js`-herstructurering (fase 4), geen discovery buiten de repo (fase 5) |
| **Verificatie** | twee toetsen en een verhuizing, hieronder uitgewerkt |

**Verificatie van fase 2.**

1. *De declaratie.* Elke view verwijst naar minstens één router of is expliciet als backend-loos
   gemarkeerd — het doel en de toets op dezelfde granulariteit.
2. *Het bewijs, in twee stappen.* Lees uit `static/src/api-client.js` de tabel methode → pad; alle
   101 methodes hebben een statisch pad. Verzamel vervolgens in de **eigen** bestanden van de view
   de aangeroepen `api.<methode>()`-namen en controleer twee dingen: dat elk gevonden pad door een
   *gemounte* route wordt bediend, en dat elk pad door een router wordt bediend die **deze view
   zelf declareert**.

   Die tweede stap is er na de review van PR #16 bijgekomen. Alleen tegen de gemounte app meten
   bleek te grof: vervang je bij `pdf-anatomy` de router door die van `chat`, dan blijven beide
   routers gemount en bleef de suite groen. Tegen de eigen declaratie meten vangt dat, en het is
   dezelfde granulariteit als het doel.

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

Deze drie zitten in `tests/test_plugin_registry.py` (38 tests) en
`tests/js/plugin-registry.test.mjs` (4 tests). De padaanalyse meet sinds fase 3 tegen de gemounte
app in plaats van tegen een declaratie per view: de core mount alle adressen, dus elk pad dat een
view aanroept moet daar altijd in zitten. Ze dekt zowel de `api.<methode>()`-aanroepen als de URL's
die zes views met de hand bouwen; die laatsten waren onzichtbaar tot een review liet zien dat je een
endpoint naar een niet-bestaand pad kon hernoemen zonder dat de suite iets zei. Voor de twee
websockets gebeurt hetzelfde: de paden komen uit `api-client.js` en worden tegen de geregistreerde
routes gehouden, met de twee verwachte paden als pin ernaast.

Daar bovenop staat de toets per categorie: met alleen categorie X aan moet elke view van X elk adres
dat hij aanroept nog kunnen bereiken — inclusief de modellenlijst die de LLM Pool-service serveert en
die vijf views buiten LLM Pool gebruiken. Dat is de belofte van het core-model, en het is de toets
die "een workbench met één categorie werkt" mechanisch maakt.

Alle toetsen zijn mutatie-gecontroleerd: één router niet mounten laat zeven tests falen, waaronder
de mount-toets en vier van de acht per-categorie-subtests; een routermodule in `app/` die niemand
mount faalt op de mount-toets; de payload de schakelaar laten negeren faalt op de per-categorie-toets
en op de gegenereerde-scripttoets; een literaal `/api`-pad naar iets onbestaanbaars faalt; een
sidebarlabel hernoemen faalt op de pin. De browsercheck controleert daarnaast dat de sidebar écht uit
de gegenereerde global komt, dat een menu met één categorie alleen die categorie toont en op de
eerste view daarvan landt, en dat een pluginlijst die niet aankomt zichtbaar op het scherm komt in
plaats van als lege schil — zowel wanneer het verzoek mislukt als wanneer de server hem weigert,
wat een typefout in `plugins.enabled` oplevert.

De regelverwijzingen in dit document worden ook getoetst. Drie reviewrondes op rij vonden hier
verouderde nummers, elke keer doordat een codewijziging in dezelfde commit ze verschoof. Die
klasse fouten is nu mechanisch: elke `bestand:regel` moet het meest specifieke symbool bevatten dat
de tekst eromheen noemt. Dat "meest specifieke" is er omdat een algemeen woord als `name` anders de
toets zou dragen: de zwakste prose-verwijzing ging daarmee van 56% naar 8% van de posities die een
verschuiving zouden overleven. Wat de toets niet vangt staat in zijn docstring, met de gemeten
marges erbij.

### Fase 3 — categorieën aan- en uitzetten 🚧 in uitvoering op deze branch

**Doel:** een installatie toont alleen wat ze nodig heeft. Een workbench met één categorie aan moet
volledig werken — wie wil, draait per categorie een eigen instantie.

Wat "uit" betekent: **de categorie staat niet in het menu.** Meer niet. De adressen zijn van de
core en blijven altijd beschikbaar, dus geen enkele view kan stukgaan doordat een andere categorie
uit staat. Een bladwijzer naar een view van een uitgezette categorie heeft geen route meer; de shell
valt dan terug op de landing (`static/app.js:331`, `defaultRoute`) in plaats van een lege host te
tonen. Dat is bestaand gedrag, maar fase 3 maakt het bereikbaar — en de browsercheck pint het.

Beslissingen:

- **De core mount alle service-adressen zelf**, altijd. De pluginlijst stuurt het menu aan en verder
  niets. Daarmee verdwijnen `routers`, `websockets` en `backend` van een view: die bestonden om te
  weten wie welk adres bezit, en dat is nu de core.
- **De schakelaar staat in het configuratiebestand**, bij de service-adressen die er al staan:
  `config/settings.json`, met `config/local.json` als overschrijving. Zonder `plugins.enabled` staat
  alles aan, zodat een nieuwe categorie vanzelf in het menu verschijnt. Noem je de lijst, dan staat
  precies die lijst aan en is een workbench met één categorie één regel:

  ```json
  { "plugins": { "enabled": ["image-pool"] } }
  ```

  Een id dat de registratie niet kent is een fout, en een lege lijst ook: een typefout of een
  vergeten lijst ziet er anders uit als een werkende installatie waar toevallig een categorie mist.
  Dat geldt ook een niveau hoger: een `plugins`-sectie die geen object is, of een settingsbestand
  dat geen object is, wordt geweigerd in plaats van stil genegeerd — anders verdwijnt de lijst
  ernaast en staat alles aan terwijl de lezer denkt dat zijn schakelaar is toegepast.
  `"enabled": null` zet alles aan; dat is de enige manier waarop `local.json` het menu verbreedt in
  plaats van versmalt, en het volgt uit "geen lijst betekent alles aan".
  Geen instellingenvenster. `LLM_WORKBENCH_SETTINGS_FILE` wijst naar een ander bestand, met
  `local.json` daarnaast; dat is voor een deployment die zijn instellingen buiten de repo houdt, en
  het is hoe de browsercheck tegen de gecommitte default draait in plaats van tegen de machine.
- **De drie suites zijn hermetisch voor die lokale keuze.** `config/local.json` is gitignored, dus
  een installatie die categorieën uitzet mag de tests niet rood maken: pytest en de JS-suite lezen
  een kopie van het gecommitte bestand zonder `local.json` ernaast, en de browsercheck start de
  workbench met `LLM_WORKBENCH_SETTINGS_FILE` op zo'n kopie.
- **Alleen hele categorieën**, geen losse views. De regel "plugin-uit wint van view-aan" uit een
  eerdere versie van dit document vervalt daarmee.
- **De startroute is de eerste view van de eerste categorie die aan staat.** Geen instelling nodig:
  de browser krijgt alleen de aangezette categorieën, dus de eerste daarvan is de landing.
- **Styling en iconen per categorie stellen we uit.** Die betalen zich pas terug bij plugins van
  buiten de repo, en dat is fase 5.

| | |
| --- | --- |
| **Scopegrens** | geen instellingenvenster, geen schakelaar per view, geen eigen CSS of iconen per categorie, geen wijziging aan de services zelf |
| **Verificatie** | per categorie: met alleen die categorie aan bevat de pluginlijst precies die categorie, en elke view ervan bereikt elk adres dat hij aanroept. De padaanalyse meet dat per categorie; de gemounte verzameling is elke ronde opzettelijk dezelfde, want de adressen zijn van de core — dat de schakelaar daar niet aan kan komen, bewaakt `CoreMountTests` |

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
- ~~Een view mag endpoints van een andere plugin gebruiken.~~ **Opgelost door het model zelf, in
  fase 3.** Vijf views buiten llm-pool halen hun modellenlijst uit `/api/models` of
  `/api/models/admin` (`replay-translate`, `image-train`, `image-translation`, `pdf-translation`,
  `prompt-library`). Zolang een plugin adressen bezat, was dat een afhankelijkheid tussen
  categorieën. Nu de core de adressen bezit, leunt een view nergens meer op: hij gebruikt wat de
  workbench aanbiedt. Dat is precies waarom dit model gekozen is.
- **Routebotsingen hebben geen gedefinieerd gedrag.** `WORKFLOWS_BY_ROUTE`
  (`static/src/plugins/registry.js:53`) laat bij een dubbele route stil de laatste winnen. De testsuite vangt dat voor
  de gecommitte set, maar in fase 5 (packages buiten de repo) is een botsing een runtime-geval
  zonder afgesproken uitkomst. Er moet een regel komen: weigeren bij het laden, of eerste-wint met
  een waarschuwing.
- `css/app.css` is één globaal `@import`-manifest van 25 regels en er is één globale
  iconensprite; een plugin kan nog geen eigen assets bijdragen. **Bewust uitgesteld in fase 3:** het
  levert nu vooral een nettere indeling op en betaalt zich pas terug bij plugins van buiten de repo.
- **Zeven kopieën van de settings-loader.** `_load_json_object` en `_merge_json_objects` staan in
  elke module die settings leest, en `app/plugins.py` heeft er in fase 3 een zevende bij gekregen.
  Ze samenvoegen is een eigen opruiming, geen fase-3-werk; de kopie in de registratie zegt dat er
  zelf bij.
- **Het foutpaneel noemt de instelling niet.** Een foutieve `plugins.enabled` laat `/plugins.js` met
  een 500 antwoorden, waarna het bestaande paneel verschijnt: het noemt de global en vraagt de
  pagina te herladen. Bij een typefout is herladen niet de oplossing — het instellingenbestand moet
  worden gecorrigeerd. De serverlog noemt het foute id en het bestand waar de lijst echt vandaan
  komt — `local.json` als die het laatst zegt, anders het basisbestand.
- **Een hashwijziging tijdens de sessie laat de url staan.** Een deep link naar een view van een
  uitgezette categorie landt netjes op de landing, maar wie tijdens de sessie `#chat` in de
  adresbalk zet terwijl die categorie uit staat, houdt `#chat` in de balk terwijl de view op de
  landing blijft staan — tot de volgende herlaadbeurt. Dat is bestaand gedrag van de router voor
  elke onbekende route (`#foo` doet hetzelfde); fase 3 maakt het alleen bereikbaar. In Chromium
  gemeten. Vervolgstap, zoals bij de routebotsingen: normaliseer de hash naar de landing, net als
  bij een koude start.
- ~~De shell hardcodeert `replay-translate`.~~ **Opgelost** als losse opruiming vóór fase 2, in een
  eigen commit op de fase-2-branch. Replay publiceert nu `WORKFLOW_BUSY_EVENT` zoals de vijf andere
  views, en `app.js` noemt geen enkele view meer bij naam — op één na: de fallback
  `WORKFLOWS[0]?.route || 'replay-translate'` voor een lege registry, en dat is het laatste punt
  in deze lijst.
- ~~De defaultroute is impliciet `WORKFLOWS[0]`.~~ **Beslist in fase 3:** de landing is de eerste
  view van de eerste categorie die aan staat. Omdat de browser alleen de aangezette categorieën
  krijgt, volgt dat automatisch.
- `static/app.js:59-67` (`pluginItemMarkup`) interpoleert `name`, `tooltip` en `route` ongeëscapet
  in `innerHTML`. Nu onschadelijk omdat de data statisch en gecommit is. Zodra plugins van
  buiten de repo komen is dit een injectiepunt; `escapeHtml`/`escapeAttr` bestaan al in
  `static/src/shared/ui-helpers.js`.

## 5. Genomen beslissingen, en wat afviel

| Beslissing | Afgevallen alternatief |
| --- | --- |
| **De core bezit alle service-adressen; een plugin is alleen menu** | **De adressen mounten vanuit de pluginlijst** — dat deed fase 2, en het maakte elke categorie afhankelijk van een andere: zette je llm-pool uit, dan verloor Tuning zijn modellenlijst terwijl de service gewoon draaide. Een plugin hoort niet te bepalen welke adressen de browser kan gebruiken |
| **De schakelaar in `config/settings.json`, met `local.json` als overschrijving** | Een instellingenvenster in de workbench: nieuw UI-werk plus een adres om de instelling te bewaren en te herladen, voor een keuze die je eenmalig per installatie maakt |
| **Eén `enabled`-lijst die de hele menu-inhoud in één keer vastlegt** | Een map van categorie naar `true`/`false`: dan moet je voor "alleen Image Pool" zeven sleutels op `false` zetten, en staat nergens in één opslag wat er aan is. De lijst is ook precies de vraag die je stelt — welke consoles wil deze installatie |
| **Alleen hele categorieën aan of uit** | Ook losse views: dan wordt het instellingenbestand een boom en moet de regel "categorie-uit wint van view-aan" ook echt gebouwd en onderhouden worden. Niemand vroeg erom |
| **De landing is de eerste view van de eerste categorie die aan staat** | Een instelbare startroute: extra instelling voor iets wat automatisch goed uitkomt, want de browser krijgt alleen de aangezette categorieën |
| **Styling en iconen per categorie uitgesteld** | Nu meenemen: het levert vooral een nettere bestandsindeling op en betaalt zich pas terug bij plugins van buiten de repo |
| Plugins als mappen in de repo, contract zo dat entry points later passen | Meteen pip-packages: veel ceremonie voor één gebruiker. Geen abstractie: overstappen wordt later een herontwerp |
| **Python als bron van waarheid via een gegenereerde `plugins.js`-global** | **Een endpoint `/api/plugins`** — dit document koos dat eerst, en de ontwerpreview keerde het om: de lijst verandert niet tijdens een sessie, dus een fetch levert niets op en voegt een lege-sidebar-toestand plus een async bootstrap toe. Een gedeeld JSON-bestand viel eerder al af omdat het de koppeling met de echte routers en settings verliest |
| ~~**Expliciete mapping van plugin naar routers in de Python-registratie**~~ *Vervangen in fase 3 door het core-model: de adressen zijn van de core en een view hoeft niets meer te declareren* | ~~**`app/` herindelen zodat elk pakket één plugin is**~~ — dan wordt `prompt_testing` gedeeld tussen llm-pool en image-pool, en dus een cross-plugin dependency |
| Data-only manifesten, `module`/`factory` als strings | Factory-functies direct importeren: werkt, maar valt niet uit te serveren |
| **Aliassen in de registratie, op de view die het doel bezit** | Globaal laten in `registry.js`: dan blijft een deel van de configuratie in JS achter, wat fase 2 juist opheft |
| **`enabled` in settings, niet in het manifest** | In het manifest: dan is het manifest geen statische data meer en kan de regressiepin niets meer vastpinnen |
| **De `api-client.js`-splitsing als eigen fase** | In fase 3 laten: dat bundelt een herstructurering van 766 regels met enable/disable, en dan is fase 3 te groot om te reviewen |
| **`replay-translate` uit de shell halen als losse opruiming vóór fase 2** | In fase 2 meenemen: maakt de fase-2-diff groter zonder dat het iets met de bron van waarheid te maken heeft. Gedaan in een eigen commit op de fase-2-branch |
| ~~**De koppeling view → routers met de hand schrijven**~~ *Vervangen in fase 3: er is geen koppeling meer. De onafhankelijke padaanalyse blijft en is nu scherper, want hij meet wat de core belooft* | Afleiden uit `api-client.js`: dat werkt vandaag, maar fase 4 splitst dat bestand juist op, dus de afleiding verdwijnt precies wanneer je hem nodig hebt |
| ~~**Een view zonder backend zegt dat zelf: `backend=False`**~~ *Vervangen in fase 3: het veld bestaat niet meer, want elke view gebruikt wat de core aanbiedt* | De auxiliary-vlag op plugin-niveau als uitzondering gebruiken: dat is een plugin-eigenschap die toevallig samenvalt met een view-eigenschap, en dan lopen plugin en view door elkaar op de enige plek waar de toets ze wil scheiden |
| Lazy loading bij eerste activering | Alles eager importeren: geen eerste-klik-kosten, maar ~21k regels JS parsen bij het opstarten |
| Registry laadt, shell bezit de levenscyclus en de DOM | Registry ook eigenaar van caching en activering: mengt data met DOM-beheer |

## 6. Nog open

1. **Mag een plugin in fase 5 eigen adressen meebrengen?** Dit model zegt nee: de core bezit ze.
   Een plugin van buiten de repo die een eigen backend wil, vraagt om een andere beslissing dan
   deze — en dat is bewust uitgesteld, niet vergeten.
2. Is de api-client-splitsing klaar wanneer elke plugin zijn eigen module heeft, of is een
   gedeelde namespace per domein beter?
