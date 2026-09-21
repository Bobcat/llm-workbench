# Reviewprompt PR #19 — plugin-architectuur fase 5, ronde 2

Review de verwerking van ronde 1 op branch `feature/plugin-discovery-phase-5` (commit `1345e6d`),
tegen `main`, in `/home/gunnar/projects/llm-workbench`.

Dit is **ronde 2**. Ronde 1 staat in `docs/reviews/pr-19-plugin-discovery-phase-5-review-findings-1.md`
en eindigde op *approve with nits*, met drie bevindingen in dezelfde familie: padvelden die niet
genormaliseerd of niet gecontroleerd werden. Alles is verwerkt in `1345e6d`; de diff `e882e52..1345e6d`
is precies die verwerking.

Schrijf je bevindingen naar:

`docs/reviews/pr-19-plugin-discovery-phase-5-review-findings-2.md`

## Wat er sinds ronde 1 veranderd is

| punt uit ronde 1 | wat er nu staat |
| --- | --- |
| `..` wordt nergens genormaliseerd (laag/medium) | `_checked_asset_path` normaliseert een padveld met `posixpath.normpath` en weigert wat daarna buiten de eigen mount valt of nog een `..` bevat; dat geldt voor `module`, een pad-`icon` én `styles`. `iconMarkup` en `applyPluginStyles` hebben dezelfde wacht, zodat de mountgrens in de browser niet poreus is |
| dezelfde sprong laat regel 2 ontsnappen | de analyse meldt nu een relatieve import die de eigen plugin verlaat: `_imports_leaving_plugin` in `tests/test_plugin_registry.py`, met een toets over alle plugins en een negatief geval in de discovery-suite |
| `styles` wordt niet gevalideerd (laag) | een stylesheet moet onder de eigen mount liggen: een externe URL, een absoluut pad en een pad met `..` worden geweigerd |
| `_DISCOVERED` vóór de botsingscontrole (laag) | de cache wordt pas gevuld als `_check_collisions` slaagt; de toets roept het twee keer aan en eist beide keren een fout |

## Te beoordelen

1. **Is de mountgrens nu dicht?** Herhaal je eigen metingen uit ronde 1: `..` in `module`, `icon` en
   `styles`, in de core en in de browser. Zoek ook een variant die ik niet bedacht heb — een absolute
   URL, een dubbele slash, een procent-gecodeerde `..`, een pad dat pas na normalisatie botst, of
   een pakket-id dat zelf een `..` of een slash bevat.
2. **Draagt de importcontrole?** `_imports_leaving_plugin` bepaalt welke bomen een module mag
   bereiken (de eigen plugin, de map van de view zelf, en de core onder `static/src/shared/` en
   `static/foundation/`). Is die lijst te ruim of te krap, en mist hij een route waarlangs een
   pakket-view toch bij een andere plugin uitkomt? Let ook op de omgekeerde richting: een
   ingebouwde view die iets legitiems importeert wat de controle nu als overtreding ziet.
3. **Is de `styles`-controle de juiste?** Een plugin mag zijn eigen stylesheet meebrengen; mag hij er
   ook een vanaf een CDN bij halen, of is dat precies wat de mountgrens hoort te verbieden? En klopt
   het dat een uitgezette plugin geen stylesheet laadt?
4. **Is de cache-fix volledig?** Zijn er meer plekken waar een mislukte ontdekking iets achterlaat —
   bijvoorbeeld een half gemounte map in `app/main.py` als de tweede plugin in de rij faalt?
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

De pytest-suite geeft 182 passed en 5 failures in `tests/test_replay_api.py`; die vijf falen ook op
`main`.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel in
`docs/reviews/pr-19-plugin-discovery-phase-5-review-findings-2.md`. Beantwoord expliciet of de drie
punten uit ronde 1 nu dicht zijn, of de mountgrens nog te omzeilen is, en of er door de wijziging
iets nieuws stuk is. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
