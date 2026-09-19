# Plugin-architectuur — beslissingen en fase-afbakening

Status: fase 1 is gebouwd en staat op `main`; fase 2 t/m 4 zijn niet begonnen.
Anker: `main` @ `a0f79d8`.

Dit document beschrijft **beslissingen en afbakening**, niet de implementatie. De code is de
bron van waarheid; waar dit document en de code verschillen, wint de code. Elke fase heeft
daarom een status en een verificatie die je kunt draaien.

## 1. Wat is een plugin hier

Een plugin is **één sidebar-categorie met één of meer views**. Meer niet.

Wel:

- een map `static/src/plugins/<id>/` met een `manifest.js`
- een lijst views die elk een module en een factory noemen
- later: eigen CSS, iconen, API-calls, en een aan/uit-schakelaar

Niet, en dat is een bewuste grens:

- **geen isolatie of sandboxing.** Plugins delen het DOM en de global scope. `index.html` laadt
  markdown-it en DOMPurify globaal en de chatview leest `window.markdownit`. Een plugin van
  buiten de repo krijgt dus volledige toegang tot de pagina. Dat is nu acceptabel omdat alle
  plugins in deze repo staan; het is een harde voorwaarde om te heroverwegen zodra fase 4
  plugins van buiten toelaat.
- **geen hot reload, geen versiebeheer per plugin, geen marketplace.**
- **geen package-manager.** Fase 4 gebruikt pip entry points, maar dat is discovery, geen
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

### Registry

`static/src/plugins/registry.js` is de enige plek die weet wat er bestaat:

| Export | Regel | Rol |
| --- | --- | --- |
| `PLUGINS` | 36 | de pluginlijst, in sidebar-volgorde |
| `ROUTE_ALIASES` | 48 | oude routenamen die blijven werken |
| `WORKFLOWS` | 56 | alle views, plat |
| `normalizeRoute` | 60 | alias → routenaam |
| `getWorkflow` | 65 | route → view-descriptor |
| `loadView` | 75 | laadt de module en roept de factory aan; `retry` zet `?retry=<n>` |

De registry **laadt** views; hij bezit ze niet. Caching, activering en de DOM blijven van de
shell (`static/app.js`). Die grens is bewust: de registry is dan puur data + laden en hoeft geen
levenscyclus te kennen.

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
Prijs: een koude view kost een netwerkrequest en kan even een placeholder tonen. Tweede prijs,
en die kostte een middag zoeken: een dynamic import valt buiten de cache-bypass van Ctrl+F5,
waardoor een gewijzigde view onzichtbaar kon blijven. Dat is server-side opgelost met
`Cache-Control: no-cache` (`app/main.py`, `RevalidatingStaticFiles`, regel 16).

## 3. Fasen

### Fase 1 — frontend leest zijn eigen configuratie ✅

| | |
| --- | --- |
| **Doel** | één plek die weet welke categorieën en views bestaan |
| **As-built** | 8 manifesten (7 categorieën + 1 auxiliary), 20 views, 19 persistent, 4 aliassen |
| **Scopegrens** | geen backendwijziging, geen enable/disable, geen per-plugin assets, geen view-module aangeraakt |
| **Verificatie** | `node --test 'tests/js/**/*.test.mjs'` (6 tests, mutatie-geverifieerd), `./.venv/bin/python tests/browser/check_plugin_registry.py`, `pytest` onveranderd |
| **Hertoetsing** | drie reviewrondes: `docs/reviews/refactor-plugin-registry.md`, `docs/reviews/plugin-registry-hardening.md` |

### Fase 2 — Python wordt de bron van waarheid ⬜

| | |
| --- | --- |
| **Doel** | router-mount en sidebar kunnen niet meer uit elkaar lopen |
| **Contractwijziging** | `GET /api/plugins` levert dezelfde payloadvorm; `PLUGINS` komt van dat endpoint in plaats van uit 8 imports; `app/router.py` wordt een lus over dezelfde registry in plaats van 16 `include_router`-regels |
| **Scopegrens** | geen discovery buiten de repo, geen enable/disable, geen per-plugin assets |
| **Verificatie** | de bestaande regressiepin blijft groen; aanvullend een test die de geserveerde payload tegen de manifesten vergelijkt |
| **Open** | wat doet de sidebar als `/api/plugins` faalt of traag is? Een lege sidebar is een nieuw failure mode |

### Fase 3 — per-plugin assets en enable/disable ⬜

| | |
| --- | --- |
| **Doel** | een installatie toont alleen wat ze nodig heeft, bijvoorbeeld LLM Pool-only |
| **Contractwijziging** | een plugin declareert zijn eigen CSS en iconen; de gedeelde `api-client.js` (101 methodes in één object) wordt per plugin of per namespace opgesplitst; `id` wordt de settings-sleutel |
| **Scopegrens** | geen hot reload; assets blijven statische bestanden zonder buildstap |
| **Verificatie** | een uitgeschakelde plugin levert geen sidebar-item én geen gemounte router |

### Fase 4 — discovery buiten de repo ⬜

| | |
| --- | --- |
| **Doel** | een plugin kan in een eigen package leven |
| **Contractwijziging** | discovery via entry points; het manifestcontract blijft gelijk |
| **Scopegrens** | geen sandboxing, geen versie-eisen. Zonder isolatie is dit alleen veilig voor plugins die je zelf schrijft — dat is een expliciete voorwaarde, geen detail |

## 4. Bekende gaten en geaccepteerde schuld

Deze zijn bewust blijven liggen; ze horen bij fase 2 of 3.

- `static/src/plugins/registry.js:27-46` — de 8 manifesten worden **handmatig** geïmporteerd en
  in een handmatige `PLUGINS`-array gezet. Een plugin toevoegen is dus map + import + arrayregel.
  Geen discovery. Fase 2 haalt dit weg.
- Geen `/api/plugins`; `app/router.py` heeft 16 handgeschreven `include_router`-regels.
- Geen enable/disable, dus de hele workbench toont altijd alles.
- `css/app.css` is één globaal `@import`-manifest van 25 regels en er is één globale
  iconensprite; een plugin kan nog geen eigen assets bijdragen.
- `static/app.js:93`, `:106`, `:327` — de shell hardcodeert `replay-translate`. Dat is precies
  wat fase 2 hoort weg te nemen, door Replay hetzelfde `WORKFLOW_BUSY_EVENT` te laten sturen als
  de vijf andere views.
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
| Python als bron van waarheid via `/api/plugins` (fase 2) | Alleen JS-manifesten: id's en routers kunnen uit elkaar lopen. Een gedeeld JSON-bestand: verliest de koppeling met de echte routers en settings |
| Data-only manifesten, `module`/`factory` als strings | Factory-functies direct importeren: werkt, maar valt niet uit te serveren |
| Lazy loading bij eerste activering | Alles eager importeren: geen eerste-klik-kosten, maar ~21k regels JS parsen bij het opstarten |
| Registry laadt, shell bezit de levenscyclus en de DOM | Registry ook eigenaar van caching en activering: mengt data met DOM-beheer |

## 6. Open vragen voor de reviewer

1. Is de payloadvorm van fase 2 voldoende voor fase 3, waarin enable/disable per **plugin** én
   per **view** nodig kan blijken?
2. Moet een plugin een sidebar-item kunnen hebben zonder dat de backend hem mount, of omgekeerd?
3. Wat is het gewenste gedrag als `/api/plugins` niet antwoordt — is een lege sidebar
   acceptabel, of moet de shell een minimale set embedded houden?
4. Moet de regressiepin na fase 2 in Python leven (payload vergelijken) of in JS blijven
   (payload consumeren)?
5. Is de niet-isolatie van plugins acceptabel voor fase 4, en welke drempel wil je daarvoor?
6. Wat is het juiste moment om `replay-translate` uit de shell te halen — in fase 2, of eerder
   als losse opruiming?
