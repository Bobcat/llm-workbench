# Code-review llm-workbench — sidebar vanuit een plugin-registry

- Base: `main` @ `68e720c`
- Head: `refactor/plugin-registry` @ `58739e0` (`refactor(frontend): drive the sidebar from a
  plugin registry`; 382 toegevoegd / 317 verwijderd over 10 bestanden)
- Eén commit, nog niet gepusht, geen PR. Werkkopie schoon; ook de twee andere worktrees
  (`/tmp/llm-workbench-omnidoc-*`) zijn schoon, dus dit is het enige losse werk
- Context: dit is een klein experiment met een nieuw coding model. De review beoordeelt daarom
  niet alleen de code, maar ook of de commit message klopt over zijn eigen werk — zie
  *Beoordeling als modeloutput* onderaan
- Uitgevoerd: de volledige diff en de omliggende code gelezen; `RouterCore` nagelezen op de
  mount/unmount-volgorde; **de registry echt geïmporteerd in Node v24** en de afgeleide sidebar,
  routetabel, aliassen en persistentie-set programmatisch vergeleken met de oude hardcoded
  structuren uit `58739e0^`; alle 20 modulepaden op bestaan gecontroleerd en per pad
  gecontroleerd dat de genoemde factory daadwerkelijk geëxporteerd wordt; de view-factories
  nagelopen op neveneffecten bij constructie (timers, globale listeners); de twee
  runtime-scenario's uit de bevindingen nagespeeld in een Node-harnas met dezelfde mountlogica;
  `README.md` nagekeken op vermeldingen van sidebarregistratie
- Niet uitgevoerd: geen browserpas. De commit noemt een Playwright-doorloop over alle routes;
  die is niet gereproduceerd en zit ook niet in de repo. Bevindingen 1 t/m 3 zijn daarom
  onderbouwd met een Node-simulatie van de mountlogica, niet met de echte app
- Python-suite niet gedraaid: `git diff --stat main...HEAD -- '*.py'` is leeg, de diff raakt
  geen enkel `.py`-bestand

**Verdict: bruikbaar, één bevinding eerst oplossen.** De refactor is architectonisch de juiste
stap en de pariteitsclaim uit de commit message is echt waargemaakt, niet alleen beweerd — ik heb
de volledige oude en nieuwe configuratie naast elkaar gelegd en ze zijn identiek. Eén bevinding
zou ik opgelost willen zien voordat hier verder op gebouwd wordt: een kapotte manifest-verwijzing
levert nu een stil lege pagina op in plaats van een zichtbare fout, en dat is een slechtere
failure mode dan wat er stond.

## Wat de commit doet

De sidebar- en routeconfiguratie zat hardcoded in `static/app.js`: `WORKFLOW_GROUPS`,
`AUXILIARY_WORKFLOWS`, `PERSISTENT_WORKFLOW_IDS`, een `ROUTE_ALIASES`-map, een
`createWorkflowView()` met 20 `if`-takken en 20 statische imports bovenaan. Eén categorie
toevoegen raakte zeven plaatsen.

Elke categorie is nu een manifest onder `static/src/plugins/` met een data-only vorm (ids,
labels, iconen, modulepad, factorynaam, `persistent`, `auxiliary`).
`static/src/plugins/registry.js` leidt daaruit de sidebar, de routetabel, de aliastabel en een
lazy view-loader af. `static/app.js` bedraadt alleen nog de shell en gaat van 540 naar 278
regels.

Twee gedragsveranderingen die geen configuratie zijn:

- **Lazy loading.** View-modules worden pas bij de eerste activatie geïmporteerd in plaats van
  allemaal bij startup. Dat is de eigenlijke winst naast de datastructuur.
- **Generatie-teller.** `RouterCore.navigate()` negeert de return van `mount()`
  (`static/foundation/spa-foundation/RouterCore.js:157`), dus `mount` kan niet awaiten. Een
  globale `mountGeneration` bewaakt dat een traag ingeladen module zichzelf niet alsnog aanhecht
  nadat de gebruiker al weg genavigeerd is.

De README beschrijft op regel 193-197 waar dit heen moet: ingeschakelde sidebargroepen uit
settings halen zodat een installatie alleen de consoles toont die ze nodig heeft, bijvoorbeeld
een LLM Pool-only workbench. De data-only manifestvorm is precies de voorbereiding daarop —
alleen de bron van `PLUGINS` hoeft dan te veranderen, de loader niet.

## Wat geverifieerd is en klopt

De registry geïmporteerd in Node en de afgeleide structuren vergeleken met de oude hardcoded
config uit `58739e0^`:

| eigenschap | resultaat |
| --- | --- |
| categorieën + volgorde + view-ids per categorie | identiek |
| auxiliary-items | identiek (`icons`) |
| persistente views | identiek, 19 stuks |
| route-aliassen | identiek, 4 stuks |
| iconen per view | identiek |
| tooltips | identiek |

Totalen: 7 categorieën, 20 views, 19 persistent, 4 aliassen — exact wat de commit message claimt.
Verder: geen dubbele routes, geen alias die een bestaande route overschaduwt, alle aliasdoelen
resolven naar een bestaande view, en `id === route` voor alle 20 views.

Alle 20 modulepaden bestaan en exporteren de in het manifest genoemde factory (per bestand
gecontroleerd, niet steekproefsgewijs). Geen achtergebleven referenties naar `WORKFLOW_GROUPS`,
`AUXILIARY_WORKFLOWS`, `PERSISTENT_WORKFLOW_IDS` of `createWorkflowView` in de hele repo.

De dode `Unknown: ${workflowId}`-fallback uit `createWorkflowView` is terecht weggehaald: routes
werden al uitsluitend uit `WORKFLOWS` geregistreerd, dus die tak was onbereikbaar.

## Bevindingen

### Medium — een kapotte manifest-verwijzing wordt een stil lege pagina

`static/app.js:146-151`. De koppeling module ↔ factory is nu een *string* in een manifest, niet
langer een import die de browser bij startup controleert. Voorheen sloopte een hernoemde factory
de hele app direct zichtbaar; nu faalt alleen die ene route, zonder enig signaal in de UI. De
sidebar markeert de route zelfs als actief, want `onRouteDidMount` draait synchroon nadat
`mount()` de nog niet opgeloste promise heeft teruggegeven.

`RouterCore` negeert de return van `mount()`, dus de rejection gaat nergens heen:

```
scenario 2 (kapotte manifest-verwijzing):
  UNHANDLED REJECTION: does not export createFooView()
  host inhoud: []   -> lege pagina, geen foutmelding
```

Dit is precies het risico dat de refactor introduceert: de stringkoppeling is niet meer statisch
verifieerbaar. Voorstel: een `.catch` in `mount` die de fout in de host rendert, zodat een
verkeerd `module`- of `factory`-veld meteen zichtbaar is in plaats van als lege pagina.

### Laag — geen dedupe van in-flight loads, factory wordt dubbel aangeroepen

`static/app.js:131-137`. `obtainView()` controleert alleen de *opgeloste* cache. Navigeer je weg
en terug voordat de import binnen is, dan start de tweede mount een tweede `loadView` en wordt de
factory twee keer aangeroepen; `cachedView` wordt vervolgens de tweede instantie en de eerste is
een wees. Nagespeeld:

```
scenario 1 (chat -> img -> chat, module traag):
  factory-aanroepen voor chat : 2 (verwacht 1)
  cachedView is instance      : 2   -> instance 1 is wees
```

Ik heb nagegaan hoe erg dat is: alle polling en timers in de views zitten achter `__onActivate`
(nagelopen in `llm-pool`, `pdf-translation`, `image-pool`, `image-train`, `tts-pool`,
`video-pool`, `translation-requests`, `text-generation`). De weesinstantie start dus geen interval
en geen fetch. De kosten blijven een weggegooide DOM-boom, en er gaat geen state verloren omdat
geen van beide instanties geactiveerd was. Fix is één `pending`-promise in de closure.

### Laag — "Behaviour is unchanged" klopt niet helemaal

Er is geen loading-state. `RouterCore.navigate()` leegt de host vlak voor `mount()`, en bij een
koude view blijft die leeg tot de import resolvet. De eerste activatie van een zware view geeft
nu dus een lege flits waar het voorheen synchroon was. Klein, maar het is een waarneembare
gedragsverandering die de commit message uitsluit.

### Laag — README is achtergebleven

`README.md:138` ("`static/app.js` registers sidebar groups and workflow views") en `README.md:193`
("The sidebar is currently registered in `static/app.js`") zijn achterhaald. Regel 193-197
beschrijft bovendien precies de richting die deze commit inzet — dit is de commit waar die
alinea bij hoort te worden bijgewerkt, inclusief een verwijzing naar `static/src/plugins/` in de
Code Map.

### Laag — geen test gecommit voor het nieuwe contract

De commit message noemt een `node --check`, een resolutiecheck en een Playwright-doorloop, maar
daarvan zit niets in de repo; `tests/` is uitsluitend Python API-test. Juist de nieuwe
manifest-string → export-koppeling is het soort contract dat stil breekt bij een rename, en dat
is dezelfde oorzaak als de medium-bevinding hierboven. De resolutiecheck die voor deze review is
gedraaid, is ongeveer 15 regels Node en vangt dat vóór runtime af.

### Laag — `host.innerHTML = ''` in `mount` is nu dubbel

`static/app.js:145`. `RouterCore.navigate()` doet `this.host.innerHTML = ""` direct vóór de
aanroep van `mount()`. In het async-pad draait de regel bovendien op het verkeerde moment
(mounttijd in plaats van resolvetijd), waar hij niets meer toevoegt. Onschuldig, maar dood.

### Laag, vooruitkijkend — ongeescapete interpolatie in `pluginItemMarkup`

`static/app.js:61-68` zet `wf.name`, `wf.tooltip` en `wf.route` rauw in `innerHTML`. Nu veilig:
de data is statisch en gecommit. Maar de comment bovenin `registry.js` houdt expliciet de deur
open om dezelfde payload later vanaf de backend te serveren, en op dat moment is dit een
injectiepunt. `escapeHtml`/`escapeAttr` bestaan al in de codebase en worden onder meer in
`static/src/workflows/llm-pool/index.js` gebruikt.

### Nit

`getWorkflow` en `ROUTE_ALIASES` worden uit `registry.js` geëxporteerd maar alleen intern
gebruikt; `app.js` importeert `PLUGINS`, `WORKFLOWS`, `loadView` en `normalizeRoute`.

## Samenvatting per prioriteit

- **Eerst:** de medium-bevinding (zichtbare fout in plaats van lege pagina).
- **Goedkoop mee te nemen:** in-flight dedupe en de dubbele `innerHTML = ''`.
- **Aparte follow-up waard:** loading-state, README-update, een resolutietest, en het escapen
  zodra manifests van buiten de repo kunnen komen.

## Beoordeling als modeloutput

Relevant omdat dit een experiment met een nieuw coding model is: hoe betrouwbaar is het over zijn
eigen werk?

**Goed.** De scope is strak — geen opportunistische refactors, geen aangeraakte view-modules,
geen compatibiliteitslaag naast de oude code. De oude structuren zijn echt verwijderd in plaats
van ernaast blijven staan. De dode `Unknown`-fallback is opgemerkt en weggehaald. De data-only
manifestvorm sluit aan op het doel dat al in de README stond, wat suggereert dat het model die
context meegenomen heeft. En de generatie-teller is geen standaardpatroon: het model heeft
gezien dat `RouterCore` de return van `mount()` negeert en heeft daar zelf een guard voor
gebouwd. Dat is de lastigste stap in de diff en die is correct.

**Waar het tekortschiet.** Het model heeft de async-omzetting half afgemaakt: de gelukkige weg is
bewaakt, maar de faalweg (rejection) en de tussenstand (loading) niet. De guard die het zelf
bedacht, dekt precies één van de drie gevallen die de omzetting introduceert.

**Claims tegen de werkelijkheid.** De pariteitsclaim (7/20/4/19) is exact juist en volledig
verifieerbaar gebleken — dat is de belangrijkste positieve bevinding. "Behaviour is unchanged" is
te sterk: de loading-flits is een reële gedragsverandering. De genoemde `node --check`,
resolutiecheck en Playwright-doorloop zijn niet in de repo terechtgekomen, dus die claims zijn
niet na te lopen; de resolutiecheck heb ik zelf gereproduceerd en die slaagt, de Playwright-pas
niet. Netto: nauwkeurig over meetbare feiten, iets te stellig over gedrag, en het levert zijn
eigen verificatie niet mee.
