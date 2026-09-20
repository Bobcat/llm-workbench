# Reviewprompt PR #17 — plugin-architectuur fase 3, ronde 3

Review PR #17, branch `feature/plugin-registry-phase-3` tegen `main`, in
`/home/gunnar/projects/llm-workbench`. Dit is **ronde 3**: ronde 2 eindigde op *approve* met drie
nits (`docs/reviews/pr-17-plugin-registry-phase-3-review-findings-2.md`), en die drie nits zijn
vervolgens opgepakt.

Schrijf je bevindingen naar:

`docs/reviews/pr-17-plugin-registry-phase-3-review-findings-3.md`

## Wat er sinds ronde 2 veranderd is

Twee commits:

- `724cdc3` — het findings-bestand van ronde 2 vastgelegd.
- `0e044ac` — de drie nits verwerkt. De diff `5e5f0f0..0e044ac` is de wijziging zelf; `app/router.py`
  en `app/main.py` zijn opnieuw onaangeroerd, dus de oppervlaktevergelijking uit ronde 1 staat nog.

Kort samengevat:

1. Een `plugins`-sectie die geen object is (een string, een lijst) en een settingsbestand waarvan de
   root geen object is, zijn nu een fout met het bestand erbij, in plaats van stil genegeerd. Vóór
   de fix gaf `"plugins": "kapot"` in `local.json` alle acht categorieën, met de goede lijst in
   `settings.json` weggegooid.
2. `enabled: null` zet alles aan en overrulet daarmee het basisbestand; dat staat nu in de README en
   in de fase-3-sectie van het ontwerpdocument, en het is gepind.
3. Het hashgat in sectie 4 noemt nu een vervolgstap.

## Te beoordelen

1. **Is nit 1 goed opgelost?** Weigert de schakelaar nu elke vormfout, met het juiste bestand in de
   melding — en niet te veel? Let op configuraties die voorheen werkten: `"plugins": null`, een
   ontbrekende `plugins`-sectie, een leeg bestand, een bestand dat niet bestaat, en een lege
   `local.json`. Test met een echte `config/local.json` en een draaiende server, inclusief de
   serverlog.
2. **Is de strengere lezer geen regression voor de rest van het werkbench?** `_load_json_object` in
   `app/plugins.py` is een kopie van de loader die de service-settings gebruiken, maar met één
   bewust verschil: een niet-object-root is hier een fout. Klopt die afweging, en raakt het iets
   anders dan de menu-schakelaar?
3. **Zijn de nieuwe pins de juiste?** `test_a_shape_error_above_enabled_is_an_error`,
   `test_a_settings_file_that_is_not_an_object_is_an_error` en
   `test_an_explicit_null_turns_everything_on`. Vangt elk ervan een terugval, en mist er een geval?
4. **Is de documentatie nu compleet?** README en de fase-3-sectie noemen de vormeisen en
   `enabled: null`; sectie 4 noemt de vervolgstap bij het hashgat. Klopt het, en staat het op de
   plek waar een operator het zoekt?
5. **Is er door deze wijziging iets nieuws stukgegaan?** Let op de documenttoets
   (regelverwijzingen), de browsercheck, de hermeticiteit voor `config/local.json` en de
   payload-vergelijking met `main`.

## Scopegrens

- **Fase 4 en 5 vallen buiten deze review.**
- **Het samenvoegen van de zeven kopieën van de settings-loader valt buiten deze review**; dat staat
  als gat in sectie 4. Het verschil in gedrag tussen die kopieën is juist onderdeel van punt 2.
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand** en falen ook op `main`.
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel, in
`docs/reviews/pr-17-plugin-registry-phase-3-review-findings-3.md`. Beantwoord expliciet of de drie
nits naar tevredenheid zijn afgehandeld en of de striktere schakelaar ergens anders pijn doet.
Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
