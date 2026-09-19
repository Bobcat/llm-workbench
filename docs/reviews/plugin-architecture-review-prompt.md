# Reviewprompt — plugin-architectuur: beslissingen en fase-afbakening

Review het designdocument `docs/plugin-architecture.md` tegen de code in
`/home/gunnar/projects/llm-workbench` (branch `main`).

Dit is een **ontwerpreview, geen codereview**. Er hoeft geen code te veranderen.

Schrijf de review naar:

`docs/reviews/plugin-architecture-review.md`

## Context

De plugin-architectuur wordt in vier fasen gebouwd. Fase 1 is klaar, gemerged en gepusht: de
sidebar en de routeregistratie komen uit manifesten onder `static/src/plugins/` in plaats van
uit hardcoded lijsten in `static/app.js`. Fase 2, 3 en 4 zijn niet begonnen.

Fase 1 is inmiddels drie keer gereviewd; die reviews staan in
`docs/reviews/refactor-plugin-registry.md` en `docs/reviews/plugin-registry-hardening.md`. Het
gaat nu niet om die code, maar om **de afbakening en het contract**, zodat fase 2 niet op een
zwakke aanname voortbouwt. Een collega die het contract uitdaagt is hier meer waard dan iemand
die de diff nog eens naleest.

Het document claimt zelf: *de code is de bron van waarheid; waar dit document en de code
verschillen, wint de code.* De eerste opdracht hieronder is die claim op de proef stellen.

Lees eerst:

- `docs/plugin-architecture.md`
- `static/src/plugins/registry.js` en de 8 manifesten onder `static/src/plugins/`
- `static/app.js` (vooral de registratie- en laadlogica, regels 122-221)
- `static/src/plugins/developer/manifest.js` (het auxiliary-geval)
- `tests/js/plugin-registry.test.mjs` en `tests/browser/check_plugin_registry.py`
- `README.md` (Code Map, Runtime Model, Verification)
- `docs/README.md` (de status van documenten in deze map)

## Opdracht

1. **Verifieer elke feitelijke bewering in het document tegen de code.** Regelnummers,
   aantallen (8 manifesten, 7 categorieën, 1 auxiliary, 20 views, 19 persistent, 4 aliassen),
   de tabel met registry-exports, de vier loader-eigenschappen, en de lijst met bekende gaten.
   Rapporteer elke bewering die onjuist, verouderd of niet verifieerbaar is. Dit is het
   belangrijkste onderdeel van de review.
2. **Beoordeel of het contract fase 2 en 3 kan dragen.** Niet of het mooi is, maar of het de
   wijzigingen die het document zelf aankondigt mogelijk maakt zonder het contract te breken.
3. **Beantwoord de zes open vragen** in sectie 6, of beargumenteer waarom een ervan de verkeerde
   vraag is.
4. **Noem wat er ontbreekt.** Denk aan: failure modes die het document niet noemt, een fase die
   te groot of te klein is afgebakend, een beslissing die als vaststaand wordt gepresenteerd
   maar feitelijk nog open is.

## Scopegrens

- **Geen hernieuwde review van de fase 1-code.** Die is drie keer gedaan en de bevindingen zijn
  verwerkt. Alleen als het document iets over die code beweert dat niet klopt, is het een
  bevinding.
- **De lijst met bekende gaten in sectie 4 is gegeven.** Rapporteer die niet als nieuwe
  bevindingen. Beoordeel wel of de lijst compleet is en of de prioritering klopt.
- **Geen implementatievoorstel in detail.** Een richting aangeven mag; een uitgewerkt ontwerp
  voor fase 3 of 4 is niet gevraagd.
- **Geen codewijzigingen.** Het document is het artefact.

## Verificatie

Node is aanwezig (v24.21.0) en Playwright met Chromium zit in `.venv`.

```bash
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
./.venv/bin/python -m pytest tests
```

De Python-suite geeft 120 passed en 5 failures in `tests/test_replay_api.py`. Die vijf falen ook
op `origin/main` (ontbrekende replay-prompts in de draaiende translation-services). Controleer
dat zelf in plaats van het aan te nemen.

Controleer daarnaast met de hand of de aantallen in het document kloppen met wat de registry
daadwerkelijk afleidt, bijvoorbeeld door `static/src/plugins/registry.js` in Node te importeren
en `PLUGINS`, `WORKFLOWS` en `ROUTE_ALIASES` te tellen. Het document noemt zichzelf
controleerbaar; laat zien of dat zo is.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel. Beoordeel per fase of de afbakening houdbaar
is, en of het contract na fase 2 nog steeds één bron van waarheid oplevert. Eindig met één
verdict:

- approve — het contract kan fase 2 in;
- approve with nits — fase 2 kan beginnen, mits de genoemde punten worden meegenomen;
- changes requested — het contract of de afbakening moet eerst herzien worden.
