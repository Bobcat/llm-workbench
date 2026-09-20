# Review PR #17 — plugin-architectuur fase 3

- Branch: `feature/plugin-registry-phase-3` @ `36f145e`, tegen `main` @ `895d16d`
- Beoordeeld: `05e340a` en `d934215`, plus de vier testcommits erna
- Uitgevoerd: de drie suites; het API-oppervlak en de `/plugins.js`-payload als data vergeleken met
  `main`; een echte `config/local.json` met alleen `image-pool` en daarmee de belofte in Chromium
  nagelopen; de drie faalmodi van `plugins.enabled`; deep links naar een uitgeschakelde route en
  naar een alias daarvan; mutaties op de mount-toets, de toets per categorie en de
  websocket-dekking; de hermeticiteitsclaim getoetst door alle drie de suites mét een `local.json`
  te draaien
- Werkkopie schoon na afloop; elke `config/local.json` die ik aanmaakte is opgeruimd, mutaties
  teruggedraaid, geen servers blijven draaien

**Verdict: approve with nits.**

Het doel van fase 3 is gehaald en het core-model is aantoonbaar, niet beweerd — ik heb de belofte
met een echte instelling in een echte browser nagelopen en hij houdt. De schakelaar heeft de juiste
vorm. Eén ding zou ik vóór de merge rechtzetten: bij een typefout wijst de foutmelding naar het
verkeerde bestand, en dat is precies het pad waarlangs iemand zich uit deze fout moet werken.

## Is het doel gehaald?

Ja, en op drie manieren onafhankelijk vastgesteld.

**Het API-oppervlak is onaangeroerd.** `/api` identiek aan `main` (113 routes), niets erbij, niets
eraf, ook niet buiten `/api`. De `/plugins.js`-payload is als data identiek aan die op `main` — deze
PR verandert dus werkelijk alleen het eigenaarschap en de schakelaar.

**De belofte werkt in de praktijk.** Met een echte `config/local.json` die alleen `image-pool`
aanzet:

```
categorieen : ['Image Pool']
routes      : ['image-pool-models', 'image-generation', 'image-lora-library', 'image-train']
landt op    : #image-pool-models   host-kinderen: 1   foutpaneel: False
fetch /api/models            -> 200
fetch /api/models/admin      -> 200
fetch /api/image-pool/models -> 200
```

`/api/models` is het adres dat in fase 2 verdween zodra LLM Pool uit stond, en waar vijf views
buiten LLM Pool op leunen. Het antwoordt nu gewoon met LLM Pool uit het menu. Dat is de hele reden
voor deze koerswijziging en het is hier aangetoond, niet afgeleid uit een test.

**Er is ook in de frontend geen kruisverband meer.** Gezocht in de code, niet in de tests: geen
enkele view navigeert naar de route van een andere view (`location.hash`, `router.navigate`), en
geen enkele view-map importeert uit een andere view-map. De enige gedeelde afhankelijkheden zijn
`src/shared/` en `api-client.js`, en die zijn van de core.

**Bladwijzers naar een uitgezette categorie landen netjes.** Getest met een deep link naar een
uitgeschakelde route én naar een alias daarvan:

| deep link | resultaat |
| --- | --- |
| `#chat` (categorie uit) | landt op `#image-pool-models`, hash herschreven, geen foutpaneel |
| `#ad-hoc-prompt` (alias van een uitgeschakelde view) | idem |

| suite | branch | `main` |
| --- | --- | --- |
| `pytest` | 154 passed, 5 failed, 8 subtests | 147 passed, 5 failed |
| `node --test` | 4 pass | — |
| browsercheck | exit 0, groen | — |

De vijf failures zijn de bestaande `tests/test_replay_api.py`-gevallen, op beide kanten uitgevoerd.

## Is het core-model afgedekt door de toetsen?

Ja. Elke mutatie aangebracht, suite gedraaid, teruggedraaid.

| mutatie | uitkomst |
| --- | --- |
| `include_router(chat_router)` weggehaald | **faalt** — 3 tests, waaronder de toets per categorie |
| nieuwe routermodule in `app/` die niemand mount | **faalt** — `test_every_router_module_is_mounted`, `test_the_mounted_api_holds_nothing_else` |
| één `@app.websocket` weggehaald | **faalt** — 2 tests |
| websocket-pad verkeerd gespeld | **faalt** — 2 tests |
| derde websocket die niemand gebruikt | **faalt** — de pin |

De websocketdekking is daarmee in alle drie de richtingen dicht: weg, verkeerd, en te veel. Dat is
meer dan de prompt veronderstelde; de pin op de twee paden doet hier het werk dat in fase 2 de
spiegeltoets deed.

**De hermeticiteitsclaim houdt.** Het document stelt dat een installatie die categorieën uitzet de
suites niet rood mag maken. Getoetst met een echte `config/local.json` die alles behalve
`image-pool` uitzet: `pytest` 154 passed, `node --test` 4/4, browsercheck exit 0 — identiek aan
zonder. Dat is een niet-vanzelfsprekende eigenschap en hij is waargemaakt.

## Is de schakelaar de juiste vorm?

Ja. Geen lijst betekent alles aan, dus een nieuwe categorie verschijnt vanzelf; wel een lijst
betekent precies die lijst, in registryvolgorde. Dat is de goede kant om op te falen voor een
werkbank die groeit.

De drie faalmodi doen wat het document zegt:

| `plugins.enabled` | `/plugins.js` | scherm |
| --- | --- | --- |
| onbekend id | 500 | paneel "Could not load the plugin list", 0 menu-items |
| lege lijst | 500 | idem |
| string in plaats van lijst | 500 | idem |

Hard falen is hier beter dan een stilzwijgend kortere menu: een typefout die eruitziet als een
werkende installatie is het ergste van de twee. Dat het bestaande paneel hergebruikt wordt is
verdedigbaar, en sectie 4 benoemt zelf al dat het paneel de instelling niet noemt en dat herladen
dan niet de oplossing is. Die eerlijkheid waardeer ik — maar zie de eerste bevinding.

## Bevindingen

### Laag/medium — de foutmelding wijst naar het verkeerde bestand

`app/plugins.py`, `enabled_plugins()`: de instellingen worden samengevoegd uit `settings_path` en
`local.json` ernaast, maar elke melding noemt `path`, dus altijd het **basisbestand**.

```
A. typefout in settings.json      -> plugins.enabled in <dir>/settings.json names unknown categories: tikfout
B. typefout in local.json         -> plugins.enabled in <dir>/settings.json names unknown categories: tikfout
C. lege lijst in local.json       -> plugins.enabled in <dir>/settings.json is empty, ...
```

In B en C staat in `settings.json` gewoon `"plugins": {}` — geen lijst, geen typefout. De operator
wordt dus naar het ene bestand gestuurd waar niets mis is, terwijl de fout in het andere staat. En
`local.json` is nu juist de gedocumenteerde plek om categorieën uit te zetten: het staat zo in
sectie 3 van het ontwerpdocument en in de README.

Dat de serverlog de fout toont, klopt — nagemeten met een draaiende uvicorn:

```
ValueError: plugins.enabled in /home/gunnar/projects/llm-workbench/config/settings.json
            names unknown categories: tikfout
```

Het id klopt, het bestand niet. Sectie 4 claimt *"De serverlog noemt het foute id wel, met het
bestand erbij"* — die zin is voor de helft waar en dekt precies de helft die niet klopt toe.

Het is een kleine wijziging: onthoud uit welke van de twee bestanden `plugins.enabled` uiteindelijk
kwam en noem dat in de melding. Ik zou het vóór de merge doen, omdat dit de enige uitleg is die een
operator in deze faalmodus krijgt en hij nu de verkeerde kant op wijst.

### Laag — de toets per categorie meet niet wat zijn naam belooft

`test_every_category_on_its_own_reaches_the_endpoints_its_views_call` zet per categorie de settings
om en controleert dat de payload precies die categorie bevat — dat deel is echt. Maar de
adrescontrole gebruikt `_app_paths()`, en dat leest de module-level `app`, die bij import één keer
is opgebouwd en niet van de instellingen afhangt. De gemounte verzameling is dus voor elke iteratie
dezelfde, en over de hele lus krijgt elke view precies één keer dezelfde controle — wat neerkomt op
één keer alle views nalopen.

Vacuüm is de toets niet: met `include_router(chat_router)` weggehaald valt hij wel degelijk om. Maar
wat hij aantoont is "elk adres dat een view aanroept is gemount", niet "de gemounte verzameling
verandert niet als je categorieën omzet". Die tweede uitspraak is de eigenlijke belofte van het
core-model, en die wordt gedragen door `CoreMountTests` — die naar de modules in `app/` kijkt in
plaats van naar de registratie. Dat is prima verdeeld; alleen suggereert de naam van deze toets een
isolatie die hij niet heeft.

### Nit — een hashwijziging tijdens de sessie laat de URL achter

Deep links worden correct herschreven, zoals hierboven gemeten. Maar wie tijdens de sessie
`#chat` in de adresbalk zet terwijl die categorie uit staat, houdt `#chat` in de balk terwijl de
view op `image-pool-models` blijft staan. Geen lege host, geen fout — alleen een adres dat iets
anders zegt dan het scherm toont, tot de volgende herlaadbeurt.

### Nit — `route_aliases()` wordt in productie niet gebruikt

`app/plugins.py` exporteert `route_aliases()` met een docstring over frontendgedrag, maar alleen
`tests/test_plugin_registry.py` roept hem aan: de browser bouwt zijn aliastabel uit de payload.
Als onderwerp van de pin is dat prima; de docstring beschrijft alleen gedrag dat ergens anders
gebeurt.

### Nit — ontbrekende lege regel

`tests/test_plugin_registry.py:500`: `class PluginSwitchTests` heeft één lege regel boven zich in
plaats van twee.

## Is `app/plugins.py` nog de bron van waarheid die het zegt te zijn?

Ja. `routers`, `websockets` en `backend` zijn werkelijk weg uit de registratie — wat er nog van
overblijft is proza in de module-docstring die uitlegt waaróm ze weg zijn. Er is geen tweede lijst
van categorieën of adressen achtergebleven: de enige plekken die categorienamen bevatten zijn
`app/plugins.py` zelf, `EXPECTED_SIDEBAR` in de Python-pin en `EXPECTED_CATEGORIES` in de
browsercheck, en dat zijn bewuste, handgeschreven kopieën met precies dat doel.

## Wat is er niet af?

Niets dat fase 3 had moeten doen. De scopegrens — geen instellingenvenster, geen schakelaar per
view, geen eigen CSS of iconen, geen wijziging aan de services — is houdbaar en intern consistent:
met "alleen hele categorieën" vervalt de regel "plugin-uit wint van view-aan" uit een eerdere
versie van het document, en dat is ook gebeurd.

De gatenlijst in sectie 4 is compleet en eerlijk. Hij noemt zelf de zevende kopie van de
settings-loader en het onduidelijke foutpaneel, allebei punten die ik anders had gemeld. De enige
aanvulling die ik zou doen is de misattributie hierboven, want die maakt het paneel-gat een slag
erger dan het er nu staat.

Voor fase 4 is de sectie compleet genoeg: het eigenaarschap van de adressen ligt vast, en daarmee
is het opsplitsen van `api-client.js` een frontend-oefening zonder gevolgen voor wie wat mount.

## Samenvatting

- Doel gehaald, core-model aantoonbaar: API-oppervlak en payload identiek aan `main`, en een
  werkbank met alleen Image Pool bereikt `/api/models` gewoon.
- Schakelaar heeft de juiste vorm en faalt hard op de juiste momenten.
- Vóór de merge: laat de melding het bestand noemen waar `plugins.enabled` echt vandaan kwam.
- Daarna los: de naam of de opzet van de toets per categorie, de hash die achterblijft,
  `route_aliases()`, en een lege regel.
