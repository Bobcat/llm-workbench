# Reviewprompt PR #16 — plugin-architectuur fase 2, ronde 4

Review PR #16, branch `feature/plugin-registry-phase-2` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-4.md`

## Context

Vierde ronde. Ronde 1 en 2 gaven *approve with nits*, ronde 3 ook — met de opmerking dat je geen
vierde ronde nodig achtte omdat de resterende punten klein en lokaal waren. Die punten zijn
verwerkt in `28a1575`, bovenop `edbf708`.

Je beoordeelt nu `28a1575`. Wat er sinds ronde 3 is veranderd:

- **Literale API-paden tellen mee in de padanalyse.** Je blinde vlek is gedicht in plaats van
  opgeschreven: de URL's die zes views met de hand bouwen worden nu verzameld (als prefix, want het
  zijn meestal basissen). Je mutatie — `/api/pdf-benchmark/runs/` vervangen door `/api/nope/` — faalt
  nu, met de view en het pad in de melding.
- **`ViewSocket` draagt de clientnaam.** `ReplaySpeakWebSocket` wordt niet meer uit het pad
  afgeleid. Consistent hernoemen is groen; alleen in JS hernoemen faalt met de ontbrekende naam
  erbij — dat is de bedoeling, want dan is de declaratie verouderd.
- **De documenttoets ankert een tabelrij op zijn eigen symbool.** Alle tien buurwissels die je
  vond, worden nu gevangen; ik heb de wissel `PLUGINS` 41 → 45 nagemeten als bewijs.
- **De toets kiest het meest specifieke anker** in plaats van het eerste dat past. Daarmee ging de
  zwakste prose-verwijzing (`static/app.js:59-67`) van 56% naar 8% van de posities die een
  verschuiving overleven. De docstring noemt nu de drie resterende beperkingen met hun gemeten
  marges, inclusief dat `static/index.html:7-22` met 55% de zwakste blijft omdat het een blok van
  zestien regels is.

Lees eerst:

- `docs/reviews/pr-16-plugin-registry-phase-2-review-findings-3.md` — je eigen ronde 3
- `git show 28a1575`
- `tests/test_plugin_registry.py`, vooral `_called_paths`, `_prefix_is_served` en
  `DocumentedLineReferenceTests`
- `app/plugins.py` (`ViewSocket`) en `docs/plugin-architecture.md`

## Te beoordelen

1. **Is de blinde vlek echt dicht?** Probeer een literaal pad te vinden dat de analyse nog mist —
   een andere vorm dan `'/api/...'` of `` `/api/...${x}` ``, of een pad dat niet met `/api/` begint.
   Als er nog een weg is waarlangs een view een endpoint aanspreekt dat niemand mount, is dat een
   bevinding.
2. **Introduceert de prefixsemantiek een valse geruststelling?** Een literaal wordt nu geacht
   gediend te zijn als er een route onder hangt. Kan daardoor een pad door de controle komen dat in
   werkelijkheid niet bestaat?
3. **Is de socketkoppeling nu robuust?** De registratie noemt de clientnaam. Wat gebeurt er bij een
   client die twee sockets gebruikt, of bij een socket die zonder klasse wordt aangesproken?
4. **Is de aangescherpte documenttoets niet te streng?** Hij eist het meest specifieke anker. Kan
   een legitieme documentwijziging daar onterecht op stuklopen?
5. **Is alles uit ronde 3 weg, en wat is er niet af?** Loop je eigen bevindingen na. Bevestig of
   er nog werk is, of zeg dat het klaar is — dat laatste mag ook.

## Scopegrens

- **Fase 3, 4 en 5 vallen buiten deze review.**
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand** en falen ook op `main`.
- Geen codewijzigingen: het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

Controleer daarnaast zelfstandig dat het API-oppervlak nog ongewijzigd is ten opzichte van `main`,
en dat de mutaties die deze ronde toevoegt rood worden.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel, in
`docs/reviews/pr-16-plugin-registry-phase-2-review-findings-4.md`. Als je van mening bent dat er
niets meer te doen is, zeg dat dan expliciet — dan stopt de reeks hier. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
