# Review PR #16 — plugin-architectuur fase 2, ronde 3

- Branch: `feature/plugin-registry-phase-2` @ `edbf708`, tegen `main` @ `435d00b`
- Beoordeeld: `f1dec21` (`fix(plugins): answer the PR #16 review, round 2`), bovenop `1d853d3`
- Uitgevoerd: de drie suites; de vier gevraagde mutaties; de documenttoets gemuteerd op drie
  manieren, waaronder alle tien buurwissels in de exporttabel; de ankerheuristiek doorgerekend op
  specificiteit; beide spiegeltoetsen getoetst op vals-positieven; het API-oppervlak opnieuw
  vergeleken met `main`; het foutpaneel in Chromium bekeken
- Werkkopie schoon na afloop; mutaties teruggedraaid, worktree opgeruimd, geen servers blijven
  draaien

**Verdict: approve with nits.**

Alles uit ronde 2 is opgelost en nagemeten. De nieuwe bevindingen gaan niet over het product maar
over het controleapparaat: de documenttoets heeft één systematisch gat, en de padanalyse ziet
literale API-paden niet. Geen van beide blokkeert, en ik denk niet dat een vierde ronde nodig is —
het zijn kleine, zelf verifieerbare wijzigingen.

## Is alles uit ronde 2 weg?

Alles, en zelf nagemeten in plaats van op de commit message afgegaan.

| ronde 2 | status |
| --- | --- |
| declaratie maar in één richting getoetst | **opgelost** — zie de vier mutaties hieronder |
| `WORKFLOWS_BY_ROUTE` op regel 50 (was 54) | **opgelost** — document zegt `registry.js:53`, werkelijk 53 |
| `RevalidatingStaticFiles` op regel 17 (was 15) | **opgelost** — document zegt `app/main.py:15`, werkelijk 15 |
| "zes views buiten llm-pool" | **opgelost** — "Vijf views", met de vijf namen erbij |
| "vier andere plugins" | **opgelost** — "drie andere plugins" |
| payload-assertie noemt alleen `routers`/`backend` | **opgelost** — exacte sleutelverzameling op viewniveau |
| paneel geeft Node-advies | **opgelost** — zie hieronder |
| module-docstring wees `app/main.py` aan voor de routers | **opgelost** — wijst nu `app/router.py` aan, en `app/main.py` voor de sockets |
| "de enige routes buiten `/api`" | **opgelost** — "de enige **applicatieroutes** buiten `/api`" |
| testnaam beloofde een bedradingscontrole | **opgelost** — `test_the_registry_declares_the_expected_two_sockets`, met een docstring die zegt dat het een pin is |
| ontbrekende lege regel | **opgelost** |

De vier mutaties die de prompt vraagt, alle vier rood:

| mutatie | uitkomst |
| --- | --- |
| router weghalen (`chat`: `llm_pool_router` weg) | **faalt** |
| router verwisselen (`pdf-anatomy` → `chat_router`) | **faalt** |
| overbodige router toevoegen (`pdf-anatomy` + `video_pool_router`) | **faalt** |
| overbodige socket toevoegen (`replay-speak` krijgt `/ws/replay`) | **faalt** |

Het foutpaneel geeft nu bruikbaar advies. Gemeten met een afgebroken `/plugins.js`:

```
titel : 'Could not load the plugin list'
detail: 'Reload the page. If this keeps happening, check that the workbench server is running.

         Plugin list missing: globalThis.__LLM_WORKBENCH_PLUGINS__ is not set, so /plugins.js
         did not load or did not run.'
```

De handelingsregel staat boven, de technische regel eronder. Dat is de goede volgorde.

Ongewijzigd: `/api`-oppervlak identiek aan `main` (113 routes), buiten `/api` alleen `/plugins.js`
erbij. `pytest` 146 passed met dezelfde vijf bestaande replay-failures (op `main` in een losse
worktree gecontroleerd: 120 passed, dezelfde vijf). `node --test` 4/4. Browsercheck groen; de
sidebar komt uit de global (20 items, `window.__LLM_WORKBENCH_PLUGINS__` is een array).

## 1. Vangt de documenttoets echt?

Ja, voor de fout die drie rondes terugkwam. Gemuteerd:

| mutatie | uitkomst |
| --- | --- |
| `static/app.js:170` → `:5` | **faalt** |
| `static/app.js:214` → `:60` | **faalt** |
| `app/image_pool/training.py:18` → `:200` | **faalt** |
| `static/index.html:7-22` → `40-50` | **faalt** |
| exporttabel `loadView` 70 → 10 | **faalt** |
| exporttabel `PLUGINS` 41 → 70 | **faalt** |
| regelnummer voorbij het einde van het bestand | **faalt**, met een duidelijke melding |
| niet-bestaand bestand | **faalt** |
| `static/app.js:170` → `:169` | **faalt** |
| `static/app.js:170` → `:171` | past — de gedocumenteerde beperking |

De beperking in de docstring — een verschuiving binnen de span van hetzelfde symbool — is eerlijk
opgeschreven en acceptabel. Een verschuiving van de `if`-regel naar de aanroep eronder verandert
niets aan wat de lezer zoekt.

### Laag — de exporttabel accepteert elke buurrij

Dat is een tweede beperking, en die staat er niet. `_anchors` neemt de proza van de regel ervóór,
de regel zelf en de regel erná. In een tabel zijn dat de naburige rijen, dus hun symbolen worden
geldige ankers. Ik heb alle tien aangrenzende wissels geprobeerd:

```
PLUGINS        -> ROUTE_ALIASES    PAST      normalizeRoute -> WORKFLOWS       PAST
ROUTE_ALIASES  -> PLUGINS          PAST      normalizeRoute -> getWorkflow     PAST
ROUTE_ALIASES  -> WORKFLOWS        PAST      getWorkflow    -> normalizeRoute  PAST
WORKFLOWS      -> ROUTE_ALIASES    PAST      getWorkflow    -> loadView        PAST
WORKFLOWS      -> normalizeRoute   PAST      loadView       -> getWorkflow     PAST
```

Tien van de tien onopgemerkt. Dat raakt zes van de zeventien verwijzingen, en het is precies de
drift die een tabel krijgt: `registry.js` verschuift een paar regels en elke rij landt op de
buurman. De toets vangt wél een sprong naar niet-verwante code, dus hij is niet nutteloos — maar
voor de dichtste cluster verwijzingen in het bestand dat het vaakst verandert, is hij het zwakst.

De reparatie is één regel: voor een `DOC_TABLE_ROW`-match is het anker het symbool uit die rij
zelf, niet het ±1-venster. Ik heb gecontroleerd dat elk van de zes symbolen op zijn eigen
gedeclareerde regel staat, dus die striktere variant gaat vandaag groen.

## 3. Is de documenttoets onderhoudbaar?

Gedeeltelijk. De ankerheuristiek is bruikbaar maar varieert enorm in strengheid, en niets in de
toets maakt dat zichtbaar. Ik heb per verwijzing geteld hoeveel posities in het doelbestand een
anker zouden bevatten — dus hoeveel ruimte een verschuiving heeft voordat de toets iets zegt:

| docregel | verwijzing | posities die zouden slagen |
| --- | --- | --- |
| 173 | `static/index.html:7-22` | 51 van 78 — **65%** |
| 317 | `static/app.js:59-67` | 186 van 330 — **56%** |
| 106 | `registry.js:45` | 13% |
| 138 | `app/main.py:15` | 10% |
| 85 | `static/app.js:170` | 1,2% |
| 321 | `static/app.js:331` | 0,3% |
| 169 | `training.py:18` | 0,2% |

De twee zwakke zijn de verwijzingen met een meerregelige span, waar een breed venster samenvalt
met een generiek anker: regel 317 heeft `name`, `route` en `tooltip` als ankers, en die staan
overal in `app.js`. Daar constrained de toets vrijwel niets meer.

Dat is waar de eerste valse negatieve gaat vallen. De eerste valse **positieve** verwacht ik bij
`_anchors`: wie in de proza rond een verwijzing een backtick-term toevoegt die niet in de code
voorkomt, verandert niets — maar wie de enige specifieke term wegredigeert, laat een verwijzing
over met alleen generieke ankers, en dan is er stil niets meer over om op te vallen. Er is ook een
stille-overslagtak (`if not anchors: continue`, regel 45-46 van de test); vandaag heeft elke
verwijzing minstens één anker, dus die tak is nu onbereikbaar, maar hij slaat zonder melding over
in plaats van te klagen.

Het bredere punt: deze toets is een goede vangrail voor grove drift en een zwakke voor fijne. Dat
is genoeg voor het doel — hij had alle drie de fouten gevangen die ik met de hand vond — maar de
docstring beschrijft nu één beperking terwijl er drie zijn.

## 2. Zijn de spiegeltoetsen een fuik?

Vandaag niet: geen enkele van de 34 (view, router)-paren is overbodig, en de vier mutaties vallen
om. Maar ze kunnen iets juists afwijzen, langs twee wegen.

### Laag — literale API-paden zijn onzichtbaar voor de analyse, in beide richtingen

`_called_paths` leest alleen `api.<methode>()`-namen. Zes views bouwen daarnaast URL's met de hand:

```
replay-translate              /api/replay/${sessionId}/export
image-translation             /api/translation/requests/${...}
image-translation-regression  /api/translation/regression
pdf-translation               /api/pdf-translation/requests/${...}
pdf-translation-regression    /api/pdf-regression
pdf-testing                   /api/pdf-benchmark/runs/${...}
```

Twee gevolgen. **Voorwaarts** is er een blinde vlek: ik heb in `pdf-testing` het literale
`/api/pdf-benchmark/runs/` vervangen door `/api/nope/` en de hele suite blijft groen. Een view kan
dus een endpoint aanspreken dat nergens gemount is zonder dat "geen view zonder zijn backend" dat
merkt. Dat is dezelfde soort blinde vlek als de websockets waren vóór ronde 2, en het ontwerpdocument
claimt die dekking zonder de uitzondering te noemen.

**Achterwaarts** is het een latente vals-positieve: zou een view een router alleen nog via zo'n
literaal pad gebruiken, dan meldt `test_declared_routers_are_all_actually_used` een terechte
declaratie als overbodig. Vandaag gebeurt dat niet — geen router is uitsluitend via een literaal
pad te rechtvaardigen — maar het is een voetangel die met één refactor scherp komt te staan.

### Laag — de socket-spiegeltoets hangt aan een naamconventie in JS

`_socket_class_name` leidt uit `/ws/replay-speak/{session_id}` de klassenaam
`ReplaySpeakWebSocket` af en zoekt die in de view-bestanden. Dat koppelt de Python-registratie aan
een conventie die nergens wordt afgedwongen. Ik heb `ReplaySpeakWebSocket` consequent hernoemd naar
`ReplaySpeakSocket` in `api-client.js` en in de view — een legitieme refactor waarna de app blijft
werken — en `test_declared_sockets_are_actually_used` faalt, terwijl de declaratie ongewijzigd
juist is.

Met twee sockets is dat te overzien. Als de sockets ooit talrijker worden, is het pad-naar-klasse
raden de eerste plek die gaat kraken; de `ViewSocket` het symbool zelf laten dragen is robuuster
dan het uit het pad afleiden.

## 5. Wat is er niet af?

- De twee gaten hierboven: buurrijen in de exporttabel, en literale paden buiten de analyse.
- De gatenlijst in sectie 4 is verder compleet en goed geprioriteerd; de correcties uit ronde 2
  staan erin en de fase-3-vraag is expliciet benoemd. Wat er niet in staat is de literale-paden
  blinde vlek. Dat hoort er wel in, want het is een uitzondering op de centrale claim van fase 2 en
  niet op te merken zonder te meten.

## Samenvatting

- Ronde 2 is volledig verwerkt; elk punt nagemeten, geen enkele correctie is tegen de verkeerde
  revisie gedaan — dat was drie rondes lang het patroon en het is nu doorbroken.
- De documenttoets is de juiste zet geweest: hij vangt alle drie de fouten die ik eerder met de
  hand vond, plus randgevallen die ik niet had bedacht. Eén regel maakt hem ook bestand tegen
  buurrij-drift.
- De padanalyse dekt `api.<methode>()` maar niet handmatig gebouwde URL's. Sluiten of in sectie 4
  opschrijven; opschrijven is het minimum, want de claim is er nu ruimer dan de dekking.
- Geen vierde ronde nodig wat mij betreft: dit zijn kleine, lokale wijzigingen die met de bestaande
  suites te verifiëren zijn.
