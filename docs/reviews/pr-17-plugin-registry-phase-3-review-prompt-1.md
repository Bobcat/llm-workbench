# Reviewprompt PR #17 — plugin-architectuur fase 3

Review PR #17, branch `feature/plugin-registry-phase-3` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-17-plugin-registry-phase-3-review-findings-1.md`

## Context

Fase 3 van de plugin-architectuur, en tegelijk een correctie op fase 2. Fase 2 maakte
`app/plugins.py` de bron van waarheid voor zowel de sidebar als de routetabel: elke view declareerde
de routers die zijn endpoints bedienden. Die koppeling is nu weg. **De core bezit de adressen**:
`app/router.py` mount alle routers en `app/main.py` registreert beide websockets, altijd, ongeacht de
instellingen. Een plugin is alleen nog een menu-entry, en "uit" betekent dat de categorie niet in het
menu staat. Daardoor kan geen enkele categorie van een andere afhangen — in fase 2 verloor een view
buiten LLM Pool zijn modellenlijst zodra LLM Pool uit stond, terwijl die service gewoon draaide.

De branch bevat twee commits:

- `05e340a` — het ontwerpdocument herzien voor het core-model
- `d934215` — de eigenlijke fase 3: de core mount alles, `plugins.enabled` in de settings, tests

De fase-2-review (`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-4.md`) eindigde met
approve; de aanleiding voor dit model staat in sectie 1 en 5 van `docs/plugin-architecture.md`.

Lees eerst:

- `docs/plugin-architecture.md` (vooral sectie 1, 2 en de fase-3-sectie)
- `app/plugins.py` — de registratie en de schakelaar
- `app/router.py` en `app/main.py` — de core die alle adressen bezit
- `tests/test_plugin_registry.py`, `tests/js/plugin-registry.test.mjs` en
  `tests/browser/check_plugin_registry.py`
- `config/settings.json` en `README.md`

## Te beoordelen

1. **Is het doel gehaald?** Is er nog een pad waarlangs het uitzetten van een categorie een view in
   een andere categorie raakt? Zoek dat in de code en niet in de tests: adressen, imports, gedeelde
   helpers, `static/src/api-client.js`.
2. **Is de schakelaar de juiste vorm?** `plugins.enabled` is een lijst. Zonder die lijst staat alles
   aan, zodat een nieuwe categorie vanzelf verschijnt; met een lijst staat precies die lijst aan, in
   registryvolgorde. Een onbekend id of een lege lijst is een fout. Is dat de juiste afweging, en
   zijn de faalmodes acceptabel — een 500 op `/plugins.js` die het bestaande "pluginlijst kwam niet
   aan"-paneel op het scherm zet?
3. **Is `app/plugins.py` nog de bron van waarheid die het zegt te zijn?** De registratie levert nu
   alleen menu-inhoud. Controleer dat er nergens een tweede lijst van categorieën of adressen is
   achtergebleven, en dat de velden die fase 2 toevoegde (`routers`, `websockets`, `backend`)
   werkelijk overal weg zijn.
4. **Draagt de mount-toets?** `CoreMountTests` zoekt zelf elke module in `app/` met een module-level
   `router` en eist dat de core die mount. Bewijs met een mutatie dat die toets iets vangt: haal een
   `include_router` weg, en zet daarna een nieuwe routermodule neer die niemand mount. Als er niets
   omvalt, is dat een bevinding.
5. **Bewijst de toets per categorie de belofte?** `test_every_category_on_its_own_...` draait de
   padaanalyse met precies één categorie aan. Vangt die toets het scenario waarin een categorie een
   adres van een andere nodig heeft? Probeer het met een mutatie, en controleer dat de toets per
   categorie meet en niet op de union van alle views.
6. **De websockets.** Die staan nu met de hand in `app/main.py` in plaats van in de registratie. Is de
   dekking daarvan nog voldoende: de pin op de twee paden, plus de scan die de paden uit
   `api-client.js` haalt?
7. **Documentatie en code in dezelfde commit.** `docs/plugin-architecture.md` is herzien en de
   regelverwijzingen worden getoetst. Klopt het document nog met de code, en is de fase-3-sectie
   compleet genoeg om fase 4 op te bouwen?
8. **Wat is er niet af?** Noem wat fase 3 had moeten doen en niet gedaan heeft, en of de scopegrens in
   de fase-3-sectie (geen schakelaar per view, geen eigen CSS of iconen, geen instellingenvenster,
   geen wijziging aan de services zelf) houdbaar is.

## Scopegrens

- **Fase 4 en 5 vallen buiten deze review.** Het opsplitsen van `api-client.js` en discovery buiten de
  repo zijn niet gebouwd en horen hier niet als ontbrekende functionaliteit gemeld te worden.
- **Het samenvoegen van de zes kopieën van `_load_json_object`/`_merge_json_objects` valt buiten deze
  review.** Dat is een eigen opruiming; `app/plugins.py` heeft er bewust een zevende kopie bij.
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand.** Ze falen ook op `main`, omdat
  de replay-prompts in de draaiende translation-services ontbreken. Controleer dat op beide kanten in
  plaats van het aan te nemen, maar reken ze deze PR niet aan.
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

Node is aanwezig (v24.21.0), Playwright met Chromium zit in `.venv`, en de JS-suite heeft Python nodig
omdat hij de pluginlijst daar ophaalt.

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

Controleer daarnaast zelfstandig:

- dat de gegenereerde `/plugins.js`-payload identiek is aan die op `main` — vergelijk hem als data,
  niet als tekst; deze PR hoort alleen de schakelaar en het eigenaarschap te veranderen;
- dat het API-oppervlak niet veranderd is: vergelijk de routes van `app.main.app` op deze branch met
  die op `main`, en verklaar elk verschil;
- dat `plugins.enabled` werkt met een echte `config/local.json`: zet alleen `image-pool` aan en
  controleer dat de sidebar één categorie toont, dat de workbench op `image-pool-models` landt, en
  dat die views `/api/models` nog steeds bereiken — dat adres is van de core, niet van LLM Pool.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel, in
`docs/reviews/pr-17-plugin-registry-phase-3-review-findings-1.md`. Beantwoord expliciet of het doel
van fase 3 gehaald is, of het core-model aantoonbaar is en niet alleen beweerd, en of de schakelaar
de juiste vorm heeft. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
