# Review PR #16 — plugin-architectuur fase 2

- Branch: `feature/plugin-registry-phase-2` @ `b882151`, tegen `main` @ `435d00b`
- Kern van de PR: `075dc62` (`app/plugins.py` als bron van waarheid) en `02a96de` (documentatie);
  `8d73503` en `d67a260` zijn in de vorige ronde al beoordeeld
- Uitgevoerd: de drie suites gedraaid; het API-oppervlak en de mountvolgorde onafhankelijk
  vergeleken met `main`; beide toetsen met mutaties op scherp gezet; de faalmodi van `/plugins.js`
  in Chromium nagespeeld; de per-view routerkoppeling doorgerekend; elke regelverwijzing in het
  ontwerpdocument nagetrokken
- Werkkopie schoon na afloop; alle mutaties teruggedraaid

**Verdict: approve with nits.**

Het doel van fase 2 is gehaald en dat is aantoonbaar, niet beweerd. Beide toetsen leveren bewijs,
geen vorm — dat is met mutaties vastgesteld. De nits zijn één inhoudelijke (de per-view
routerkoppeling belooft meer dan ze waarmaakt en is niet toetsbaar), één ontbrekend oppervlak
(websockets), één faalmodus die stil is voor de gebruiker, en twee getallen in de documentatie.

## Is het doel gehaald?

Ja, en het bewijs komt uit de onafhankelijke toets, niet uit de declaratie.

**Het API-oppervlak is niet veranderd.** Zelf gemeten door `app.main.app` op beide kanten te
importeren (met expliciete `PYTHONPATH`, omdat `python script.py` de scriptmap op `sys.path` zet
en niet de cwd — mijn eerste meting was daardoor ongeldig en is overgedaan):

| | `main` | branch |
| --- | --- | --- |
| `/api` route-objecten | 113 | 113, **identieke verzameling** |
| unieke `/api` paden | 103 | 103 |
| routes totaal | 119 | 120 |
| nieuw | — | alleen `GET /plugins.js` |

**De mountvolgorde is veranderd, maar gedragsneutraal.** `iter_routers()` levert een andere
volgorde dan de zestien handgeschreven regels (`/replay` eerst in plaats van `/models`). Dat
maakt alleen uit als een eerdere route een latere afschermt, dus heb ik per route een concrete URL
gegenereerd en met Starlette's eigen `matches()` bepaald welke route als eerste vol matcht — op
beide kanten, 113 (methode, URL)-combinaties: **nul verschillen**. De enige prefixoverlap
(`/image-pool` tegen `/image-pool/loras` en `/image-pool/training`) houdt bovendien dezelfde
onderlinge volgorde als voorheen.

**De acht manifesten zijn weg** en nergens meer naar verwezen; `static/src/plugins/` bevat alleen
nog `registry.js`. Er is geen tweede kopie van de sidebar achtergebleven: de enige plekken die
sidebar-labels bevatten zijn `app/plugins.py` (de bron) en `tests/test_plugin_registry.py` (de
bewuste pin). De iconengalerij in `static/src/workflows/icons/index.js` bevat overlappende labels,
maar is een andere lijst — hij noemt ook iconen die geen view zijn (`pool-asr`) en bestond al vóór
deze PR.

| suite | resultaat |
| --- | --- |
| `pytest` op de branch | 137 passed, 5 failed |
| `pytest` op `main` (losse worktree) | 120 passed, 5 failed — **dezelfde vijf** |
| `node --test 'tests/js/**/*.test.mjs'` | 4 pass, 0 fail |
| `tests/browser/check_plugin_registry.py` | exit 0, groen |

De vijf failures zijn de bestaande `tests/test_replay_api.py`-gevallen, op beide kanten
uitgevoerd. Deze PR voegt 17 tests toe en raakt geen `.py` buiten `app/plugins.py`,
`app/router.py` en `app/main.py`.

## Leveren de twee toetsen bewijs of alleen vorm?

Bewijs — met één gat. Elke mutatie is aangebracht, de suite gedraaid, en teruggedraaid.

### De onafhankelijke toets

| mutatie | uitkomst |
| --- | --- |
| router weg bij een view met één router (`chat`) | **faalt** — invariant én padcontrole |
| router overal weg uit de registratie (`chat`) | **faalt** — padcontrole en backend-loos-controle |
| de mountlus uitgeschakeld (niets gemount) | **faalt** — drie tests |
| `backend=False` op een view die wél de API belt | **faalt** — twee tests |
| **verkeerde router bij een view** (`pdf-anatomy` → `chat_router`) | **past — gat** |

De vierde regel is de bevinding hieronder. De rest laat zien dat de toets echt aan de gemounte app
meet en niet aan de declaratie: `test_views_call_only_known_methods_and_served_paths` leest
`api.<methode>()`-namen uit de eigen bestanden van de view, zoekt het pad op in `api-client.js` en
controleert dat tegen `app.routes`. `view.routers` komt er niet aan te pas. Dat is precies de
onafhankelijkheid die de vorige ronde vroeg.

De ingebouwde rookproef `test_views_with_a_backend_reach_at_least_two_endpoints` verdient een
aparte vermelding: die vangt af dat de analyse stilletjes niets vindt, wat in de vorige ronde mijn
bezwaar tegen de eerst voorgestelde vorm was. Gemeten liggen de werkelijke aantallen ruim boven de
drempel (2 tot 15 paden per view), dus de marge is echt.

### De handgeschreven pin

`EXPECTED_SIDEBAR` is met de hand geschreven en wordt tegen `PLUGINS` gelegd; hij leidt niets af
uit `app.plugins`. Vijf mutaties, vijf keer rood:

| mutatie | uitkomst |
| --- | --- |
| sidebar-naam gewijzigd | **faalt** |
| icoon geruild tussen twee views | **faalt** |
| tooltip verwijderd | **faalt** |
| `persistent` omgezet | **faalt** |
| alias verwijderd | **faalt** (twee tests) |

Geen echo.

## Bevindingen

### Medium — de per-view routerkoppeling belooft meer dan ze waarmaakt, en is niet toetsbaar

Twee dingen die samen één probleem vormen.

**Ze is niet toetsbaar.** Vervang bij `pdf-anatomy` de router `pdf_regression_router` door
`chat_router` en de hele suite blijft groen. Dat kan omdat `pdf_regression_router` via
`pdf-translation-regression` toch gemount blijft, `chat_router` ook gemount is, en de
onafhankelijke toets tegen de *gemounte app* meet. De verificatie is dus effectief globaal: de
unie van alle gedeclareerde routers moet alle aangeroepen paden bedienen. Precies het
granulariteitsargument waarmee het ontwerpdocument een toets per plugin afwees, geldt hier één
niveau lager.

**En ze is onvolledig.** Ik heb de strengere variant doorgerekend — bedienen de routers die een
view zélf declareert alle paden die die view aanroept? Voor **9 van de 19** views met backend niet:

| view | paden | niet gedekt door eigen routers |
| --- | --- | --- |
| `pdf-translation` | 12 | 7 (`/api/pdf-benchmark/run`, `/api/pdf-regression/*`, `/api/translation/status`, `/api/models/admin`) |
| `prompt-library` | 4 | 3 (`/api/translation/prompts*`, `/api/models/admin`) |
| `replay-translate` | 15 | 2 (`/api/models`, `/api/translation/prompts`) |
| `chat`, `text-generation`, `image-translation` | 2-12 | elk `/api/models/admin` |
| `image-train` | 9 | `/api/models` |
| `image-generation` | 4 | `/api/image-pool/loras` |
| `replay-speak` | 7 | `/api/tts-pool/models/admin` |

`app/plugins.py:11-12` zegt: *"`routers` on a view is the backend the view itself is served by"*,
en het ontwerpdocument zegt *"per view de routers die hem bedienen"*. Voor deze negen views klopt
dat niet: het veld noteert de router die bij de view *hoort*, niet de routers die hem *bedienen*.

Sectie 4 van het ontwerpdocument noemt dit verschijnsel wel — *"Een view mag endpoints van een
andere plugin gebruiken"* met `image-train` als voorbeeld — maar met één voorbeeld, terwijl het om
negen views en zo'n veertien ongedeclareerde afhankelijkheden gaat. Dat is geen detail meer maar
het normale geval.

Waar het uitkomt is fase 3. Zet je LLM Pool uit, dan verdwijnt `llm_pool_router` en verliezen
`replay-translate`, `image-train`, `image-translation`, `pdf-translation`, `prompt-library` en
`chat` een stuk backend — views in vier andere plugins. Niets in de huidige registratie legt dat
vast en geen test voorspelt het.

Belangrijk voor de weging: dit maakt fase 2 niet onjuist. Het doel "geen view zonder zijn backend"
wordt gehaald, alleen niet door de declaratie maar door de onafhankelijke padcontrole. De
declaratie is het mountmechanisme. Twee richtingen, beide klein: de tekst bijstellen naar wat het
veld werkelijk is, of de koppeling completeren en de padcontrole per view tegen `view.routers`
laten lopen in plaats van tegen de gemounte app. Het tweede sluit meteen het mutatiegat.

### Laag — het websocket-oppervlak valt buiten de registratie

`/ws/replay/{session_id}` en `/ws/replay-speak/{session_id}` staan met de hand in
`app/main.py:44-51` en komen in `app/plugins.py` niet voor. `_api_object_source()`
(`tests/test_plugin_registry.py:107`) sluit de websocket-klassen expliciet uit van de
methodetabel, dus de onafhankelijke toets kijkt er langs.

Twee views hangen eraan: `replay/session-controls.js:119` gebruikt `ReplayWebSocket` en
`replay-speak/index.js:227` gebruikt `ReplaySpeakWebSocket`; de paden staan in
`api-client.js:702` en `:740`. Haal een van die endpoints weg en geen enkele plugin-test merkt
het, terwijl de view stuk is. De claim dat routetabel en sidebar niet meer uit elkaar kunnen lopen
geldt dus voor het `/api`-oppervlak, niet voor het websocket-oppervlak. Dit staat niet in sectie 4.

### Laag — de lege sidebar bestaat nog steeds en is stil voor de gebruiker

De laadvolgorde zelf is in orde en gegarandeerd: een klassiek `<script src="plugins.js">` blokkeert
en draait vóór het `type="module"`-script, dat per specificatie uitgesteld is.
`test_index_loads_plugins_js_before_app_js` pint dat, en `Cache-Control: no-cache` staat er ook op.

Maar de faalmodus is niet afgedekt. Drie varianten nagespeeld in Chromium — request afgebroken,
404, en lege body — alle drie met hetzelfde resultaat:

```
sidebar-items=0  categorieën=0  host-kinderen=0
app-container zichtbaar='visible'   zichtbare tekst: 'Workbench\nDark theme'
console: PAGEERROR: Plugin list missing: globalThis.__LLM_WORKBENCH_PLUGINS__ is not set. …
```

De gebruiker krijgt een zichtbare, lege schil. De foutmelding in `registry.js:30-36` is uitstekend
— hij noemt de global, het bestand en wat je moet stubben — maar staat alleen in de console, omdat
`shell-booting` al is weggehaald door het inline script op `static/index.html:82`, vóór
`plugins.js` draait.

Dat is de moeite waard omdat het document de blokkerende `<script>` boven een fetch koos met het
argument dat een fetch *"alleen een lege-sidebar-toestand zou toevoegen om voor te ontwerpen"*
(`app/plugins.py:52-53` verwoordt het ook zo). Die toestand bestaat nu ook; hij is alleen
zeldzamer. `buildViewError` is in dezelfde codebase het precedent voor hoe je zoiets wél toont.

### Nit — twee verouderde regelverwijzingen, beide verschoven door deze PR

Alle overige verwijzingen kloppen exact nagemeten: de zes regels in de registry-exporttabel
(38, 42, 48, 52, 57, 67), `static/app.js:163`, `:207`, `:311`, `59-67`,
`app/image_pool/training.py:18` en `static/index.html:7-22`. Twee niet:

- `docs/plugin-architecture.md:114` — *"`WORKFLOWS_BY_ROUTE` (regel 58)"*; het staat op
  `registry.js:50`. Het document spreekt zichzelf hier tegen: sectie 4 noemt wél `registry.js:50`.
  De verschuiving komt doordat deze PR de acht manifest-imports uit `registry.js` haalde.
- `docs/plugin-architecture.md:136` — *"`app/main.py`, `RevalidatingStaticFiles`, regel 16"*; het
  is regel 17, opgeschoven door de nieuwe `from app.plugins import frontend_script` op regel 8.

### Nit — "alle 116 bestaande routes zijn identiek" klopt als bewering, niet als getal

De fase 2-sectie claimt dat het enige verschil in het API-oppervlak `GET /plugins.js` is en dat
*"alle 116 bestaande routes identiek zijn"*. Het eerste heb ik onafhankelijk bevestigd. Het getal
past bij geen enkele telling: 113 `/api` route-objecten, 103 unieke `/api`-paden, 119 routes
totaal op `main`.

## De acht gestelde vragen

1. **Doel gehaald, divergentiepad over?** Gehaald voor het `/api`-oppervlak, aantoonbaar. Eén pad
   blijft: de websockets (bevinding 2). En de per-view koppeling kan afwijken zonder dat iets het
   merkt (bevinding 1) — maar dat leidt vandaag niet tot divergentie tussen sidebar en routetabel,
   alleen tot een onjuiste administratie ervan.
2. **Is de tweede toets onafhankelijk?** Ja. Vier van vijf mutaties vallen om; hij meet aan
   `app.routes`, niet aan `view.routers`. Het vijfde geval staat in bevinding 1.
3. **Is de pin geen echo?** Nee, hij is echt handgeschreven; vijf van vijf mutaties vallen om.
4. **`/plugins.js`.** Laadorde gegarandeerd en gepind; registratie staat vóór de statische mount
   (`app/main.py:54` tegen `:69`), wat nodig is omdat de mount anders een gelijknamig bestand zou
   serveren; caching is `no-cache` en dat wordt getest. De foutmelding is goed maar bereikt de
   gebruiker niet — bevinding 3.
5. **JS-suite via subprocess.** Acceptabel, en te verkiezen boven een tweede kopie van de sidebar.
   De suite faalt hard als Python ontbreekt in plaats van stil over te slaan, probeert eerst
   `.venv/bin/python` en dan `python3`, en de README vermeldt de afhankelijkheid. Het maakt de
   suite wel breekbaarder voor wie alleen aan de frontend werkt, en gevoelig voor onverwachte
   stdout uit `app.plugins` — vandaag schoon. De prijs is de moeite waard.
6. **`backend=False` op de view.** Juiste plek: het is een eigenschap van de view, niet van de
   plugin, en het onderscheidt "vergeten" van "heeft er geen". De invariant zelf (waar ⇒ routers
   niet leeg, en omgekeerd) is **niet voldoende** — hij controleert dat het veld is ingevuld, niet
   dat het juist is ingevuld. Dat de suite dat opvangt, komt door de onafhankelijke padcontrole en
   door `test_the_backend_less_view_calls_nothing`, niet door de invariant.
7. **De router-lus.** De volgorde verschilt van de oude handmatige lijst, maar is aantoonbaar
   gelijkwaardig: elke aanvraag komt bij dezelfde route uit. De enige prefixoverlap behoudt haar
   onderlinge volgorde. Geen risico.
8. **Wat is er niet af?** Zie de drie bevindingen. De gatenlijst in sectie 4 is verder goed
   bijgewerkt — de opgeloste punten zijn doorgestreept in plaats van verwijderd, wat klopt — maar
   mist het websocket-oppervlak en onderschat de omvang van de cross-plugin-afhankelijkheden.

## Samenvatting

- Fase 2 doet wat het belooft, en voor het eerst in deze reeks is het bewijs meegeleverd in plaats
  van beschreven: beide toetsen overleven mutaties, het API-oppervlak is aantoonbaar ongewijzigd,
  en de mountvolgorde is aantoonbaar gedragsneutraal.
- Vóór fase 3: beslis wat `routers` betekent en maak de tekst of de data daarop kloppend. Zoals het
  er nu staat, is het de enige plek in deze architectuur die meer beweert dan ze waarmaakt — en
  fase 3 is precies waar dat gaat schuren.
- Klein en los: websockets in de registratie of expliciet erbuiten verklaren, de lege sidebar
  zichtbaar maken, en twee regelverwijzingen plus één getal corrigeren.
