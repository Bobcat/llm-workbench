# Review PR #19 — plugin-architectuur fase 5

- Branch: `feature/plugin-discovery-phase-5` @ `e882e52`, tegen `main` @ `06112cd`
- Beoordeeld: `7c7727f` (backend), `db97d6f` (voorkant), `704884d` (documentatie) en `e882e52` (de
  bestaanscontrole); het ontwerp en de twee ontwerprondes zijn eerder gereviewd
- Uitgevoerd: acht mutaties op de validatie; de adresregel getoetst met een pakket buiten `static/`;
  **een echt pakket met `dist-info` op `PYTHONPATH` gebouwd** en daarmee de server gedraaid — mount,
  payload, sidebar, icoon, stylesheet, view en API-aanroep; het escapen adversarieel getest met
  markup in de labels; padtraversal aan beide kanten gemeten; het API-oppervlak en de payload
  vergeleken met `main`; de drie suites op beide kanten
- Werkkopie schoon na afloop; het testpakket en elke `config/local.json` opgeruimd, geen servers
  blijven draaien

**Verdict: approve with nits.**

Alles wat de fase belooft staat er en werkt end-to-end met een echt geïnstalleerd pakket. De
discovery is streng en compleet — elke faalmodus heeft zijn eigen toets en alle acht mutaties vallen
om — het serveren klopt tot en met de cacheheaders, en het escapen houdt stand tegen markup in de
plugin-data. De drie bevindingen zitten alle drie in dezelfde familie: een padveld dat niet
genormaliseerd of niet gecontroleerd wordt.

## Werkt een echt pakket?

Ik heb er een gemaakt in plaats van de fabricage uit de tests te geloven: een map met
`demo_plugin/__init__.py` (een `make()` die een `PluginPackage` teruggeeft, met een eigen router),
een `static/` met `view.js`, `api.js`, `icon.svg` en `plugin.css`, en een `demo_plugin-1.0.dist-info`
met een `entry_points.txt` in de groep `llm_workbench.plugins`. Die map op `PYTHONPATH`, server
gestart, en alles nagelopen:

| controle | resultaat |
| --- | --- |
| `discovered_packages()` | vindt `demo`, met `static_dir` en 1 router |
| `all_plugins()` | acht ingebouwde, dan `demo` — de gedocumenteerde volgorde |
| `/plugin-static/demo/{view.js,icon.svg,plugin.css}` | 200, `Cache-Control: no-cache` |
| `/plugin-static/demo/nope.js` | 404 — de shell komt er niet aan te pas |
| `/plugin-static/anders/x.js` | 404 |
| `/plugin-static/demo/../../src/plugins/llm-pool/api.js` (als URL) | 404, de server normaliseert |
| `/api/demo/ping` | 200 |
| `/plugins.js` | `demo` erin, met `styles` |

En in Chromium: het sidebar-item verschijnt, het icoon rendert als `<img>` uit de eigen mount, de
stylesheet wordt geladen **en heeft effect** (de view krijgt de magenta outline uit `plugin.css`),
de view mount en zijn `/api/demo/ping` gaat eruit. Nul console- of pageerrors.

Daarmee is ook vraag 5 beantwoord: het gat tussen de gefabriceerde metadata in
`tests/test_plugin_discovery.py` en een echte installatie is klein. Beide lopen via
`importlib.metadata` over `sys.path`; wat een `pip install` daar nog bovenop doet — locatie in
site-packages, dependency-resolutie — raakt discovery niet. Ik zou die twee end-to-end-tests
vertrouwen.

## Is de discovery streng genoeg, en niet te streng?

Streng: elke faalmodus uit de fase-5-sectie heeft een eigen toets, en alle acht mutaties worden
gevangen.

| mutatie in `app/plugins.py` | gevangen door |
| --- | --- |
| `static_dir`-controle weg | `test_a_missing_static_dir_is_refused` |
| module-prefixcontrole weg | `test_a_view_outside_the_plugins_own_mount_is_refused` |
| icoon-prefixcontrole weg | `test_an_icon_outside_the_plugins_own_mount_is_refused` |
| `isinstance`-controle weg | `test_an_entry_point_that_returns_something_else_is_refused` |
| `try/except` rond `entry_point.load()` weg | `test_a_factory_that_raises_is_refused_with_the_entry_point` |
| routebotsing niet meer weigeren | `test_a_duplicate_route_is_refused` |
| id-botsing niet meer weigeren | `test_a_duplicate_plugin_id_is_refused` |
| sortering op plugin-id weg | `test_a_discovered_plugin_appears_after_the_built_in_ones` |

Niet te streng: `_validate_package` draait alleen vanuit `_discover_packages`, dus uitsluitend voor
pakketten. De ingebouwde plugins — met modules als `src/workflows/chat/index.js`, die de
`plugin-static/`-eis nooit zouden halen — komen er niet langs. Er is dus geen configuratie die
voorheen werkte en nu geweigerd wordt. Zonder pakketten is het API-oppervlak identiek aan `main`
(121 routes) en de payload identiek op de nieuwe `styles`-sleutel na, die voor elke ingebouwde
plugin leeg is.

| suite | branch | `main` |
| --- | --- | --- |
| `pytest` | 177 passed, 5 failed | 161 passed, 5 failed — dezelfde vijf |
| `node --test` | 4 pass | — |
| browsercheck | exit 0 | — |

## Draagt de adresregel?

Voor alles wat binnen het pakket blijft: ja, en dat was precies het punt waar de tweede
ontwerpronde op viel. `_client_owners` loopt nu over `all_plugins()` met `_plugin_roots`, en voor een
pakket buiten `static/` werkt dat:

```
_client_owners -> {'fake'}
_api_paths     -> ['/api/fake/things']
```

En een wortel die niet bestaat is luid in plaats van stil: `_missing_view_files()` meldt
`module … does not exist` in plaats van een lege verzameling terug te geven.

Waar hij niet draagt, staat hieronder als eerste bevinding.

## Bevindingen

### Laag/medium — `..` wordt nergens genormaliseerd, dus de eigen mount is te verlaten

De fase weigert "een view of icoon buiten de eigen mount", maar de controle is een
`startswith`-vergelijking op de ruwe string. Gemeten tegen `_validate_package`:

| configuratie | uitkomst |
| --- | --- |
| `module: plugin-static/mine/view.js` | geaccepteerd (correct) |
| `module: plugin-static/mine/../../src/workflows/chat/index.js` | **geaccepteerd** |
| `icon: plugin-static/mine/../../assets/icons.svg` | **geaccepteerd** |
| `module: plugin-static/mine-evil/view.js` | geweigerd (de prefix is exact, dat deel klopt) |

Aan de voorkant hetzelfde: `PLUGIN_ICON_PATTERN` in `static/src/shared/icons.js` staat `.` en `/`
toe in het laatste deel, dus `plugin-static/mine/../../assets/icons.svg` matcht, en `new URL(...)`
normaliseert het weg uit de mount:

```
plugin-static/mine/icon.svg                -> http://host/app/plugin-static/mine/icon.svg
plugin-static/mine/../../assets/icons.svg  -> http://host/app/assets/icons.svg
plugin-static/mine/../../../etc/x.svg      -> http://host/etc/x.svg
```

Hetzelfde mechanisme laat regel 2 ontsnappen. Een pakket-view op
`/plugin-static/demo/view.js` die `../../src/plugins/llm-pool/api.js` importeert, resolvet in de
browser naar `/src/plugins/llm-pool/api.js` — en dat pad serveert de workbench met **200**
(gemeten). De analyse ziet het niet, want die wandelt het bestandssysteem vanaf `static_dir` en daar
bestaat dat relatieve pad niet:

```
_client_owners -> {'fake'}   vreemde eigenaren: []
```

Zo lopen de URL-ruimte en de bestandsruimte voor een pakket uit elkaar: in de browser werkt de
sprong, op schijf bestaat hij niet, en de toets kijkt naar schijf.

De trust-grens is first-party, dus dit is geen lek in het dreigingsmodel dat het ontwerp
opschrijft. Maar de mountgrens is precies bedoeld om "een plugin serveert alleen zijn eigen
bestanden" waar te maken, en die eigenschap is nu poreus zonder dat iets het meldt. De reparatie is
klein en op één plek per veld: weiger een `..`-segment (of normaliseer vóór de vergelijking) in
`module`, `icon` en het importpad, in plaats van alleen de prefix te vergelijken.

### Laag — `styles` wordt helemaal niet gevalideerd

Van de drie padvelden die een pakket meebrengt, worden er twee gecontroleerd. `styles` niet:

| `styles`-waarde | uitkomst |
| --- | --- |
| `plugin-static/mine/p.css` | geaccepteerd (correct) |
| `https://evil.example/x.css` | **geaccepteerd** |
| `../../assets/anders.css` | **geaccepteerd** |
| `/etc/passwd` | **geaccepteerd** |

`applyPluginStyles` (`static/app.js`) zet de waarde via `link.href` met de DOM-API, dus er is geen
markup-injectie — dat deel is goed gedaan. Maar een first-party pakket kan zijn stylesheet stil van
een externe CDN halen, en dat is precies het soort verrassing waar de mountgrens voor bestaat. Het
is dezelfde controle als voor `icon`, één regel verderop.

Wat wél klopt: `applyPluginStyles(PLUGINS)` krijgt de payload, en die bevat alleen ingeschakelde
plugins — een uitgezette categorie laadt dus geen stylesheet.

### Laag — `_DISCOVERED` wordt toegekend vóór de botsingscontrole

```python
if _DISCOVERED is None:
    _DISCOVERED = _discover_packages()
    _check_collisions(_DISCOVERED)
return _DISCOVERED
```

De toekenning staat vóór de controle, dus na een botsing is de cache al gevuld. Gemeten met een
pakket dat de id `llm-pool` kiest:

```
poging 1: ValueError: duplicate plugin id: llm-pool
poging 2: GEEN fout, levert ['llm-pool']
```

In productie is dit ingedamd: `app/router.py` roept de functie als eerste aan tijdens import, die
raise propageert en de app start niet. Maar de belofte "een botsing wordt geweigerd" geldt nu alleen
voor de eerste aanroeper. Een lokale variabele die pas na `_check_collisions` aan `_DISCOVERED`
wordt toegekend, sluit het.

## Klopt het serveren?

Ja, op elk punt uit de vraag:

- **Mountvolgorde.** De pluginmounts staan in `app/main.py` tussen `/plugins.js` en de catch-all, en
  een onbekend pad eronder geeft 404 in plaats van de shell — met een echt pakket gemeten.
- **`Cache-Control: no-cache`** op alle drie de bestandstypen, via dezelfde
  `RevalidatingStaticFiles` als de eigen map.
- **Een router zonder de categorie aan.** Met `plugins.enabled: ["image-pool"]` en `demo`
  geïnstalleerd: `/api/demo/ping` geeft 200 en `/plugin-static/demo/view.js` geeft 200, terwijl
  `demo` niet in `/plugins.js` staat. Precies wat "geïnstalleerd is niet hetzelfde als aan"
  belooft.

## Is het escapen waterdicht voor deze fase?

Voor de sidebar ja, en niet alleen volgens de browsercheck. Ik heb het pakket markup laten dragen —
label `Demo <b>Plugin</b>`, viewnaam `Demo "X" <i>y</i>` — en in de DOM gekeken:

```
innerHTML : <img class="app-icon sidebar-icon" src="…/plugin-static/demo/icon.svg" alt="">
            <span class="link-text">Demo "X" &lt;i&gt;y&lt;/i&gt;</span>
tekst     : Demo "X" <i>y</i>      tooltip: Demo "X" <i>y</i>
injectie  : 0 elementen            sectiekop-injectie: 0
```

Vier velden gedekt: `route` en `tooltip` met `escapeAttr`, `name` en de sectiekop met `escapeHtml`,
en het icoon-`src` met `escapeAttr` in `iconMarkup`. Het enige pad waarlangs plugin-data nog de DOM
in komt is `styles`, en dat loopt via de DOM-API — geen markup, wel ongevalideerd (bevinding 2).

## Wat is er niet af?

Niets dat fase 5 had moeten doen. De scopegrens is houdbaar nu de code er staat: geen isolatie
(consistent met de first-party-grens, en de code voegt niets toe dat dat verandert), de ingebouwde
plugins blijven in de repo (en blijven daarmee de regressiebasis waar de payloadvergelijking met
`main` op leunt), en geen hot reload — discovery draait bij import, wat de code ook doet en wat het
document zegt.

Wat ik zou toevoegen aan de gatenlijst in sectie 4: dat de mountgrens op stringvergelijking rust en
dus met `..` te omzeilen is, zolang bevinding 1 niet is opgelost. Dat is nu de enige plek waar het
document iets belooft dat de code net niet waarmaakt.

## Samenvatting

- Discovery is streng en compleet: acht faalmodi, acht toetsen, acht mutaties rood.
- De adresregel wordt nu werkelijk afgedwongen voor een pakket buiten `static/` — het punt waar de
  tweede ontwerpronde op viel is opgelost — behalve langs `..`.
- Escapen en serveren kloppen, met een echt geïnstalleerd pakket gecontroleerd tot en met de
  stylesheet die effect heeft.
- Drie nits, alle drie dezelfde familie: normaliseer `..` in de drie padvelden en in het importpad,
  valideer `styles` zoals `icon`, en ken `_DISCOVERED` pas na de botsingscontrole toe.
