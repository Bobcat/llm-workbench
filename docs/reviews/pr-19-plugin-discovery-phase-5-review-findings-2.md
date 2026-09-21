# Review PR #19 — plugin-architectuur fase 5, ronde 2

- Branch: `feature/plugin-discovery-phase-5` @ `86226a0`, verwerking in `1345e6d`, tegen `main` @
  `06112cd`
- Ronde 1 staat in `docs/reviews/pr-19-plugin-discovery-phase-5-review-findings-1.md` en eindigde op
  *approve with nits*
- Uitgevoerd: de metingen uit ronde 1 herhaald tegen `_checked_asset_path` en in de browser; zeven
  codeervarianten geprobeerd; de importcontrole getoetst in beide richtingen met **echte pakketten
  met `dist-info` op `PYTHONPATH`**; de cache-fix met drie opeenvolgende aanroepen; de volledige
  verificatie tegen `main`
- Werkkopie schoon na afloop; alle testpakketten opgeruimd, geen servers blijven draaien

**Verdict: approve with nits.**

De plain `..` is dicht, `styles` wordt gevalideerd en de cache-fix is volledig. Wat overblijft is
scherper dan ronde 1: de grens is nog te omzeilen met een andere codering, en de importcontrole is
tegelijk te krap en te ruim — een legitiem pakket maakt twee toetsen rood, terwijl de sprong die de
controle moet vangen er langs een andere weg doorheen komt.

## Zijn de drie punten uit ronde 1 dicht?

| punt | status |
| --- | --- |
| `..` in `module`, `icon`, `styles` | **dicht voor de vorm die ik toen mat**, open voor twee andere coderingen — bevinding 1 |
| de sprong laat regel 2 ontsnappen | **dicht voor relatieve imports**, open voor absolute — bevinding 2 |
| `styles` niet gevalideerd | **dicht** |
| `_DISCOVERED` vóór de botsingscontrole | **dicht**, drie aanroepen op rij gooien alle drie |

Mijn metingen uit ronde 1, opnieuw gedraaid tegen `_checked_asset_path`:

```
True   plugin-static/mine/x.js
False  plugin-static/mine/../../secret.js
False  /plugin-static/mine/x.js
False  //evil.example/x.css
False  https://evil.example/x.css
False  plugin-static/mine//../../secret.js
```

Ook de protocol-relatieve `//evil.example/…` wordt geweigerd, en dat is de gevaarlijkste van het
stel — die zou naar een andere origin wijzen. En een uitgezette plugin levert geen stylesheet: de
payload bevat hem niet eens, dus `applyPluginStyles` krijgt hem nooit te zien (gemeten met
`plugins.enabled: ["image-pool"]` en een pakket erbij: `styles` in de payload is `[[]]`).

## Bevindingen

### Laag — de mountgrens is nog te omzeilen, met een andere codering

`_checked_asset_path` normaliseert met `posixpath.normpath` en zoekt daarna naar een letterlijk
`..`-segment. De browser normaliseert méér dan posixpath: hij decodeert `%2e` en behandelt een
backslash als separator. Gemeten met `new URL(value, 'http://host/app/')`:

| waarde | URL-resultaat | `_checked_asset_path` |
| --- | --- | --- |
| `plugin-static/mine/../../secret.js` | `/app/secret.js` | `False` ✓ |
| `plugin-static/mine/%2e%2e/%2e%2e/secret.js` | `/app/secret.js` | **`True`** |
| `plugin-static/mine/%2E%2E/%2E%2E/secret.js` | `/app/secret.js` | **`True`** |
| `plugin-static/mine/..\..\secret.js` | `/app/secret.js` | **`True`** |
| `plugin-static/mine/..%2f..%2fsecret.js` | blijft in de mount | `True` (terecht) |

En `_validate_package` accepteert ze ook echt, voor `module` én voor `styles`. Het icoon ontsnapt
eraan, maar per ongeluk: `PLUGIN_ICON_PATTERN` heeft geen `%` en geen `\` in zijn karakterklasse,
dus die waarden vallen terug op `checkedIconName` en gooien.

De frontendwacht `value.split('/').includes('..')` in `applyPluginStyles` heeft dezelfde blinde
vlek, en `module` heeft aan de voorkant helemaal geen wacht — daar is de core de enige controle.

Binnen de first-party-grens is dit geen lek: `//evil.example` wordt geweigerd, dus je blijft op de
eigen origin. Maar het is precies de eigenschap die deze fix claimt te sluiten. De reparatie die
alle coderingen in één keer afdekt, is niet nog twee patronen toevoegen maar de **opgeloste** URL
vergelijken in plaats van de ruwe string: resolveer tegen een synthetische basis met dezelfde
semantiek als de browser, en kijk of het resultaat nog onder `plugin-static/<id>/` valt. Dan doet
posixpath niet meer het werk dat de URL-parser moet doen.

### Laag/medium — de importcontrole is tegelijk te krap en te ruim

Ik heb dit met echte pakketten getoetst, niet met fixtures.

**Te krap.** Een volkomen legitiem pakket — eigen views, eigen router, alleen relatieve imports —
maakt twee toetsen rood:

```
FAILED  ViewFileTests::test_no_view_imports_outside_its_own_plugin
FAILED  CoreMountTests::test_the_mounted_api_holds_nothing_else      (zie bevinding 3)
```

De eerste komt doordat de client van het pakket `../../src/shared/api/request.js` importeert — de
enige relatieve weg naar de fetch-helper van de core, en precies wat fase 4 voorschrijft. In de
browser klopt dat pad (`/plugin-static/demo/../../src/shared/api/request.js` → `/src/shared/api/…`,
geserveerd); op schijf wijst het buiten het pakket, dus `_imports_leaving_plugin` meldt het als
overtreding.

**Te ruim.** De regex leest alleen relatieve specifiers
(`from\s*['"](\.[^'"]+)['"]`). De absolute vorm ontsnapt volledig. Een pakket-view met

```js
import { api } from './api.js';
import { api as borrowed } from '/src/plugins/llm-pool/api.js';
```

levert in de analyse:

```
_api_paths              -> ['/api/demo/ping', '/api/demo/pong']
_imports_leaving_plugin -> GEEN MELDING
_client_owners          -> {'demo'}
```

en in Chromium: de view mount, geen fouten, en `borrowed` heeft vijf methoden van llm-pool. Regel 2
is dus nog steeds te ontlopen, nu langs een pad dat de controle niet leest.

De twee kanten zijn één probleem: **een pakket heeft geen gesanctioneerde manier om de core te
importeren.** De relatieve vorm wordt gemeld, de absolute vorm wordt niet gezien. Eén regel lost
beide op — bijvoorbeeld: de core is bereikbaar via een vaste, absolute specifier (`/src/shared/…`),
die de controle expliciet toestaat en die daarmee ook meteen de absolute vorm leesbaar maakt voor
de analyse. Wat er nu staat, dwingt een pakketauteur naar de vorm die niet gecontroleerd wordt.

### Laag — een pakket met eigen adressen maakt `CoreMountTests` rood

`test_the_mounted_api_holds_nothing_else` eist dat de gemounte `/api`-verzameling exact gelijk is
aan wat de modules onder `app/` definiëren. Een router uit een pakket staat per definitie niet onder
`app/`. Gemeten, met hetzelfde legitieme pakket:

| pakket | uitkomst |
| --- | --- |
| mét een eigen router | `CoreMountTests` **faalt** |
| zonder router, wel views | `CoreMountTests` **slaagt** (3 passed) |

Dat is geen randgeval: "een plugin mag zijn eigen adressen meebrengen" is de kernbelofte van deze
fase, en de invariant zoals hij er staat spreekt hem tegen. De spiegeltoets moet de routers van
gevonden pakketten meenemen in `defined`, net zoals `iter_views()` elders al naar `all_plugins()` is
verhuisd. Dit is het eerste dat iemand tegenkomt die een plugin installeert en de suite draait.

### Nit — `plugin.id` wordt niet op vorm gecontroleerd

```
'mine'          GEACCEPTEERD
'mine/../other' geweigerd   (indirect: de module-prefix matcht niet meer)
'../escape'     geweigerd   (idem)
'MiXeD Case'    GEACCEPTEERD  -> mount wordt /plugin-static/MiXeD Case
```

Een id met een slash wordt dus bij toeval gevangen, niet door een regel. Een id met hoofdletters of
een spatie komt erdoor, en dan botst de backend met de voorkant: `PLUGIN_ICON_PATTERN` eist
`[a-z0-9-]+` voor het id-deel, dus een pad-icoon van zo'n plugin matcht nooit, valt terug op
`checkedIconName` en **gooit** — waarmee `pluginItemMarkup` en dus `renderWorkflows` omvallen en de
hele sidebar leeg blijft. Een id-patroon dat hetzelfde zegt als het frontendpatroon sluit dat.

### Observatie, geen bevinding

`EndToEndDiscoveryTests::test_without_packages_the_menu_is_the_registry` faalt als er werkelijk een
pakket in de omgeving geïnstalleerd is. Dat is een toets die een schone omgeving veronderstelt, en
dat is een redelijke aanname.

## Is de cache-fix volledig?

Ja. Drie aanroepen op rij na een botsing:

```
poging 1: ValueError: duplicate plugin id: llm-pool
poging 2: ValueError: duplicate plugin id: llm-pool
poging 3: ValueError: duplicate plugin id: llm-pool
```

En er blijft nergens anders iets half achter: `discovered_packages()` gooit als geheel vóór het
terugkeert, dus de mountlus in `app/main.py` begint niet eens als de tweede plugin in de rij faalt.
Er is geen half gemounte map mogelijk.

## Is er iets nieuws stukgegaan?

Nee, niet in de ingebouwde configuratie.

| controle | resultaat |
| --- | --- |
| `pytest` | 182 passed, 5 failed (de bekende replay-failures) |
| `node --test` | 4 pass |
| browsercheck | exit 0 |
| documenttoets (regelverwijzingen) | 2 passed |
| routes vs `main` | identiek, 121 |
| payload vs `main` | identiek op de `styles`-sleutel na |

## Samenvatting

- Drie van de vier punten uit ronde 1 zijn dicht; `..` is dicht voor de vorm die ik toen mat en open
  voor procent-codering en backslashes.
- Vóór het eerste pakket in gebruik gaat: `CoreMountTests` de routers van gevonden pakketten laten
  meetellen, want nu maakt een legitiem pakket de suite rood.
- Beslis hoe een pakket de core importeert. Nu wordt de relatieve vorm gemeld en de absolute niet
  gezien, dus de auteur wordt naar de ongecontroleerde vorm geduwd.
- Vergelijk de opgeloste URL in plaats van de ruwe string, dan is de coderingsvraag in één keer weg.
- Klein: een vormcontrole op `plugin.id`, gelijk aan wat de voorkant al eist.
