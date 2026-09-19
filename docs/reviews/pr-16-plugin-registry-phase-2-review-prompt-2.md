# Reviewprompt PR #16 — plugin-architectuur fase 2, ronde 2

Review PR #16, branch `feature/plugin-registry-phase-2` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-2.md`

## Context

Dit is de tweede ronde. Ronde 1 gaf **approve with nits** en staat in
`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-1.md`. De bevindingen zijn verwerkt in
`91c00ef`, bovenop de commit die je toen beoordeelde (`b882151`).

Wat er sinds ronde 1 is veranderd:

- **De per-view routerkoppeling is compleet.** `routers` op een view is nu elke router die een
  door die view aangeroepen endpoint bedient, inclusief routers van andere plugins. Negen views
  hadden een onvolledige lijst; die zijn aangevuld.
- **Er is een tweede padaanalyse bijgekomen** die de aangeroepen paden van een view tegen haar
  *eigen* declaratie meet, niet tegen de gemounte app. Dat is de toets die het mutatiegat uit ronde
  1 moest dichten.
- **De twee websockets komen uit de registratie.** Ze stonden met de hand in `app/main.py` en
  vielen daarmee buiten de claim dat routetabel en sidebar niet kunnen divergeren.
- **Een ontbrekende pluginlijst is nu zichtbaar.** `registry.js` gooit niet meer bij import maar
  exporteert `pluginLoadError`, en `app.js` toont die in de host.
- Twee regelverwijzingen en één getal in het ontwerpdocument zijn gecorrigeerd.

Lees eerst:

- `docs/reviews/pr-16-plugin-registry-phase-2-review-findings-1.md` — je eigen ronde 1
- `git show 91c00ef` — wat er met die bevindingen is gedaan
- `app/plugins.py`, `static/src/plugins/registry.js`, `static/app.js`
- `tests/test_plugin_registry.py`, `tests/js/plugin-registry.test.mjs`,
  `tests/browser/check_plugin_registry.py`
- `docs/plugin-architecture.md`, sectie 2 en de fase-2-sectie

## Te beoordelen

1. **Is bevinding 1 uit ronde 1 echt opgelost?** Herhaal je eigen mutatie: vervang bij
   `pdf-anatomy` de router door die van een andere view en kijk of er nu wél iets omvalt. Doe
   daarna het omgekeerde: haal een terecht gedeclareerde router weg en kijk of de toets ook dan
   faalt. Als een van beide nog door glipt, is dat een bevinding.
2. **Is de koppeling nu ook juist, niet alleen volledig?** Volledig betekent niet correct: een view
   kan een router declaren die ze niet nodig heeft. Bepaal of dat kwaad kan — voor de toets, en
   voor fase 3, waar de declaratie bepaalt wie wat verliest als een plugin uitgaat.
3. **De websockets.** Zijn ze nu volledig onderdeel van het contract? Klopt de registratie uit de
   registratie in plaats van uit `app/main.py`, dekt de toets het oppervlak dat de frontend
   werkelijk aanspreekt, en is er een faalmodus die nu wél of juist niet gedekt is?
4. **De zichtbare fout bij een ontbrekende pluginlijst.** Is de panel-weergave bruikbaar — leesbaar,
   in beide thema's, en niet te vinden door een gebruiker die niets van de architectuur weet? En
   klopt het dat `pluginLoadError` de juiste keuze is boven een throw bij import?
5. **Zijn de documentcorrecties juist?** Meet de regelverwijzingen opnieuw; deze ronde heeft ze
   opnieuw verschoven. Controleer ook of de beschrijving van `routers` en `websockets` in sectie 2
   klopt met wat de code doet.
6. **Wat is er niet af?** Noem wat deze ronde had moeten doen en niet gedaan heeft, en of de
   gatenlijst in sectie 4 nog compleet en juist geprioriteerd is.

## Scopegrens

- **Fase 3, 4 en 5 vallen buiten deze review.** Enable/disable, per-plugin assets, het opsplitsen
  van `api-client.js` en discovery buiten de repo zijn niet gebouwd.
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand.** Ze falen ook op `main`.
  Controleer dat op beide kanten, maar reken ze deze PR niet aan.
- **Bekende gaten uit sectie 4 zijn gegeven.** Beoordeel of de lijst compleet is, maar rapporteer
  ze niet als nieuwe bevindingen.
- Geen codewijzigingen: het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

Controleer daarnaast zelfstandig:

- dat het API-oppervlak nog steeds ongewijzigd is: vergelijk de routes van `app.main.app` op deze
  branch met die op `main`, en verklaar elk verschil;
- dat de twee websockets precies één keer geregistreerd staan en dat hun paden uit `app/plugins.py`
  komen en niet meer uit `app/main.py`;
- dat een ontbrekende pluginlijst in Chromium zichtbaar is: breek de request naar `/plugins.js` af
  en kijk wat de gebruiker ziet.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel, in
`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-2.md`. Beantwoord expliciet of de drie
bevindingen uit ronde 1 afdoende zijn opgelost. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
