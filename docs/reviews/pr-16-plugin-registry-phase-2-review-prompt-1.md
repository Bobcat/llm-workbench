# Reviewprompt PR #16 — plugin-architectuur fase 2

Review PR #16, branch `feature/plugin-registry-phase-2` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-1.md`

## Context

Fase 2 van de plugin-architectuur. Tot nu toe stond de pluginlijst in acht JS-manifesten onder
`static/src/plugins/`; sinds deze PR is `app/plugins.py` de bron van waarheid. Daaruit komen twee
dingen voort: `app/router.py` mount de routers die erin genoemd staan, en FastAPI genereert
`/plugins.js` dat de sidebar in de browser voedt. De bedoeling is dat routetabel en sidebar niet
meer uit elkaar kunnen lopen.

De branch bevat vier commits:

- `8d73503` — de replay-view verlaat de shell, zodat `app.js` geen enkele view meer bij naam kent
- `d67a260` — de fase-2-beslissingen vastgelegd, inclusief de koppeling view → routers
- `075dc62` — de eigenlijke fase 2
- `02a96de` — ontwerpdocument en README bijgewerkt

Fase 1 en het ontwerp zijn inmiddels vier keer gereviewd; de uitkomsten staan in
`docs/reviews/refactor-plugin-registry.md`, `docs/reviews/plugin-registry-hardening.md` en
`docs/reviews/plugin-architecture-review.md`. De laatste ronde zei: fase 2 kan beginnen, na
herformulering van de tweede verificatiestap. Die herformulering zit in `d67a260` en is in
`075dc62` gebouwd.

Lees eerst:

- `docs/plugin-architecture.md` (vooral sectie 2 en de fase-2-sectie)
- `app/plugins.py` — de registratie zelf
- `app/router.py` en `app/main.py` — de twee afgeleiden
- `static/src/plugins/registry.js` en `static/index.html`
- `tests/test_plugin_registry.py` en `tests/js/plugin-registry.test.mjs`
- `tests/browser/check_plugin_registry.py`

## Te beoordelen

1. **Is het doel gehaald?** Loopt er nog een pad waarlangs de routetabel en de sidebar kunnen
   divergeren? De vorige ronde formuleerde het doel als "geen view zonder zijn backend"; is dat
   aantoonbaar, of alleen beweerd?
2. **Is de tweede toets echt onafhankelijk?** `tests/test_plugin_registry.py` leidt per view de
   aangeroepen `api.<methode>()`-namen af en controleert dat elk pad door een gemounte route wordt
   bediend. Bewijs met een mutatie dat die toets iets vangt — haal bijvoorbeeld een router uit de
   registratie of uit de mount en kijk wat erom valt. Als er niets omvalt, is dat een bevinding.
3. **Is de handgeschreven pin geen echo?** De pin in `tests/test_plugin_registry.py` hoort een
   onafhankelijke kopie van de sidebar te zijn, niet afgeleid uit `app.plugins`. Controleer dat, en
   controleer met een mutatie dat hij een echte wijziging vangt.
4. **`/plugins.js` als gegenereerd bestand.** Is de laadorde in `static/index.html` gegarandeerd?
   Wat gebeurt er als het script ontbreekt, faalt, of als de browser het uit de cache haalt? Is de
   foutmelding in `registry.js` bruikbaar? Let ook op de registratie vóór de statische mount in
   `app/main.py`.
5. **De JS-suite haalt de pluginlijst via een subprocess bij Python.** Is dat acceptabel, of maakt
   het de suite onnodig fragiel? En klopt het dat er nergens een tweede kopie van de sidebar is
   achtergebleven?
6. **`backend=False` op de view** als manier om "heeft geen backend" te zeggen. Is dat de juiste
   plek, en is de invariant (`backend` waar ⇒ routers niet leeg, en omgekeerd) voldoende?
7. **De router-lus.** Is de volgorde waarin `iter_routers()` de routers mount gelijkwaardig aan de
   oude handmatige volgorde? Zijn er prefixoverlap of routebotsingen die van volgorde afhangen?
8. **Wat is er niet af?** Noem wat fase 2 had moeten doen en niet gedaan heeft, en of de lijst met
   bekende gaten in sectie 4 van het ontwerpdocument compleet is.

## Scopegrens

- **Fase 3, 4 en 5 vallen buiten deze review.** Enable/disable, per-plugin assets, het opsplitsen
  van `api-client.js` en discovery buiten de repo zijn niet gebouwd en horen hier niet als
  ontbrekende functionaliteit gemeld te worden.
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand.** Ze falen ook op `main`,
  omdat de replay-prompts in de draaiende translation-services ontbreken. Controleer dat op beide
  kanten in plaats van het aan te nemen, maar reken ze deze PR niet aan.
- **Bekende gaten uit sectie 4 zijn gegeven.** Rapporteer ze niet opnieuw; beoordeel wel of de
  lijst compleet en juist geprioriteerd is.
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

Node is aanwezig (v24.21.0), Playwright met Chromium zit in `.venv`, en de JS-suite heeft Python
nodig omdat hij de pluginlijst daar ophaalt.

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

Controleer daarnaast zelfstandig:

- dat het API-oppervlak niet veranderd is: vergelijk de routes van `app.main.app` op deze branch met
  die op `main`, en verklaar elk verschil;
- dat de acht verwijderde `static/src/plugins/*/manifest.js` nergens meer gebruikt worden;
- dat `docs/plugin-architecture.md` nog klopt met de code, met de nadruk op de regelverwijzingen —
  die zijn in deze PR verschoven en bijgewerkt, en dat is precies waar eerdere rondes fouten vonden.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel, in
`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-1.md`. Beantwoord expliciet of het doel
van fase 2 gehaald is en of de twee toetsen bewijs leveren of alleen vorm hebben. Eindig met één
verdict:

- approve;
- approve with nits;
- changes requested.
