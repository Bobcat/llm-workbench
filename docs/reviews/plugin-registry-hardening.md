# Code-review llm-workbench — plugin-registry, hardening na de eerste review

- Base: `main` @ `68e720c`
- Head bij deze ronde: `refactor/plugin-registry` @ `2e2ed93`
- Beoordeeld: `a9939ed` (`fix(frontend): make the plugin loader fail visibly and share
  in-flight loads`; 236 toegevoegd / 23 verwijderd over 4 bestanden). `58739e0` is in
  `docs/reviews/refactor-plugin-registry.md` gereviewd; `2e2ed93` voegt alleen de reviewprompt toe
- Werkkopie schoon, ook na alle mutatietests hieronder
- **Er is een derde ronde gevolgd op `705ae9a`; zie *Derde ronde* onderaan. De nits hieronder zijn
  daar alle vier verwerkt en nageteld. Eindoordeel over de branch staat in die sectie.**

**Verdict tweede ronde: approve with nits.**

De medium-bevinding uit de vorige review is opgelost en dat is in de browser vastgesteld, niet
afgeleid. De twee kleine bevindingen zijn ook opgelost, de README klopt weer, en er is geen scope
creep: de acht expliciet buiten scope geplaatste punten zijn onaangeroerd gebleven. Wat overblijft
is één inhoudelijke onnauwkeurigheid — "a failed load can be retried" is in de praktijk niet waar —
plus enkele gaten in de testsuite en twee te stellige zinnen in de commit message. Geen daarvan
blokkeert.

## Uitgevoerde verificatie

Node is op deze host aanwezig (v24.21.0), anders dan de vorige reviewprompt aannam.

| commando | resultaat |
| --- | --- |
| `node --test 'tests/js/**/*.test.mjs'` | 6 pass, 0 fail — zoals geclaimd |
| `node --input-type=module --check` op `app.js`, `registry.js` en alle 8 manifesten | alle OK |
| `./.venv/bin/python -m pytest tests` op deze branch | 116 passed, 5 failed |
| dezelfde suite op `main` (losse worktree, zelfde venv) | 116 passed, 5 failed, **dezelfde vijf** |

De vijf failures zijn `tests/test_replay_api.py::ReplayApiTests::{test_create_session_resolves_
relative_sample_path_from_repo_root, test_export_includes_llama_cpp_runtime_settings,
test_replay_websocket_uses_delta_transcript_updates, test_set_second_pass_model_uses_second_pass_
backend_terms, test_set_second_pass_prompt_accepts_second_pass_prompt}`. Ze falen identiek op
`main`, dus ze zijn aantoonbaar bestaand — uitgevoerd, niet weggeredeneerd.

Browser: de app gestart op `127.0.0.1:8099` en met Playwright/Chromium 151 doorlopen. Alle 20
routes, de 4 aliassen, persistentie, de niet-persistente view, themawissel, en de drie
gevraagde interceptiescenario's. 16 van de 18 checks slaagden in de eerste ronde; de twee
afwijkingen zijn daarna geïsoleerd nagemeten en staan hieronder als bevinding 3 en 4. Eén
scenario (fout die arriveert ná een generatiewissel) gaf met de sync-API een onbetrouwbare
meting doordat een blokkerende route-handler de dispatcher vasthoudt; dat scenario is overgedaan
met de async-API en pas daarna gerapporteerd.

## Zijn de bevindingen van de vorige review opgelost?

### Medium — stille lege pagina bij een kapotte manifest-verwijzing: **ja, afdoende**

`static/app.js:193-197` vangt de rejection en rendert `buildViewError()`. In de browser
gecontroleerd door de module-request af te breken:

- `.workflow-error` verschijnt;
- het paneel is het **enige** in de host (`children == 1`, geen placeholderresten);
- de titel noemt de viewnaam: `Could not load the "PDF benchmark" view`;
- het detail noemt modulepad én factory:
  `src/workflows/pdf-testing/index.js -> createPdfTestingView()` plus de browserfout.

Ook het geval dat de prompt apart noemt — module importeert wel, maar de factory gooit tijdens de
aanroep — levert het foutpaneel op. Dat werkt omdat `loadView()` een `async function` is, zodat
een synchrone throw in `factory()` een rejection wordt. Gecontroleerd door de module te
vervangen door één die gooit.

Het paneel is in beide thema's leesbaar; de `--danger*`-tokens worden in `css/themes/dark.css`
overschreven. Gemeten contrast titel/achtergrond 5.55 (licht) en 4.80 (donker), detail 7.86 en
11.79, placeholder 4.63 — alles boven de AA-drempel van 4.5.

### Laag — geen in-flight dedupe: **ja**

`static/app.js:147-160` deelt de pending promise per route. Gemeten met een vastgehouden
module-request en weg-en-terug navigeren tijdens die hold: **1 netwerkrequest**, één view in de
host, geen foutpaneel, geen placeholderrest.

### Laag — geen loading-state: **ja**, met een kanttekening

`.workflow-loading` verschijnt tijdens een koude load met de juiste tekst (`Loading PDF
anatomy…`) en verdwijnt bij zowel succes als fout. Zie bevinding 4 voor de claim erover.

Het synchrone pad is echt synchroon gebleven: `static/app.js:177-180` kort de gecachete
persistente view af vóór de placeholder. Gemeten met een frame-loop over ~90 frames: **0 frames**
met placeholder bij een gecachete persistente view, tegen 2 frames bij een echt koude module.

### Laag — README achtergebleven: **ja**

De Code Map noemt nu `static/src/plugins/`, het Runtime Model beschrijft het manifest-model en
lazy loading, en de Verification-sectie documenteert `node --test 'tests/js/**/*.test.mjs'`. De
oude zin "The sidebar is currently registered in `static/app.js`" is weg. Op de punten die deze
branch raakt is de README accuraat.

### Ontbrekende test: **ja**, zie bevinding 5 voor wat de suite wel en niet vastpint

## Nieuwe bevindingen

### Laag/medium — "a failed load can be retried" is in de praktijk niet waar

`static/app.js:155-157`. De `.finally()` zet `pendingView` terug op `null` met het commentaar
*"a later activation retries after a failure"*, en de commit message herhaalt dat. Op app-niveau
klopt het: een volgende activatie roept `loadView()` opnieuw aan. Maar de browser memoïseert een
mislukte dynamic import in de module map, dus die tweede aanroep doet geen nieuwe fetch en levert
dezelfde rejection.

Geïsoleerd gemeten, buiten de app om, met een afgebroken module-request:

```
2 pogingen terwijl het netwerk faalt: ['fail: Failed to fetch…', 'fail: Failed to fetch…']  netwerk-requests: 1
poging 3, netwerk werkt weer:         'fail: Failed to fetch…'                              netwerk-requests: 1
```

Drie pogingen, één netwerkrequest, en de derde faalt nog steeds terwijl het netwerk al hersteld
is. In de app gecontroleerd: na een mislukte load blijft terugkeren naar die route het foutpaneel
tonen, ook nadat de interceptie is opgeheven. Gevolg: een tijdelijke storing — pool herstart,
deploy halverwege een sessie, haperend netwerk — is permanent tot de gebruiker de pagina herlaadt.

Dit is geen regressie; vóór de hardening herstelde een mislukte load ook niet. Maar de claim
staat nu expliciet in code én commit message. Kies één van twee: het commentaar bijstellen tot
wat het echt doet (voorkomen dat een tweede mount een tweede constructie start), of de retry echt
werkend maken door bij een nieuwe poging een cache-busting parameter aan de module-URL te hangen.

### Laag — een fout die ná een generatiewissel arriveert verdwijnt spoorloos

`static/app.js:194`. Als de load faalt nadat de gebruiker is weg genavigeerd, keert de
error-handler terug zonder iets te doen. Deterministisch nagemeten met de async-API:

```
1. load hangt nog, op de route      : {loading: True,  err: False}
2. weggenavigeerd naar chat         : chat-view
3. fout arriveert na generatie-bump : {err: False}, unhandled pageerrors: [], console errors: []
4. terug naar de route              : {err: True, title: 'Could not load the "PDF benchmark" view'}
```

Geen UI, geen unhandled rejection, en ook geen `console.error` vanuit de app — alleen de
`net::ERR_FAILED` die de browser zelf logt. Het niet tonen van een foutpaneel is hier correct: de
gebruiker staat op een andere route. Wat ontbreekt is een diagnostisch spoor. Merk op dat de
memoïsatie uit de vorige bevinding dit per ongeluk afdekt: stap 4 laat de fout alsnog zien. Een
`console.error` in beide `generation !== mountGeneration`-takken zou dit sluiten; nit-niveau.

### Nit — onbereikbare tak in `obtainView()`

`static/app.js:148` is `if (wf.persistent && cachedView) return Promise.resolve(cachedView);`.
`obtainView()` wordt alleen aangeroepen vanaf `static/app.js:187`, en `mount` heeft die conditie
op regel 177 al synchroon afgevangen en is dan al teruggekeerd. De tak kan niet meer waar zijn.
Dood pad.

### Nit — de commit message is op twee punten te stellig

**"an already imported module resolves in a microtask, so the placeholder never reaches a paint"**
(ook als commentaar op `static/app.js:175-176`). Gemeten met een frame-loop die vóór de navigatie
al draait, over ~90 frames per meting:

| geval | frames met placeholder |
| --- | --- |
| gecachete persistente view (19 van de 20 views) | 0 |
| echt koude module | 2 |
| niet-persistente view (`icons`), herhaald bezoek | 1 |

Bij het derde geval — precies het geval waar de claim over gaat — haalt de placeholder dus wél
één frame. Praktisch verwaarloosbaar: het raakt alleen `icons`, de enige niet-persistente view,
en het gaat om ~16 ms. Maar de zin klopt niet zoals hij er staat.

Eerlijkheidshalve: ik heb de *oorzaak* niet kunnen vastpinnen. Een geïsoleerde meting van
`await import(url)` op een al geïmporteerde module gaf 0 tussenliggende frames
(`paintedBeforeResolve: false`), wat de claim juist ondersteunt. Het verschil zit dus ergens in
het samenspel met de popstate-taak, niet in de import zelf. Ik rapporteer hier de gemeten uitkomst,
niet een verklaring.

**"a Chromium pass over all 20 routes, aliases, persistence, theming, the loading placeholder, the
error panel and the away-and-back race"** — die doorloop is gereproduceerd en slaagt, maar zit
niet in de repo. Voor de tweede keer op deze branch is een verificatieclaim niet meegeleverd. De
JS-suite is dat nu wel; de browserpas niet.

De rest van de commit message klopt: 6/6 `node --test`, `node --check`, en 116 passed met vijf
bestaande replay-failures zijn alle drie nagelopen en juist.

### Laag — wat de testsuite wel en niet vastpint

De prompt vraagt of `EXPECTED_CATEGORIES` een echte pariteitscontrole is of een tweede kopie die
net zo goed kan afwijken. Antwoord: het is een echte controle, maar tegen *verandering*, niet
tegen *de oude implementatie*. De verwachte lijst is met de hand geschreven vanuit de nieuwe
manifesten, dus een overschrijffout die in `58739e0` was gemaakt zou hier zijn meegekopieerd in
plaats van gevangen. De vergelijking met `main` is in de vorige reviewronde gedaan en is niet
gecommit. Het commentaar noemt dit "the parity contract"; "regressiepin" dekt het preciezer.

Mutatietest — per mutatie de suite gedraaid en teruggedraaid:

| mutatie | suite |
| --- | --- |
| factory hernoemd (`createChatView` → `createChatViewX`) | **faalt** ✓ (de door de prompt gevraagde mutatie) |
| modulepad kapot | **faalt** ✓ |
| icoon dat niet in de sprite staat | **faalt** ✓ |
| view verwijderd uit een categorie | **faalt** ✓ |
| volgorde binnen een categorie gewijzigd | **faalt** ✓ |
| categorielabel gewijzigd | **faalt** ✓ |
| aliasdoel gewijzigd | **faalt** ✓ |
| `persistent` van één view omgezet | **faalt** ✓ |
| `persistent` *geruild* tussen twee views (som blijft 19) | past ✗ |
| icoon *geruild* tussen twee bestaande views | past ✗ |
| `tooltip` verwijderd | past ✗ |
| `name` gewijzigd (sidebarlabel) | past ✗ |
| view-`id` hernoemd, route ongewijzigd | past ✗ |

De suite vangt dus alles wat de loader stuk maakt. De gaten zitten in wat de gebruiker ziet:
`EXPECTED_PERSISTENT` is een telling (19) en geen verzameling, de categorieën vergelijken
`view.route` en niet `view.id`, en icoon-per-view, `name` en `tooltip` zijn nergens vastgelegd —
alleen dát het icoon in de sprite bestaat. De vorige reviewronde controleerde icoon-per-view,
tooltips en de persistente *verzameling* wel. `EXPECTED_PERSISTENT` een `Set` maken en de
categorieën op `[route, name, icon]` vergelijken sluit dat, en kost een paar regels.

Op de andere vraag uit de prompt: de icooncontrole wordt **niet** stil overgeslagen. `readFile`
gooit als `icons.svg` ontbreekt, en `assert.ok(defined.size > 0)` vangt een sprite zonder
`<symbol>`. De mutatie met een niet-bestaand icoon laat de test ook daadwerkelijk falen.

## Scope creep

Geen. De diff raakt exact vier bestanden: `README.md`, `static/app.js`, `static/css/shell.css`
(de twee nieuwe panelen) en `tests/js/plugin-registry.test.mjs`. Geen view-module, geen
`.py`-bestand. De acht punten uit de scopegrens van de prompt — dubbele `host.innerHTML = ''`,
ongeëscapete interpolatie, de `replay-translate`-special-case, `WORKFLOWS[0]` als default, de
alias-asymmetrie, het ontbrekende `__onActivate` in twee views, het handmatige `PLUGINS`-array en
het ongebruikte `id`-veld — zijn alle acht onaangeroerd gebleven.

## Observatie, geen bevinding

Een `__onActivate` die gooit laat de view wel in de DOM staan maar produceert een unhandled
rejection en geen foutpaneel (gecontroleerd met een vervangen module). Dat is geen regressie van
deze branch: ook vóór `58739e0` werd `__onActivate()` synchroon in `mount` aangeroepen en
propageerde een throw ongevangen. Het valt buiten de drie bevindingen die deze commit adresseert
en ik reken het hier niet mee.

## Samenvatting

- **Opgelost en geverifieerd:** de medium-bevinding, de dedupe, de loading-state, de README, en
  het ontbreken van een gecommitte test.
- **Aanpakken of de tekst bijstellen:** de retry-claim; die werkt niet door memoïsatie in de
  module map.
- **Goedkoop mee te nemen:** `console.error` op het superseded-pad, de onbereikbare tak op regel
  148, en `EXPECTED_PERSISTENT` als verzameling in plaats van telling.
- **Tekstueel:** de paint-claim en de niet-meegeleverde browserpas.


---

# Derde ronde — `705ae9a`

- Head: `refactor/plugin-registry` @ `705ae9a`
  (`fix(frontend): make the plugin retry real and pin the fields users see`;
  383 toegevoegd / 34 verwijderd over 5 bestanden)
- Uitgevoerd: de diff gelezen; `node --test`; de mutatieset uit de tweede ronde opnieuw gedraaid,
  inclusief de vijf die toen doorglipten; het meegeleverde browserscript end-to-end gedraaid; de
  retry, de consolelogging en het gedrag bij herhaald falen apart nagemeten met de async
  Playwright-API; de 20 view-entrypoints nagelopen op modulescope-state; de Python-suite opnieuw
  gedraaid
- Werkkopie schoon na afloop; alle mutaties teruggedraaid, alle gestarte servers gestopt

**Verdict derde ronde: approve.**

## Wat deze commit doet

Alle vier de nits uit de tweede ronde, plus twee toezeggingen:

| nit tweede ronde | status |
| --- | --- |
| retry-claim klopt niet (module map memoïseert) | opgelost, echt werkend gemaakt |
| onbereikbare tak in `obtainView()` | verwijderd |
| fout na generatiewissel verdwijnt spoorloos | beide takken loggen nu |
| `EXPECTED_PERSISTENT` is een telling, niet een verzameling | vervangen door een pin per view |
| paint-claim te stellig | commentaar bijgesteld, en erkend in de commit message |
| browserpas niet meegeleverd | gecommit als `tests/browser/check_plugin_registry.py` |

De retry werkt via een cache-buster: `loadView()` neemt een teller mee en zet `?retry=<n>` op de
module-URL (`static/src/plugins/registry.js:71-81`), zodat de browser niet zijn gememoïseerde
mislukking teruggeeft maar een echte request doet. `failedLoads` wordt opgehoogd in een `.catch`
die de fout doorgooit (`static/app.js:155-159`).

De historie is bewust intact gelaten, zodat de reviewdocumenten die naar `a9939ed` verwijzen
blijven kloppen. Dat is de juiste keuze.

## Verificatie

| controle | resultaat |
| --- | --- |
| `node --test 'tests/js/**/*.test.mjs'` | 6 pass, 0 fail |
| `./.venv/bin/python tests/browser/check_plugin_registry.py` | exit 0, groen, server opgeruimd |
| `./.venv/bin/python -m pytest tests` | 116 passed, 5 failed — dezelfde vijf replay-failures |

Mutatietest opnieuw gedraaid. De vijf die in de tweede ronde doorglipten, falen nu allemaal, en de
gevoeligheid van toen is behouden:

| mutatie | tweede ronde | nu |
| --- | --- | --- |
| icoon geruild tussen twee views | past ✗ | **faalt** ✓ |
| tooltip verwijderd | past ✗ | **faalt** ✓ |
| sidebarnaam gewijzigd | past ✗ | **faalt** ✓ |
| view-`id` hernoemd, route gelijk | past ✗ | **faalt** ✓ |
| `persistent` geruild, som blijft 19 | past ✗ | **faalt** ✓ |
| factory hernoemd | faalt ✓ | **faalt** ✓ |
| modulepad kapot | faalt ✓ | **faalt** ✓ |

De retry is gemeten, niet aangenomen. Bij vier bezoeken aan een route die blijft falen:

```
opgehaalde urls: ['index.js', 'index.js?retry=1', 'index.js?retry=2', 'index.js?retry=3']
```

Elke poging is een echte request. Een geslaagde retry op een persistente view herstelt, en de view
werkt daarna normaal uit de cache (twee keer heen en weer nagelopen: één view in de host, geen
foutpaneel).

De techniek dupliceert per definitie de module-instantie, want een andere URL is een ander
module-record. Dat is hier onschadelijk: geen van de 20 view-entrypoints heeft top-level `let`/`var`,
`import.meta` of aanroepen op modulescope, en hun statische imports houden hun onquerierde
specifier, dus gedeelde modules onder `src/shared/` en `src/api-client.js` worden niet gedupliceerd.
Dat is een eigenschap van de huidige views, niet iets dat de loader afdwingt — het is het soort ding
dat stilletjes onwaar wordt als een view ooit een modulescope-singleton krijgt.

Het meegeleverde browserscript is bruikbaar zoals het is: het kiest zelf een vrije poort, start
uvicorn, dekt deep-link, sidebarstructuur, alle 20 routes, de vier aliassen inclusief het niet
herschrijven van de URL, persistentie en het tegendeel daarvan, themawissel, placeholder,
foutpaneel en de retry, en stopt de server in een `finally`. Het verzamelt problemen in plaats van
te stoppen bij de eerste, en eindigt met een exitcode. Bewust geen pytest-test, en dat staat er ook.

## Bevindingen

### Nit — `console.error` op het succespad is ruis

`static/app.js:196-199`. Wegklikken terwijl een koude module nog onderweg is, is normaal gedrag,
geen fout. Gemeten logt dat nu:

```
Workflow pdf-anatomy: discarded a view that loaded after navigation.
```

op error-niveau. Dit is mijn eigen fout in de tweede ronde: daar staat "een `console.error` in
beide `generation !== mountGeneration`-takken", en dat was te breed. Op de faaltak hoort
`console.error`; op de succestak hooguit `console.debug`, of niets.

### Nit — een permanent kapotte route downloadt zijn module bij elk bezoek opnieuw

`static/app.js:155-159`. `failedLoads` wordt opgehoogd bij elke rejection, dus ook wanneer de
module prima laadt maar de factory-export ontbreekt — precies de hernoemcasus waar het foutpaneel
voor bedoeld is. Gemeten over drie bezoeken aan zo'n route: `index.js`, `?retry=1`, `?retry=2`.
Een nieuwe fetch kan die fout per definitie niet oplossen, want er is niets mis met het netwerk.
De teller alleen ophogen als de `import()` zelf faalde, en niet als de factory-lookup faalt,
scheidt de twee gevallen.

### Nit — dubbele controle op `persistent` in de suite

`tests/js/plugin-registry.test.mjs:99-104` beweert dat de persistente verzameling gelijk is aan
"alle views behalve `icons`", afgeleid uit `WORKFLOWS` zelf. Sinds `EXPECTED_CATEGORIES` de vlag
per view vastpint, is dat een regelcontrole bovenop een pin. Hij dwingt een tweede bewerking af
zodra er ooit een niet-persistente view bijkomt, zonder extra dekking te geven.

## Oordeel over landen op `main`

**Ja, dit mag landen.**

- `main` staat nog op `68e720c` en is gelijk aan `origin/main`; `main` is voorouder van `HEAD`, dus
  het is een schone fast-forward. `git merge-tree` geeft nul conflicten.
- De volledige branchdiff is 16 bestanden. Buiten de frontend raakt hij alleen `README.md`, twee
  reviewdocumenten en twee testbestanden. Geen `.py` in `app/`, geen view-module, geen backend.
- De Python-suite is onveranderd ten opzichte van `main`: 116 passed en dezelfde vijf bestaande
  replay-failures, op beide kanten uitgevoerd.
- Geen achtergebleven `console.log`, `debugger`, `TODO` of `FIXME` in de gewijzigde frontend- en
  testbestanden.
- De drie resterende nits zijn alle drie cosmetisch of diagnostisch. Geen ervan verandert wat de
  gebruiker ziet bij normaal gebruik, en geen ervan is een regressie ten opzichte van `main`.

Twee dingen om bewust te beslissen vóór de merge, geen van beide blokkerend:

1. `2e2ed93` zet een reviewprompt in `docs/reviews/`. Daar is precedent voor
   (`pr-2-pdf-vector-fallback-option-prompt.md`), dus consistent — maar het is een procesartefact,
   geen projectdocumentatie. Als dat niet op `main` hoort, is dit het moment.
2. Dit document is nog untracked. `docs/reviews/refactor-plugin-registry.md` is wél meegecommit in
   `2e2ed93`; deze twee reviewrondes horen er dan bij.

Aanbeveling: de `console.error` op het succespad naar `console.debug` brengen vóór de merge — dat
is één regel en het voorkomt dat een normale navigatie als fout in de console en in eventuele
error-reporting terechtkomt. De andere twee nits kunnen als losse follow-up.
