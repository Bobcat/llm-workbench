# Reviewprompt PR #19 — plugin-architectuur fase 5, ronde 3

Review de verwerking van ronde 2 op branch `feature/plugin-discovery-phase-5` (commit `4839139`),
tegen `main`, in `/home/gunnar/projects/llm-workbench`.

Dit is **ronde 3**. Ronde 2 staat in `docs/reviews/pr-19-plugin-discovery-phase-5-review-findings-2.md`
en eindigde op *approve with nits*, met vier punten: twee coderingen die de mountgrens passeerden, een
importcontrole die tegelijk te krap en te ruim was, `CoreMountTests` dat omviel op de router van een
pakket, en een plugin-id zonder vormcontrole. Alles is verwerkt in `4839139`; de diff
`86226a0..4839139` is precies die verwerking.

Schrijf je bevindingen naar:

`docs/reviews/pr-19-plugin-discovery-phase-5-review-findings-3.md`

## Wat er sinds ronde 2 veranderd is

| punt uit ronde 2 | wat er nu staat |
| --- | --- |
| de mountgrens is met een andere codering te omzeilen (laag) | `_checked_asset_path` decodeert de waarde zoals de URL-parser dat doet (`%2e%2e`, backslash als scheidingsteken) en vergelijkt pas daarna; `iconMarkup` en `applyPluginStyles` weigeren procenttekens en backslashes ook |
| de importcontrole is te krap en te ruim (laag/medium) | `_imports_leaving_plugin` werkt nu in **URL-ruimte**: de core relatief importeren is toegestaan (dat werd eerst onterecht gemeld), een import naar een andere plugin wordt gevangen, ook in de absolute vorm die de oude regex niet las. De sanctie staat in het document |
| een pakket met eigen adressen maakt `CoreMountTests` rood (laag) | de spiegeltoets telt de routers van gevonden pakketten mee in wat gedefinieerd is |
| `plugin.id` wordt niet op vorm gecontroleerd (nit) | de id moet `^[a-z0-9-]+$` zijn, dezelfde vorm die het frontendpatroon eist |

## Te beoordelen

1. **Is elke codering nu dicht?** Herhaal je metingen uit ronde 2 en zoek de volgende variant:
   dubbele procent-codering, een `%00`, een Unicode-separator, een pad dat pas na drie
   normalisatiestappen buiten de mount valt, of een id dat zelf iets met een procent of een
   backslash is.
2. **Draagt de importcontrole in URL-ruimte?** Klopt het dat de core relatief importeren nu
   toegestaan is, en dat de absolute vorm naar een andere plugin gevangen wordt? Is de lijst met
   toegestane URL-prefixen (`/src/shared/`, `/foundation/`, de eigen plugin, de map van de view)
   te ruim of te krap? Let op twee kanten: een legitieme import die nu gemeld wordt, en een
   ontwijking die er nog langs komt — bijvoorbeeld via een bare specifier of een dynamic `import()`.
3. **Is de vormcontrole op de id de juiste?** `^[a-z0-9-]+$` is streng: een pakket met een
   underscore in de naam moet zijn id aanpassen. Is dat de goede grens, en staat het duidelijk
   genoeg in het document en in de melding?
4. **Is `CoreMountTests` nu in beide richtingen goed?** Met een pakket erbij moet hij slagen, en
   zonder pakket identiek blijven aan wat hij was. En klopt het dat een half gemounte map niet
   mogelijk is als de tweede plugin in de rij faalt?
5. **Is er door deze wijziging iets nieuws stukgegaan?** De documenttoets, de browsercheck, de
   payload- en oppervlaktevergelijking met `main`, en de end-to-end-test met een echt pakket.

## Scopegrens

- **De rest van fase 5 is in ronde 1 goedgekeurd** en hoeft niet opnieuw; alleen wat deze diff raakt.
- **Fase 1 tot en met 4 worden niet opnieuw gereviewd.**
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand** en falen ook op `main`.
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

De pytest-suite geeft 185 passed en 5 failures in `tests/test_replay_api.py`; die vijf falen ook op
`main`.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel in
`docs/reviews/pr-19-plugin-discovery-phase-5-review-findings-3.md`. Beantwoord expliciet of de vier
punten uit ronde 2 nu dicht zijn, of de mountgrens nog te omzeilen is en of een legitiem pakket de
suite groen laat. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
