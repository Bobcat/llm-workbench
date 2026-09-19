# Reviewprompt PR #16 — plugin-architectuur fase 2, ronde 3

Review PR #16, branch `feature/plugin-registry-phase-2` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-3.md`

## Context

Derde ronde. Ronde 1 gaf *approve with nits* (`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-1.md`,
verwerkt in `91c00ef`), ronde 2 idem (`...-findings-2.md`, verwerkt in `f1dec21`). Je beoordeelt nu
`f1dec21` bovenop `1d853d3`.

Wat er sinds ronde 2 is veranderd:

- **De declaratie wordt in beide richtingen getoetst.** Naast *aangeroepen ⊆ gedeclareerd* nu ook
  *gedeclareerd ⊆ gebruikt*, voor routers én voor websockets. Bij het toevoegen was de data schoon
  (0 van 34 paren overbodig), dus de toets ging groen het bestand in.
- **Het ontwerpdocument controleert zichzelf.** Je aanbeveling uit ronde 2 is gebouwd: een toets
  leest elke `bestand:regel` in `docs/plugin-architecture.md` en eist dat de aangewezen regel een
  symbool bevat dat de tekst eromheen noemt. De twee nummers die je noemde zijn gecorrigeerd, en de
  toets ving meteen twee nieuwe verschuivingen die deze commit zelf veroorzaakte.
- **De twee getallen in sectie 4 zijn gecorrigeerd** naar vijf views in drie andere plugins, op
  beide manieren gemeten zoals jij deed.
- **De payload-assertie pint nu de exacte sleutelverzameling** op viewniveau, zodat `websockets`
  en `routers` daar falen in plaats van pas in `json.dumps`.
- **Het foutpaneel geeft bruikbaar advies**: herladen en controleren of de server draait, met de
  technische regel eronder in plaats van de Node-instructie erboven.
- Kleinere correcties: de module-docstring wijst nu `app/router.py` aan voor de routers, de
  websockets zijn *applicatieroutes* buiten `/api`, een toets die meer beloofde dan hij deed is
  hernoemd, en de ontbrekende lege regel is terug.

Lees eerst:

- `docs/reviews/pr-16-plugin-registry-phase-2-review-findings-2.md` — je eigen ronde 2
- `git show f1dec21`
- `tests/test_plugin_registry.py`, met de nadruk op `DocumentedLineReferenceTests` en de twee
  spiegeltoetsen
- `docs/plugin-architecture.md` en `static/app.js`

## Te beoordelen

1. **Vangt de nieuwe documenttoets echt?** Probeer het zelf: verschuif een regelnummer in het
   document naar ander code en kijk of de toets faalt. Probeer daarna een verschuiving binnen
   dezelfde functie, en beoordeel of de beperking die in de docstring staat acceptabel is of dat
   het een half bewijs is.
2. **Zijn de spiegeltoetsen geen fuik?** Ze zijn groen toegevoegd. Controleer of ze iets kunnen
   afwijzen dat juist is — bijvoorbeeld een view die een router declareert voor endpoints die hij
   via een andere weg bereikt. Als dat kan, is dat een bevinding over de toets, niet over de data.
3. **Is de documenttoets onderhoudbaar?** Hij leest proza en leidt ankers af met een heuristiek.
   Waar zit de eerste valse positieve of negatieve die een volgende wijziging gaat veroorzaken?
4. **Is alles uit ronde 2 nu weg?** Loop je eigen bevindingen en nits na, inclusief de getallen en
   de twee regelverwijzingen.
5. **Wat is er niet af?** Noem wat deze ronde had moeten doen en niet gedaan heeft, en of de
   gatenlijst in sectie 4 nog compleet en juist geprioriteerd is.

## Scopegrens

- **Fase 3, 4 en 5 vallen buiten deze review.** Enable/disable, per-plugin assets, het opsplitsen
  van `api-client.js` en discovery buiten de repo zijn niet gebouwd.
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand.** Ze falen ook op `main`;
  controleer dat op beide kanten en reken ze deze PR niet aan.
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

- dat het API-oppervlak nog ongewijzigd is ten opzichte van `main`;
- dat de vier mutaties die deze ronde toevoegt echt rood worden: een router weghalen, een router
  verwisselen, een overbodige router toevoegen, een overbodige socket toevoegen;
- dat de sidebar nog uit de gegenereerde global komt en dat een afgebroken `/plugins.js` een
  leesbaar paneel met bruikbaar advies oplevert.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel, in
`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-3.md`. Beantwoord expliciet of de
bevindingen en nits uit ronde 2 afdoende zijn opgelost. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
