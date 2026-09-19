# Ontwerpreview — `docs/plugin-architecture.md`

- Document: `docs/plugin-architecture.md` (181 regels), toegevoegd in `0ccb2d6`
- Anker in het document: `main` @ `a0f79d8` — dat is de ouder van `0ccb2d6`, dus het anker klopt
- Beoordeeld tegen: `main` @ `0ccb2d6`, `origin/main` @ `a0f79d8`
- Dit is een ontwerpreview. Er is geen code gewijzigd en geen fase 1-code herbeoordeeld

**Verdict: changes requested** — beperkt tot de afbakening van fase 2 en twee gaten in het
contract. De feitelijke verificatie komt schoon uit en sectie 1, 2, 5 en het grootste deel van
sectie 4 kunnen blijven staan.

De kern: fase 2 belooft dat router-mount en sidebar niet meer uit elkaar kunnen lopen, via *"`app/router.py`
wordt een lus over dezelfde registry in plaats van 16 `include_router`-regels"*. Die lus kan niet
bestaan zolang de backend-pakketindeling en de plugin-indeling iets anders groeperen, en dat doen ze
aantoonbaar. Dat is precies de zwakke aanname waar deze review op moest letten.

## 1. Feitelijke verificatie

Het document noemt zichzelf controleerbaar. Dat is het. Ik heb elke feitelijke bewering
nagelopen; alles hieronder is uitgevoerd, niet afgeleid.

### Aantallen

`static/src/plugins/registry.js` in Node geïmporteerd en geteld:

| Bewering | Gemeten | |
| --- | --- | --- |
| 8 manifesten | `PLUGINS.length === 8`, en 8 bestanden op schijf | ✓ |
| 7 categorieën | `PLUGINS.filter(p => !p.auxiliary).length === 7` | ✓ |
| 1 auxiliary | 1 | ✓ |
| 20 views | `WORKFLOWS.length === 20` | ✓ |
| 19 persistent | 19 | ✓ |
| 4 aliassen | `ROUTE_ALIASES.size === 4` | ✓ |
| 6 tests | `node --test` meldt `tests 6, pass 6, fail 0` | ✓ |
| 16 `include_router`-regels | `grep -c include_router app/router.py` → 16 | ✓ |
| `css/app.css` 25 regels, `@import`-manifest | 25 regels, 25 `@import` | ✓ |
| `api-client.js`: 101 methodes in één object | het `api`-object heeft 101 sleutels, alle 101 functies | ✓ |
| ~21k regels JS eager | 21.194 regels onder `static/app.js` + `static/src/` | ✓ |
| "de vijf andere views" sturen `WORKFLOW_BUSY_EVENT` | exact 5 view-modules | ✓ |

### Regelverwijzingen

| Bewering | Gemeten | |
| --- | --- | --- |
| `PLUGINS` regel 36 | 36 | ✓ |
| `ROUTE_ALIASES` regel 48 | 48 | ✓ |
| `WORKFLOWS` regel 56 | 56 | ✓ |
| `normalizeRoute` regel 60 | 60 | ✓ |
| `getWorkflow` regel 65 | 65 | ✓ |
| `loadView` regel 75 | 75 | ✓ |
| `mountGeneration` regel 128 | 128 | ✓ |
| `buildViewError` regel 130 | 130 | ✓ |
| `pluginItemMarkup` regels 60-68 | exact 60-68 | ✓ |
| `replay-translate` op `:93`, `:106`, `:327` | alle drie | ✓ |
| defaultroute `WORKFLOWS[0]` op `:327` | 327 | ✓ |
| `RevalidatingStaticFiles`, `app/main.py` regel 16 | 16 | ✓ |
| handmatige imports `registry.js:27-46` | imports 27-34, `PLUGINS` 36-45; regel 46 is leeg | bijna |

Die laatste is een off-by-one van één lege regel. Noem ik alleen omdat het document op
controleerbaarheid rust; inhoudelijk klopt de aanwijzing.

### Gedragsbeweringen

De vier loader-eigenschappen in sectie 2 zijn alle vier waar, ook de twee die in de derde
reviewronde nog nits waren en pas in `783f0bd` zijn opgelost:

- gedeelde `pendingView` per route — aanwezig;
- generatie-teller, succespad op `debug`, faalpad op `error` — `static/app.js:199` is
  `console.debug`, `:207` is `console.error`. Klopt;
- zichtbaar foutpaneel omdat `RouterCore.navigate()` de promise van `mount()` negeert — klopt;
- retry met verse URL **alleen als de `import()` zelf faalde** — `static/app.js:156-160` hoogt
  `failedLoads` alleen op bij `error?.retryable`. Klopt.

Verder: `label: ''` voor de auxiliary plugin ✓; `tooltip` valt terug op `name`
(`static/app.js:63`, `wf.tooltip || wf.name`) ✓; het manifestveld `id` wordt in `app.js` en
`registry.js` nergens gelezen — alleen de testsuite leest het ✓; `index.html:86-87` laadt
markdown-it en DOMPurify globaal en `chat/index.js:14` leest `window.markdownit` ✓;
`escapeHtml`/`escapeAttr` staan inderdaad in `static/src/shared/ui-helpers.js` ✓.

### Suites

| | |
| --- | --- |
| `node --test 'tests/js/**/*.test.mjs'` | 6 pass, 0 fail |
| `./.venv/bin/python tests/browser/check_plugin_registry.py` | exit 0, groen, server opgeruimd |
| `pytest` op `main` | 120 passed, 5 failed |
| `pytest` op `origin/main` (losse worktree) | 120 passed, 5 failed, **dezelfde vijf** |

De vijf zijn `tests/test_replay_api.py::ReplayApiTests::{test_create_session_resolves_relative_
sample_path_from_repo_root, test_export_includes_llama_cpp_runtime_settings, test_replay_
websocket_uses_delta_transcript_updates, test_set_second_pass_model_uses_second_pass_backend_
terms, test_set_second_pass_prompt_accepts_second_pass_prompt}`. Zelf uitgevoerd op beide kanten,
niet aangenomen.

**Conclusie van dit onderdeel: geen enkele onjuiste of verouderde bewering, op één lege regel na.**
De claim "de code is de bron van waarheid en dit document is controleerbaar" houdt stand.

## 2. Kan het contract fase 2 en 3 dragen?

### Blokkerend — de lus in `app/router.py` kan niet bestaan (sectie 3, fase 2)

Fase 2 stelt als contractwijziging: *"`app/router.py` wordt een lus over dezelfde registry in
plaats van 16 `include_router`-regels"*, met als doel *"router-mount en sidebar kunnen niet meer
uit elkaar lopen"*. Dat veronderstelt dat backend-routers en plugins op dezelfde manier
gegroepeerd zijn. Ze zijn het niet, en één geval is een regelrechte tegenspraak:

- de view `prompt-library` zit in de plugin **translation-services**
  (`static/src/plugins/translation-services/manifest.js`), maar zijn router komt uit
  `app/realtime_translation/prompt_library/prompts.py`. Frontend zegt Translation Services,
  backend zegt realtime\_translation;
- de plugin **llm-pool** heeft 3 views en 3 routers, maar die komen uit twee verschillende
  pakketten: `app/llm_pool/models.py` én `app/prompt_testing/{chat,text_generation}.py`;
- de plugin **image-pool** heeft 4 views en 3 routers (`models`, `loras`, `training`);
- de view `icons` heeft helemaal geen router.

Er is dus geen 1:1 op welke as dan ook: 8 plugins, 16 routers, 20 views. Een lus over de registry
vereist óf een herindeling van de `app/`-pakketten, óf een expliciete mapping van plugin naar
routers in het manifest — en dat laatste is een contractwijziging die het document niet noemt.
Zoals het er staat wordt een openstaande ontwerpkeuze als vaststaand gepresenteerd.

Daar komt bij dat het doel ("kunnen niet meer uit elkaar lopen") sterker is dan haalbaar. Omdat
`icons` geen backend heeft, is volledige gelijkschakeling per definitie onmogelijk. Wat wél
haalbaar is: *consistentie* — geen view waarvan de backend ontbreekt. Dat is een ander en
zwakker doel, en het is het doel dat je moet opschrijven.

### Blokkerend — `ROUTE_ALIASES` valt buiten het manifestcontract

`ROUTE_ALIASES` staat als module-constante in `registry.js:48-54`, niet in een manifest. De vier
aliassen wijzen alle naar views die een specifieke plugin bezit (`translation-requests` →
`image-translation`, eigendom van translation-services). Het is dus plugin-data die globaal is
opgeslagen.

Fase 2 zegt alleen dat **`PLUGINS`** van `/api/plugins` gaat komen. Dan komen de plugins uit
Python en blijven de aliassen in JS — precies de gesplitste bron van waarheid die fase 2 zegt op
te heffen. En in fase 3, zodra een plugin uit kan, wijst een alias van een uitgeschakelde plugin
naar een route die `getWorkflow()` niet meer kan oplossen; `normalizeRoute()` geeft dan een naam
terug die `router.has()` afwijst en de gebruiker landt stil op de defaultroute. Het document noemt
aliassen nergens in sectie 3 of 4.

Richting, niet uitgewerkt: aliassen horen bij de view die ze vervangen, dus in het manifest van de
plugin die het doel bezit. Dan reist de alias mee met de payload en verdwijnt hij automatisch met
zijn plugin.

### Ontbrekend — het view-contract staat nergens

Sectie 2 documenteert het manifest en de registry-exports, maar niet wat een view zelf moet zijn.
Uit `static/app.js` volgt dat een factory een DOM-element moet teruggeven, dat dat element
optioneel `__onActivate` en `__onDeactivate` mag dragen (`:170-176`, `:213-217`), en dat een view
zijn bezig-status meldt met `WORKFLOW_BUSY_EVENT`. Dat is het halve contract, en het is het deel
dat een plugin-auteur nodig heeft. Wie fase 4 serieus neemt — een plugin in een eigen package —
kan met dit document geen werkende plugin schrijven.

### Fase 3 is te groot afgebakend

Fase 3 bundelt drie dingen: per-plugin assets, enable/disable, én *"de gedeelde `api-client.js`
(101 methodes in één object) wordt per plugin of per namespace opgesplitst"*. Dat derde is een
herstructurering van 766 regels die 20 views raakt en niets met enable/disable te maken heeft.
Het hoort een eigen fase te zijn, of expliciet buiten de plugin-architectuur te vallen. Zoals het
nu staat, is fase 3 de fase waarin het mis gaat.

### Wat het contract wél kan dragen

De manifestvorm zelf is gezond. Data-only, geen geïmporteerde functies, en de prijs daarvan
(`module`/`factory` als strings, dus geen statische verificatie) is expliciet benoemd én
gecompenseerd met een mutatie-geverifieerde suite. Die keuze houdt in fase 2 en 3 stand. De grens
"registry laadt, shell bezit de levenscyclus" is eveneens houdbaar: hij is precies de reden dat
`PLUGINS` vervangen kan worden door een fetch zonder dat caching, activering en DOM-beheer
meebewegen.

## 3. De zes open vragen

**1. Is de payloadvorm van fase 2 voldoende voor fase 3 (enable/disable per plugin én per view)?**

Ja qua vorm, maar de vraag verbergt een ontwerpfout die je nu moet vermijden: zet
`enabled` **niet** in het manifest. Een manifest beschrijft wat er *bestaat*; settings beschrijven
wat er *aan* staat. Zodra die twee in één bestand zitten, is het manifest niet langer statische
data die je kunt vastpinnen, en verliest de regressiepin zijn betekenis. Serveer ze als twee
payloads en voeg ze bij het serveren samen. Leg daarbij twee regels vast: afwezig betekent aan, en
plugin-uit wint van view-aan.

**2. Moet een plugin een sidebar-item kunnen hebben zonder dat de backend hem mount, of omgekeerd?**

Ja, en dat is vandaag al zo: `icons` heeft geen enkele router. Het omgekeerde bestaat ook —
`replay_defaults_router` bedient geen eigen view. Elke afbakening die 1:1 veronderstelt, is bij
voorbaat onjuist. De bruikbare eis is niet gelijkheid maar richting: elke view die een backend
nodig heeft, moet er een hebben. Dat is toetsbaar; gelijkschakeling niet.

**3. Wat als `/api/plugins` niet antwoordt?**

Dit is de verkeerde vraag, omdat hij een keuze veronderstelt die je niet hoeft te maken. De
pluginlijst verandert niet tijdens een sessie, dus een fetch levert niets op en introduceert wél
een nieuw failure mode, een lege-sidebar-toestand en een asynchrone bootstrap.

`index.html` heeft al een synchroon bootstrap-patroon: een inline `<script>` dat
`window.__LLM_WORKBENCH_INITIAL_SHELL__` zet vóór `app.js` draait (`static/index.html:7-22`). Dat
is nu nog client-side uit `localStorage`, en `index.html` wordt als statisch bestand geserveerd
(`app/main.py:54`, `html=True`), dus letterlijk kopiëren kan niet. Maar dezelfde vorm wel: laat
FastAPI een gegenereerde `plugins.js` serveren die één global zet, en laad die met een gewone
blokkerende `<script>` vóór `app.js`. Python blijft de bron van waarheid, de sidebar rendert
synchroon zoals nu, en er is geen lege sidebar om gedrag voor te verzinnen.

Als je tóch een endpoint wilt, is het antwoord op de gestelde vraag: een lege sidebar is niet
acceptabel, want de gebruiker kan dan nergens heen en ziet geen reden. Dan hoort er een
foutpaneel in de host te komen, analoog aan `buildViewError`.

**4. Moet de regressiepin na fase 2 in Python leven of in JS blijven?**

Een valse tegenstelling: ze doen verschillend werk. De pin ontleent zijn waarde aan het feit dat
hij een *onafhankelijk met de hand geschreven kopie* is — dat is precies waarom de mutatietests
in de vorige reviewronde iets aantoonden. Een JS-test die de geserveerde payload consumeert en
daarmee vergelijkt, test de serving en niet de inhoud, en verliest die eigenschap.

Dus: de handgeschreven pin verhuist mee naar waar de bron van waarheid komt te liggen (Python), en
de JS-suite houdt wat alleen JS kan controleren — dat elke module resolvet, dat de factory
geëxporteerd wordt, en dat elk icoon in de sprite zit. Beide blijven, met verschillende taken.

**5. Is de niet-isolatie acceptabel voor fase 4, en welke drempel?**

De niet-isolatie is nu terecht als harde voorwaarde benoemd; dat is de sterkste passage van het
document. De drempel die ontbreekt is concreet te maken: niet-isolatie is acceptabel zolang elke
plugin code is die je sowieso zou draaien — hetzelfde vertrouwen als de repo zelf. Het moment dat
je een plugin installeert zonder hem te lezen, is het afgelopen: het XSS-gat in `pluginItemMarkup`
(al genoemd in sectie 4) plus volledige DOM- en global-toegang maakt een manifest dan gelijk aan
willekeurige code-uitvoering. Fase 4 is dus prima voor first-party packages. Een third-party
verhaal is geen aanscherping van dit ontwerp maar een ander ontwerp (iframe of worker), en dat
moet je niet als vervolgfase inplannen.

**6. Wanneer moet `replay-translate` uit de shell?**

Eerder, als losse opruiming, niet in fase 2. Het staat los van het plugincontract — het is een
event-protocol tussen shell en view — het is klein (vijf views doen het al goed), en het haalt één
hardcoded id weg vóór de bron van de sidebar verandert. In fase 2 meenemen maakt de diff van fase
2 moeilijker te reviewen zonder dat het iets oplevert.

## 4. Wat ontbreekt

Sectie 4 is als lijst accuraat en de prioritering klopt: de handmatige `PLUGINS`-array en het
ontbreken van `/api/plugins` staan bovenaan, en dat zijn ook de twee die fase 2 daadwerkelijk
wegneemt. Compleet is de lijst niet. Wat ontbreekt:

- **Routebotsingen.** `WORKFLOWS_BY_ROUTE` is `new Map(WORKFLOWS.map(v => [v.route, v]))`
  (`registry.js:58`); bij een dubbele route wint stil de laatste. De testsuite vangt dat voor de
  gecommitte set, maar vanaf fase 3 (settings) en zeker fase 4 (packages buiten de repo) is een
  botsing een runtime-geval zonder gedefinieerd gedrag. Dit hoort in de gatenlijst.
- **Aliassen**, zie boven: niet in het contract, en stukgaand zodra plugins uit kunnen.
- **Het view-contract**, zie boven: `__onActivate`/`__onDeactivate`, `WORKFLOW_BUSY_EVENT`, en de
  eis dat een factory een element teruggeeft.
- **De statusmarkering van dit document zelf.** `docs/README.md` zegt: *"Treat code, tests,
  runtime API docs, and current config as source of truth unless this README marks a document as
  current."* Die README noemt `plugin-architecture.md` niet, en bevat überhaupt geen lijst van
  actuele documenten. Voor een document dat expliciet als anker voor fase 2 bedoeld is, is dat een
  echt probleem: volgens de conventie van de map is het nu niet te onderscheiden van een
  exploratieve of achterhaalde notitie. Markeer het, of pas de conventie aan.

## 5. Oordeel per fase

| Fase | Afbakening houdbaar? |
| --- | --- |
| 1 | Ja. Status, as-built en verificatie kloppen alle drie, nagemeten |
| 2 | **Nee, herzien.** De router-lus veronderstelt een gelijkschakeling die niet bestaat; aliassen vallen buiten de payload; het doel is sterker geformuleerd dan haalbaar |
| 3 | Te groot. De `api-client.js`-splitsing hoort er niet bij |
| 4 | Ja, mits de voorwaarde "alleen first-party" blijft staan zoals hij staat |

Levert het contract na fase 2 nog één bron van waarheid op? **Zoals nu beschreven niet**, om twee
redenen: de aliassen blijven in JS achter, en de koppeling plugin → routers moet ergens
vastgelegd worden waar het document nu niets over zegt. Beide zijn oplosbaar binnen de bestaande
manifestvorm — dat is het goede nieuws — maar ze moeten vóór fase 2 beslist zijn, niet tijdens.

## 6. Samenvatting

- De feitelijke verificatie komt schoon uit: elk getal, elke regelverwijzing en elke
  gedragsbewering klopt, inclusief de twee die pas in `783f0bd` waar werden. Eén lege regel in een
  bereik. Dat is een ongewoon goed onderhouden document.
- Vóór fase 2 te beslissen: hoe plugin naar routers afgebeeld wordt, en waar aliassen wonen.
- Fase 2's doel herformuleren van "kunnen niet uit elkaar lopen" naar "geen view zonder zijn
  backend" — dat laatste is toetsbaar.
- Fase 3 opsplitsen; de `api-client.js`-herstructurering er los van trekken.
- Sectie 2 uitbreiden met het view-contract, en sectie 4 met routebotsingen en aliassen.
- `docs/README.md` dit document als actueel laten markeren, anders geldt het volgens de eigen
  conventie van de map als vrijblijvende notitie.
