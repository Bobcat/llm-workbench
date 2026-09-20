# Reviewprompt PR #17 — plugin-architectuur fase 3, ronde 2

Review PR #17, branch `feature/plugin-registry-phase-3` tegen `main`, in
`/home/gunnar/projects/llm-workbench`. Dit is **ronde 2**: ronde 1 eindigde op *approve with nits*
(`docs/reviews/pr-17-plugin-registry-phase-3-review-findings-1.md`).

Schrijf je bevindingen naar:

`docs/reviews/pr-17-plugin-registry-phase-3-review-findings-2.md`

## Wat er sinds ronde 1 veranderd is

Twee commits:

- `43291ec` — het findings-bestand van ronde 1 vastgelegd.
- `83d519f` — de verwerking van die ronde: bevinding 1 (de melding noemde het verkeerde bestand),
  2 (naam en docstring van de toets per categorie), 4 (`route_aliases()`-docstring) en 5 (lege
  regel). Bevinding 3 is als bekend gat in sectie 4 opgenomen in plaats van de router te wijzigen.

De rest van de branch is onveranderd sinds `36f145e`. Je hoeft het eerdere werk dus niet opnieuw te
beoordelen, behalve waar deze wijziging het raakt; de diff `36f145e..83d519f` is de wijziging zelf.

## Te beoordelen

1. **Is bevinding 1 echt opgelost?** Noemt elke melding het bestand waar `plugins.enabled` vandaan
   komt — ook in de randgevallen: `local.json` zonder `plugins`, `plugins` zonder `enabled`,
   `enabled` expliciet `null`, en een lege lijst in het ene bestand terwijl het andere een lijst
   heeft. Test dat met een echte `config/local.json` en een draaiende server, niet alleen met een
   tmp-pad, en kijk of de serverlog hetzelfde bestand noemt als de melding.
2. **Is de nieuwe pin de juiste?** `test_the_error_names_the_file_the_switch_came_from` in
   `tests/test_plugin_registry.py`. Vangt die een terugval naar het oude gedrag? En is de helper
   `_enabled_entry` geen tweede lezer van de settings die uit de pas kan lopen met
   `_merge_json_objects` — bijvoorbeeld bij `enabled: null` in `local.json`?
3. **Is de afhandeling van bevinding 2 en 4 houdbaar?** De toets heet nu
   `test_a_single_category_menu_still_reaches_the_endpoints_its_views_call` en zijn docstring zegt
   dat de gemounte verzameling elke ronde dezelfde is en dat `CoreMountTests` dat bewaakt;
   `route_aliases()` zegt dat alleen de tests hem aanroepen. Is dat genoeg, of had er iets moeten
   verdwijnen?
4. **Is het gat van bevinding 3 goed beschreven?** Sectie 4 zegt nu dat een hashwijziging tijdens de
   sessie de url laat staan, dat dit voor elke onbekende route geldt en dat het ouder is dan fase 3.
   Klopt die afweging, en ontbreekt er een vervolgstap?
5. **Is er door de wijziging iets nieuws stukgegaan?** Let op de documenttoets (regelverwijzingen),
   de browsercheck en de hermeticiteit voor `config/local.json`.

## Scopegrens

- **Fase 4 en 5 vallen buiten deze review.** Het opsplitsen van `api-client.js` en discovery buiten
  de repo zijn niet gebouwd.
- **Het samenvoegen van de zeven kopieën van de settings-loader valt buiten deze review**; dat staat
  als gat in sectie 4.
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand.** Ze falen ook op `main`,
  omdat de replay-prompts in de draaiende translation-services ontbreken.
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel, in
`docs/reviews/pr-17-plugin-registry-phase-3-review-findings-2.md`. Beantwoord expliciet of de
bevindingen uit ronde 1 naar tevredenheid zijn afgehandeld. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
