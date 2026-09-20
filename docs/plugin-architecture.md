# Plugin-architectuur — beslissingen en fase-afbakening

Status: fase 1 tot en met 4 staan op `main` (fase 3 via PR #17, fase 4 via PR #18). Fase 5 is op
deze branch ontworpen en nog niet gebouwd.
Anker: sectie 1 en 2 beschrijven de code op `main`. Fase 1 landde met `783f0bd` en de
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
2. *Het bewijs, in twee stappen.* Het eerste was een tabel methode → pad uit
   `static/src/api-client.js` — dat bestand bestaat sinds fase 4 niet meer — met voor alle 101
   methodes een statisch pad. Het tweede verzamelde in de **eigen** bestanden van de view de
   aangeroepen `api.<methode>()`-namen en controleerde twee dingen: dat elk gevonden pad door een
   *gemounte* route werd bediend, en dat elk pad door een router werd bediend die **deze view zelf
   declareerde**.

   Die tweede stap is er na de review van PR #16 bijgekomen. Alleen tegen de gemounte app meten
   bleek te grof: vervang je bij `pdf-anatomy` de router door die van `chat`, dan blijven beide
   routers gemount en bleef de suite groen. Tegen de eigen declaratie meten vangt dat, en het is
   dezelfde granulariteit als het doel.

   In fase 2 moest de gedeelde client buiten die verzameling blijven — hij zat in elke view-subtree,
   dus een wandeling vond in *elke* view alle 101 paden. Sinds fase 4 ligt de client van de eigen
   plugin in de subtree, plus wat die uit `shared/` haalt, dus de analyse vindt de paden die deze
   view echt gebruikt. Gemeten over de 20 views: **0 paden voor `icons`** en **5 tot 25 paden voor de
   andere 19**, met `tts-pool-models`, `video-pool-models` en `video-generation` als laagste drie
   (elk 5). Een view met één client haalt dus de ondergrens en een view met veel endpoints de
   bovengrens, wat precies is wat je wilt zien.
3. *De pin is verhuisd.* De handgeschreven regressiepin staat nu in Python, waar de bron van
   waarheid is; de JS-suite houdt wat alleen JS kan controleren (module resolvet, factory
   geëxporteerd, icoon in de sprite). Die twee zijn geen duplicaat: de pin ontleent zijn waarde
   eraan dat hij een onafhankelijke, handgeschreven kopie is. De JS-suite haalt de pluginlijst via
   een subprocess bij `app/plugins.py` en stubt daarmee de global, want een tweede kopie in JS is
   precies wat deze fase opheft.

Deze drie zitten in `tests/test_plugin_registry.py` (41 tests) en
`tests/js/plugin-registry.test.mjs` (4 tests). De padaanalyse meet tegen de gemounte app: de core
mount alle adressen, dus elk pad dat een view aanroept moet daar altijd in zitten. Sinds fase 4 leest
ze die paden waar ze geschreven staan — in de subtree van de view zelf, dus de client van zijn eigen
plugin plus wat die uit `shared/` haalt — in plaats van via een methode → pad-tabel uit één gedeeld
bestand. Ze dekt daarmee zowel de clientaanroepen als de URL's die views met de hand bouwen voor
downloads en streams; die laatsten waren onzichtbaar tot een review liet zien dat je een endpoint
naar een niet-bestaand pad kon hernoemen zonder dat de suite iets zei. Voor de twee websockets
gebeurt hetzelfde, en daar hoort een tweede toets bij: geen enkele view haalt de client van een
andere plugin binnen.

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

### Fase 3 — categorieën aan- en uitzetten ✅

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

### Fase 4 — de gedeelde api-client opsplitsen ✅

Losgetrokken van fase 3 op advies van de review. `static/src/api-client.js` is 101 methodes in
één object (766 regels) en wordt door 19 van de 20 views gebruikt — alleen `icons` raakt hem
niet. Dat is een herstructurering die niets met enable/disable te maken heeft; zit hij in fase 3,
dan is fase 3 de fase waarin het misgaat.

**Doel:** een plugin bezit zijn eigen API-calls, zodat de gedeelde client niet de nieuwe bottleneck
wordt — en zodat een plugin die in fase 5 in een eigen pakket woont zijn eigen client meebrengt in
plaats van de core te moeten bewerken.

**De keuze: één client per plugin, niet één gedeelde met een namespace per domein.** De eenheid is
de plugin, want dat is precies wat er in fase 5 verhuist. Wat meer dan één categorie nodig heeft, is
van de core — dezelfde regel als bij de adressen in fase 3, nu op methoden toegepast. Gemeten met de
padaanalyse van de testsuite: van de 101 methodes worden er 100 door views aangeroepen, en **vier**
daarvan door meer dan één categorie:

| methode | pad | categorieën |
| --- | --- | --- |
| `getModels` | `/api/models` | image-pool, realtime-translation |
| `getAdminModels` | `/api/models/admin` | llm-pool, translation-services |
| `getTtsAdminModels` | `/api/tts-pool/models/admin` | realtime-tts, tts-pool |
| `listTranslationPrompts` | `/api/translation/prompts` | realtime-translation, translation-services |

Die vier komen in een core-client. De andere 96 gaan naar de plugin die ze gebruikt, en dat blijkt
een schone verdeling langs de bestaande categorieën: na aftrek van de vier gedeelde valt elke methode
op precies één categorie.

| categorie | families | methodes |
| --- | --- | --- |
| image-pool | `/api/image-pool` | 22 |
| translation-services | `/api/translation`, `/api/pdf-translation`, `/api/pdf-benchmark`, `/api/pdf-regression`, `/api/prompts` | 40 |
| realtime-translation | `/api/replay`, `/api/config` | 13 |
| video-pool | `/api/video-pool` | 7 |
| realtime-tts | `/api/realtime-tts` | 6 |
| llm-pool | `/api/chat`, `/api/text-generation`, en van `/api/models` de drie die alleen llm-pool aanroept | 5 |
| tts-pool | `/api/tts-pool`, zonder de gedeelde admin-methode | 3 |
| | | **96** |

Twee families die vanzelfsprekend lijken maar het niet zijn: `/api/config` (`getDefaultModel`) hoort
bij **realtime-translation**, want alleen de replay-view roept hem aan, en `/api/prompts`
(`testTranslationPrompt`) bij **translation-services**, want alleen `prompt-library` roept hem aan —
die view hoort bij translation-services, ook al woont zijn router in het `realtime_translation`-pakket.
Welke plugin een client bezit volgt dus uit de aanroeper, niet uit de router.

**Wat een view importeert.** Tien van de negentien views die de client gebruiken, roepen zowel een
gedeelde als een eigen methode aan (gemeten; `image-train` doet bijvoorbeeld `getModels` uit de core
en zijn eigen trainingscalls). Zo'n view importeert dus twee modules: de client van zijn eigen plugin
en de core-client. Dat is de bedoeling — de eis is niet "één import" maar "nooit de client van een
andere plugin" — en de plugin-client her-exporteert niets uit de core: dat zou een façade zonder
gedrag zijn, en een plugin-pakket in fase 5 moet die core-import toch zelf doen.

**De vorm:**

| bestand | inhoud |
| --- | --- |
| `static/src/shared/api/request.js` | het dunne gedeelde deel: één fetch-helper met het gedrag van nu (same-origin, JSON, fout bij een non-2xx). Elk ander clientbestand importeert hem |
| `static/src/shared/api/shared.js` | de vier methoden hierboven, die meer dan één categorie aanroept |
| `static/src/plugins/<categorie-id>/api.js` | de client van één plugin; `<categorie-id>` is dezelfde id als in `app/plugins.py` |
| `static/src/workflows/<view>/…` | blijft staan waar het staat; de view importeert de client van zijn eigen plugin, en waar nodig de core-client |

De twee websocket-klassen (`ReplayWebSocket`, `ReplaySpeakWebSocket`) verhuizen mee naar de plugin
van hun view. `static/src/api-client.js` verdwijnt; er blijft geen re-export achter, want dat is
precies de "twee plekken waar het kan staan"-constructie die deze fase opheft.

**Wat deze fase ook oplevert: de toets leest de code zelf.** De padaanalyse in
`tests/test_plugin_registry.py` haalde zijn methode → pad-tabel uit `api-client.js`, de tabel die
sectie 3 als bewijsstap beschrijft. Die tabel is nu weg: de paden liggen in de subtree van de view
zelf — zijn eigen plugin-client plus wat die uit `shared/` importeert — dus de analyse leest wat er
geschreven staat en de toets meet wat hij zegt te meten. Daar is één toets bij gekomen: geen enkele
view haalt de client van een andere plugin binnen.

**Scopegrens:** geen wijziging aan de endpoints zelf, geen wijziging aan de views buiten hun
imports en de aanroepen van de vier gedeelde methoden (veertien regels in elf bestanden), geen
plugin-pakketten (dat is fase 5), geen bundelstap.

**Open punt dat deze fase zelf raakt:** `getTtsModels` staat in de client maar wordt door geen enkele
view aangeroepen (gemeten). Die verdwijnt in deze fase in plaats van mee te verhuizen.

**Gebouwd op deze branch.** De 100 methodes zijn verbatim overgezet — als tekst vergeleken met
het origineel, op de verwijderde `getTtsModels` na — en de twee websocket-klassen zijn mee
verhuisd. De paden die de voorkant aanroept zijn exact dezelfde op één na: `/api/tts-pool/models`
verdween met de dode methode, er kwam niets bij. De JS-suite en de browsercheck draaien
ongewijzigd door, wat klopt met de scopegrens: geen enkele view veranderde buiten zijn imports.

| | |
| --- | --- |
| **Verificatie** | de API-oppervlakte blijft identiek; de padaanalyse draait zonder `api-client.js`; een view importeert alleen de client van zijn eigen plugin en de core-client, nooit die van een andere plugin |

### Fase 5 — discovery buiten de repo 🚧 ontworpen op deze branch

| | |
| --- | --- |
| **Doel** | een plugin kan in een eigen package leven |
| **Contractwijziging** | discovery via pip entry points; het manifestcontract blijft gelijk |
| **Scopegrens** | **alleen first-party.** Niet-isolatie is acceptabel zolang elke plugin code is die je sowieso zou draaien — hetzelfde vertrouwen als de repo zelf. Het moment dat je een plugin installeert zonder hem te lezen, is het klaar: het XSS-gat in `pluginItemMarkup` plus volledige DOM- en global-toegang maakt een manifest dan gelijk aan willekeurige code-uitvoering. Derden zijn dus geen aanscherping van dit ontwerp maar een ander ontwerp (iframe of worker), en dat is geen vervolgfase |

**Wat een plugin-pakket aanlevert.** Een entry point in de groep `llm_workbench.plugins`, wijzend naar
een functie zonder argumenten die één plugin beschrijft: dezelfde velden als de registratie nu heeft
(`id`, `label`, `auxiliary`, `views` met `id`, `route`, `name`, `icon`, `module`, `factory`,
`aliases`, `tooltip`, `persistent`), plus drie dingen die een plugin van buiten de repo nodig heeft.
De registratie in `app/plugins.py` houdt de velden die sectie 2 noemt; een pakket levert er deze bij:

| veld | waarom |
| --- | --- |
| `static_dir` | de map in het pakket met de frontendbestanden van zijn views; de core serveert hem |
| `routers` | de adressen van deze plugin; de core mount ze (zie de adresregel hieronder) |
| `styles` | optioneel: stylesheets van de plugin, die de shell één keer inlaadt als de plugin aan staat |

**Hoe de core dat serveert.** De core mount `static_dir` op `/plugin-static/<plugin-id>/`, met
dezelfde `RevalidatingStaticFiles` als zijn eigen bestanden en vóór de catch-all mount. Het
`module`-veld van een view wordt door de browser tegen `document.baseURI` opgelost, dus voor een
plugin is dat `/plugin-static/<plugin-id>/view.js`; voor de ingebouwde plugins verandert er niets.
`icon` mag voor een plugin een pad zijn in plaats van een sprite-id: een waarde die met `/` begint
wordt als afbeelding gerenderd, al het andere blijft de sprite-symbol uit `static/assets/icons.svg`.
De JS-toets die elke view-icoon in de sprite controleert, gaat daarmee alleen nog over sprite-id's.

**Samenvoegen, en botsen weigeren.** `PLUGINS` blijft de ingebouwde lijst en de bron van waarheid voor
wat er in de repo zit; `all_plugins()` is die lijst plus wat discovery vindt, in die orde. Twee
botsingen worden bij het laden geweigerd in plaats van stil opgelost: een plugin-id die al bestaat,
en een routenaam die al bestaat. Dat sluit het gat uit sectie 4 met de strengste van de twee opties
die daar staan.

**Adressen: antwoord op de open vraag uit sectie 6.** Een plugin mag zijn eigen adressen meebrengen,
met drie regels:

1. de core mount ze; een plugin mount nooit zelf, zodat er één plek blijft waar de routetabel staat;
2. een view gebruikt de core of zijn eigen plugin, nooit een andere plugin;
3. een adres dat meer dan één plugin nodig heeft, verhuist naar de core — met de clientcode erbij,
   want de core moet het ook kunnen bedienen als die plugin niet geïnstalleerd is.

Regel 2 is geen goede intentie maar een toets: de padaanalyse eist per view dat elk aangeroepen pad
door de core of door de eigen plugin gediend wordt. Zonder die toets komt de afhankelijkheid terug
die fase 3 weghaalde — vijf views buiten LLM Pool leunden op `/api/models` zonder dat iemand het zag.

**Geïnstalleerd is niet hetzelfde als aan.** Discovery bepaalt wat er bestaat, `plugins.enabled` wat
er in het menu staat. Een geïnstalleerde plugin die niet in de lijst staat is dus aanwezig maar
onzichtbaar, en zijn adressen zijn gewoon gemount — precies zoals de core dat vandaag met alle
categorieën doet. Een id in `plugins.enabled` dat nergens bestaat blijft een fout, ook als het een
pakket is dat je net hebt verwijderd: de typo-regel uit fase 3 blijft gelden, en de prijs is dat je
een plugin ook uit de lijst haalt als je hem weghaalt.

**Discovery gebeurt bij het opstarten.** De mounts en de pluginlijst worden bij import opgebouwd, dus
een nieuw pakket installeren vraagt een herstart; een categorie aan- of uitzetten niet, dat blijft
een page reload.

**Escapen is voorwaarde, geen extra.** `pluginItemMarkup` zet `name`, `tooltip` en `route` ongeëscapet
in `innerHTML`; met data van buiten de repo is dat een gat, ook als die data uit een first-party
pakket komt. `escapeHtml` en `escapeAttr` bestaan al, dus dit is een kleine wijziging die het gat uit
sectie 4 sluit in plaats van verplaatst.

**Buiten scope, met reden.** Derden isoleren is een ander ontwerp (iframe of worker), geen
vervolgfase. De ingebouwde plugins blijven in de repo: deze fase voegt de mogelijkheid toe, niet de
migratie. Hot reload van plugins, een versiebeleid en een pluginregister vallen er ook buiten; één
gebruiker met first-party pakketten heeft ze niet nodig.

**Verificatie van fase 5.**

1. *Discovery.* Een synthetische entry point levert een plugin die met zijn views in de payload
   verschijnt, in de orde ingebouwd-dan-gevonden. Zonder enige entry point is de payload identiek aan
   die van fase 4 — dezelfde vergelijking die daar al wordt gemaakt.
2. *Serveren.* De statische map van een plugin wordt geserveerd onder `/plugin-static/<id>/` met
   `Cache-Control: no-cache`, en een onbekend pad daaronder geeft 404 in plaats van de catch-all te
   raken.
3. *Adressen.* De routers van een gevonden plugin worden gemount, ook als die plugin niet in
   `plugins.enabled` staat; en de padaanalyse zakt per view af naar "de core of de eigen plugin", met
   een mutatie die een view naar de client van een andere plugin laat grijpen.
4. *Botsen.* Een dubbele plugin-id en een dubbele routenaam laten het laden falen met een melding die
   beide kanten noemt.
5. *De pin.* De handgeschreven sidebarpin blijft over de ingebouwde set gaan: wat in de repo zit hoort
   vastgepind, wat geïnstalleerd is niet.

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
  de gecommitte set, maar met packages buiten de repo is een botsing een runtime-geval zonder
  afgesproken uitkomst. **Beslist in fase 5:** weigeren bij het laden, met een melding die beide
  kanten noemt — de strengste van de twee opties die hier stonden.
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
  in `innerHTML`. Nu onschadelijk omdat de data statisch en gecommit is. Zodra plugins van buiten de
  repo komen is dit een injectiepunt; **beslist in fase 5:** escapen met `escapeHtml`/`escapeAttr`
  uit `static/src/shared/ui-helpers.js`, als voorwaarde en niet als extra.

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
| **Eén client per plugin, met een dunne gedeelde fetch-helper en de vier gedeelde methoden in de core** | Eén gedeelde client met een namespace per domein: dan blijft er één bestand waar elke nieuwe plugin in moet werken, en dat is precies de bottleneck die fase 4 wegneemt |
| **Een view importeert zijn eigen plugin-client plus, waar nodig, de core-client** | De plugin-client laten her-exporteren wat zijn views uit de core nodig hebben: een façade zonder gedrag, en een plugin-pakket in fase 5 moet die core-import toch zelf doen |
| **Een methode die meer dan één categorie aanroept, hoort in de core-client** | Hem bij zijn oorspronkelijke plugin laten: dan hing realtime-translation aan tts-pool of translation-services, dezelfde fout die fase 3 bij de adressen wegnam |
| **De `api-client.js`-splitsing als eigen fase** | In fase 3 laten: dat bundelt een herstructurering van 766 regels met enable/disable, en dan is fase 3 te groot om te reviewen |
| **`replay-translate` uit de shell halen als losse opruiming vóór fase 2** | In fase 2 meenemen: maakt de fase-2-diff groter zonder dat het iets met de bron van waarheid te maken heeft. Gedaan in een eigen commit op de fase-2-branch |
| ~~**De koppeling view → routers met de hand schrijven**~~ *Vervangen in fase 3: er is geen koppeling meer. De onafhankelijke padaanalyse blijft en is nu scherper, want hij meet wat de core belooft* | Afleiden uit `api-client.js`: dat werkt vandaag, maar fase 4 splitst dat bestand juist op, dus de afleiding verdwijnt precies wanneer je hem nodig hebt |
| ~~**Een view zonder backend zegt dat zelf: `backend=False`**~~ *Vervangen in fase 3: het veld bestaat niet meer, want elke view gebruikt wat de core aanbiedt* | De auxiliary-vlag op plugin-niveau als uitzondering gebruiken: dat is een plugin-eigenschap die toevallig samenvalt met een view-eigenschap, en dan lopen plugin en view door elkaar op de enige plek waar de toets ze wil scheiden |
| Lazy loading bij eerste activering | Alles eager importeren: geen eerste-klik-kosten, maar ~21k regels JS parsen bij het opstarten |
| Registry laadt, shell bezit de levenscyclus en de DOM | Registry ook eigenaar van caching en activering: mengt data met DOM-beheer |

## 6. Nog open

1. ~~**Mag een plugin in fase 5 eigen adressen meebrengen?**~~ **Beslist in fase 5:** ja, met drie
   regels — de core mount ze, een view gebruikt de core of zijn eigen plugin, en een gedeeld adres
   verhuist naar de core. De fase-5-sectie noemt ze en de toets die regel 2 afdwingt.
2. ~~Is de api-client-splitsing klaar wanneer elke plugin zijn eigen module heeft, of is een
   gedeelde namespace per domein beter?~~ **Beslist in fase 4:** één client per plugin, met een
   dunne gedeelde fetch-helper in `static/src/shared/api/` en de vier methoden die meer dan één
   categorie aanroept in de core. De fase-4-sectie noemt de gemeten verdeling en wat er verhuist.
