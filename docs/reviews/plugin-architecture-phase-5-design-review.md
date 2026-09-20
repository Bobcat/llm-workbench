# Ontwerpreview — fase 5: discovery buiten de repo

- Branch: `feature/plugin-discovery-phase-5` @ `55be50f`, ontwerp in `fb4cad9`, tegen `main` @
  `06112cd`
- De branchdiff raakt alleen `docs/plugin-architecture.md` en deze reviewprompt; er is geen code
  gewijzigd, wat klopt met "ontworpen op deze branch"
- Uitgevoerd: elke feitelijke bewering in de sectie tegen de code gelegd; de mountvolgorde en het
  doorvallen naar de catch-all empirisch getest; de URL-resolutie van een absoluut `module`-pad
  gemeten, ook onder een subpad; nagegaan wat de bestaande padanalyse met een module buiten
  `static/` doet; de drie suites op beide kanten gedraaid
- Dit is een ontwerpreview. Er is niets gewijzigd

**Verdict: changes requested** — beperkt tot drie punten in het contract. De rest van de sectie is
scherp en de meeste beweringen kloppen; maar de zin waar de fase op leunt — *"Regel 2 is geen goede
intentie maar een toets"* — wordt door de code niet gedragen, en twee van de drie contractvelden
hebben een gevolg dat het ontwerp niet noemt.

## 1. Feitelijke verificatie

| bewering | resultaat |
| --- | --- |
| de plugin-mount moet vóór de catch-all | **klopt.** `app/main.py:75` is `app.mount("/", …)` en staat als laatste. Getest: zonder submount geeft `/plugin-static/mine/view.js` een 404; met een submount ervóór geeft hij 200, en een onbekend pad eronder 404 zonder door te vallen |
| `module` wordt tegen `document.baseURI` opgelost | **klopt**, `static/src/plugins/registry.js:74` |
| een absoluut pad werkt daarmee | **klopt aan de wortel, niet onder een subpad** — zie bevinding 2 |
| `iconMarkup` eist nu een sprite-id | **klopt, en het is strenger dan de zin suggereert** — zie bevinding 3 |
| de payload zonder entry points blijft identiek aan fase 4 | vandaag triviaal waar: de branch wijzigt geen code. Als verificatie-eis voor de implementatie is hij goed gekozen |
| `PLUGINS` is nog de enige lijst | **klopt.** Niets in `app/`, `static/` of `tests/` noemt entry points, `all_plugins`, `plugin-static` of `static_dir` in de betekenis van deze fase |
| een routenaambotsing en een id-botsing worden geweigerd | het gat uit sectie 4 noemde twee opties; deze kiest de strengste, en dat is de juiste keuze voor een lijst die van buiten kan groeien |
| een pakket dat verdwijnt terwijl het in `plugins.enabled` staat blijft een fout | **klopt** met de fase-3-regel, en het ontwerp noemt de prijs zelf |

| suite | branch | `main` |
| --- | --- | --- |
| `pytest` | 161 passed, 5 failed | 161 passed, 5 failed — dezelfde vijf |
| `node --test` | 4 pass | — |
| browsercheck | exit 0 | — |

## 2. Kan het contract dit dragen?

In grote lijnen ja. `static_dir`, `routers` en `styles` zijn precies de drie dingen die een pakket
nodig heeft dat de repo niet voor hem kan doen, en ze sluiten aan op de velden uit sectie 2 zonder
die te veranderen. De scheiding "discovery bepaalt wat er bestaat, `plugins.enabled` wat er in het
menu staat" is consistent met fase 3 en goed uitgelegd.

Twee plekken waar de loader vastloopt, staan hieronder als bevinding 1 en 2.

## Bevindingen

### Medium — de padanalyse kan regel 2 niet afdwingen voor een plugin buiten de repo

De sectie zet hier haar gewicht op: *"Regel 2 is geen goede intentie maar een toets: de padanalyse
eist per view dat elk aangeroepen pad door de core of door de eigen plugin gediend wordt."* De
analyse kan dat vandaag niet, en het ontwerp zegt niet hoe ze het gaat kunnen.

Elke helper in `tests/test_plugin_registry.py` begint bij `STATIC / view.module` — regels 385, 397,
406, 413, 443, 460 en 471. Met het `module`-pad dat deze fase introduceert gebeurt dit:

```
STATIC / 'src/workflows/chat/index.js'   -> …/static/src/workflows/chat/index.js   bestaat: True
STATIC / '/plugin-static/mine/view.js'   -> /plugin-static/mine/view.js            bestaat: False
```

`pathlib` vervangt de basis bij een absoluut pad. Het gevolg is niet dat de toets afgaat maar dat
hij niets ziet:

- `_api_paths` levert een lege verzameling, dus `test_views_only_build_paths_that_are_served` slaagt
  zonder iets te controleren;
- `_client_owners` levert een lege verzameling, dus `test_no_view_imports_another_plugins_client` —
  de toets die regel 2 zou moeten dragen — slaagt om dezelfde reden;
- `test_the_scan_finds_a_client_for_every_view_with_paths`, de controle op de controle, staat achter
  `if _api_paths(entry)` en slaat dus ook over.

De enige die rood zou worden is `test_other_views_reach_at_least_two_endpoints`, en alleen als de
analyse van `iter_views()` (de ingebouwde lijst) overstapt op de samengevoegde lijst. Daarmee zijn
er twee uitkomsten en geen van beide is "afgedwongen": blijft de analyse op de ingebouwde lijst, dan
is regel 2 voor precies de plugins die hem nodig hebben niet getoetst; stapt hij over, dan valt de
rookproef om zonder dat er iets mis is.

Hetzelfde geldt aan de JS-kant: `tests/js/plugin-registry.test.mjs:81` doet
`path.join(STATIC, view.module)`, en `path.join` in Node plakt een absoluut pad juist wél aan —
`static/plugin-static/mine/view.js` — dat evenmin bestaat.

De ontbrekende schakel is klein en ligt al in het ontwerp: `static_dir` is per plugin bekend, dus de
analyse kan per view een wortel krijgen in plaats van altijd `static/`. Dat hoort in de sectie te
staan, want zonder die stap is de sterkste zin van de fase de enige die niet waargemaakt wordt.

### Laag/medium — een absoluut `module`-pad geeft de subpad-eigenschap op die de loader expliciet heeft

`static/src/plugins/registry.js:64-65` zegt met zoveel woorden waarom er tegen `document.baseURI`
wordt opgelost: *"so the registry keeps working if the app is ever served from a subpath."* Een
`module` die met `/` begint, gooit dat weg. Gemeten:

```
base http://host/            module src/workflows/chat/index.js  -> http://host/src/workflows/chat/index.js
base http://host/            module /plugin-static/mine/view.js  -> http://host/plugin-static/mine/view.js
base http://host/workbench/  module src/workflows/chat/index.js  -> http://host/workbench/src/workflows/chat/index.js
base http://host/workbench/  module /plugin-static/mine/view.js  -> http://host/plugin-static/mine/view.js   <-- basis weg
```

Onder een subpad wijst het plugin-pad dus naast de applicatie. Voor de ingebouwde plugins verandert
er inderdaad niets — dat deel van de zin klopt — maar de nieuwe gevallen zijn precies de gevallen
die de eigenschap verliezen. Twee uitwegen: het mountpad relatief houden
(`plugin-static/<id>/…` zonder leidende slash, dan blijft de resolutie tegen `baseURI` werken), of
opschrijven dat een deployment onder een subpad buiten scope valt. Kiezen mag, zwijgen niet, want
de loader belooft het tegenovergestelde in zijn eigen commentaar.

### Laag/medium — `icon` als pad opent een vierde injectiepunt dat de escaping-alinea niet noemt

De sectie behandelt dit als een testkwestie: *"De JS-toets die elke view-icoon in de sprite
controleert, gaat daarmee alleen nog over sprite-id's."* Het is meer dan dat. `pluginItemMarkup`
(`static/app.js`) zet het resultaat van `iconMarkup(wf.icon, …)` rauw in `innerHTML`, en wat dat
vandaag veilig maakt is geen test maar een runtime-wacht:

```js
const ICON_NAME_PATTERN = /^[a-z0-9-]+$/;
function checkedIconName(name) {
  if (!ICON_NAME_PATTERN.test(value)) throw new Error(`Invalid icon name: ${value}`);
```

Een waarde met een `/` erin gooit nu. Wil `icon` een pad kunnen zijn, dan moet die allowlist open —
en daarmee wordt `icon` een vierde veld van buiten dat in markup terechtkomt. De escaping-alinea
noemt alleen `name`, `tooltip` en `route`. Zo sluit deze fase drie gaten en opent ze er één, tenzij
`icon` in dezelfde beweging wordt meegenomen.

Dat raakt direct de vraag of het escapen het gat uit sectie 4 sluit of verplaatst: voor de drie
genoemde velden sluit het, voor `icon` verplaatst het — van "kan niet, want de wacht gooit" naar
"mag, mits iemand eraan denkt".

### Laag — `styles` past niet in de payload zoals die nu is vastgepind

`test_payload_carries_only_frontend_data` (`tests/test_plugin_registry.py:312`) pint de exacte
sleutelverzameling `{"id", "label", "auxiliary", "views"}` per plugin. `styles` moet de shell
bereiken, dus het wordt een vijfde sleutel en die pin verandert mee. Geen bezwaar — maar dit
document noemt zulke gevolgen normaal gesproken zelf, en hier niet.

### Laag — ontbrekende faalmodes

Het ontwerp dekt de botsingen en het verwijderde pakket netjes. Niet genoemd:

- **`static_dir` bestaat niet.** De core heeft hier al een patroon voor: `app/main.py:74` mount zijn
  eigen map alleen `if static_dir.exists()`. Voor een plugin is stil overslaan juist verkeerd — dan
  laadt geen enkele view — dus dit vraagt een expliciete keuze.
- **Een entry point dat bij het laden gooit.** De fabrieksfunctie wordt aangeroepen tijdens import;
  één kapot pakket neemt dan de hele workbench mee. Weigeren met naam, of overslaan met een melding?
- **Twee entry points uit hetzelfde pakket.** Niet verboden, en de id-botsingsregel vangt alleen het
  geval dat ze dezelfde id kiezen.
- **De volgorde van discovery.** De sectie legt "ingebouwd, dan gevonden" vast maar niets over de
  orde *binnen* het gevonden deel. Dat heeft een zichtbaar gevolg: de landingsroute is
  `WORKFLOWS[0]` (`static/app.js:331`), dus bij een installatie met alleen externe plugins bepalen de
  entry points de startpagina én de sidebarvolgorde. Dat hoort gepind, bijvoorbeeld op naam.

`styles` bij een uitgeschakelde categorie is wél geregeld: de shell laadt ze alleen als de plugin
aan staat, en dat is consistent met de payload die alleen ingeschakelde plugins bevat.

### Nit — sectie 6 heet "Nog open" maar heeft niets meer open

Beide vragen zijn doorgestreept. Voor een document dat zijn laatste fase ingaat is een lege
openstaande-vragenlijst zelf een bewering, en de punten hierboven laten zien dat er nog keuzes te
maken zijn. Een paar ervan horen daar.

## 3. Is de adresregel afdwingbaar?

Regel 1 (de core mount, een plugin nooit zelf) is goed: het houdt één routetabel en het sluit aan op
`CoreMountTests`, dat vandaag elke routermodule in `app/` tegen de gemounte app legt.

Regel 2 is de kern en is vandaag niet afdwingbaar — zie bevinding 1. Het is oplosbaar, maar het is
werk dat de sectie niet benoemt.

Regel 3 ("een gedeeld adres verhuist naar de core, met de clientcode erbij") is **een verhuizing en
geen herschrijving**, en dat is in fase 4 al aangetoond: daar zijn precies vier methoden naar
`static/src/shared/api/shared.js` gegaan en waren alle honderd overgebleven lichamen byte-identiek.
De prijs is de aanroepzijde: de views die zo'n methode gebruiken wisselen van `api.X()` naar
`sharedApi.X()`. In fase 4 waren dat dertien regels in tien bestanden. Voor één adres is dat klein
en voorspelbaar.

## 4. Is de trust-grens eerlijk?

Ja, en de reden klopt. De grens is niet "derden zijn onveilig" maar "zonder isolatie is een manifest
gelijk aan code-uitvoering", en dat is juist: een plugin levert een `module` die de shell importeert,
dus hij draait sowieso in dezelfde global scope. Isoleren is inderdaad een ander ontwerp en geen
vervolgfase; dat als scopegrens opschrijven in plaats van als toekomstplan is de eerlijke vorm.

Het escapen is daarbij terecht een voorwaarde en geen extra. De kanttekening staat in bevinding 3:
drie velden worden gesloten, het vierde wordt in dezelfde fase geopend.

## 5. Is de afbakening goed?

Ja. Per-plugin CSS en iconen horen hier: ze zijn wat een pakket nodig heeft om er goed uit te zien,
en sectie 4 stelde ze bewust uit tot dit moment — dat is consequent, geen uitstelgedrag.

"De ingebouwde plugins blijven in de repo" is verdedigbaar en maakt de fase niet hol. Sterker: ze
zijn de regressiebasis. De hele reeks toetsen — de handgeschreven sidebarpin, de padanalyse, de
payloadvergelijking — meet tegen die ingebouwde set. Ze meteen verhuizen zou het enige bewijs
weghalen dat discovery niets verandert aan wat er al was. Het ontwerp zegt zelf dat de fase "de
mogelijkheid toevoegt, niet de migratie", en dat is de goede volgorde.

## Samenvatting

- De sectie is grotendeels accuraat: mountvolgorde, resolutie tegen `baseURI`, de botsingsregel en
  de scheiding tussen geïnstalleerd en aan kloppen allemaal, en de twee beslissingen die sectie 4
  overnam zijn de juiste.
- Vóór de bouw te beslissen: hoe de padanalyse bij de bestanden van een extern pakket komt
  (`static_dir` is de voor de hand liggende wortel), of een subpad-deployment ondersteund blijft, en
  of `icon` meegaat in het escapen.
- Aan te vullen: `styles` in de payloadpin, en vier faalmodes — ontbrekende `static_dir`, een
  gooiende entry point, twee entry points uit één pakket, en de volgorde van discovery, die de
  startpagina bepaalt.
- Trust-grens en afbakening zijn houdbaar zoals ze er staan.
