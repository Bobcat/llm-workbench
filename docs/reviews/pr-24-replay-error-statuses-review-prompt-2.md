# Reviewprompt PR #24, ronde 2 — de drie punten uit ronde 1

Review de verwerking van ronde 1 op PR #24, branch `feature/replay-error-statuses` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-24-replay-error-statuses-review-findings-2.md`

## Context

Ronde 1 (`docs/reviews/pr-24-replay-error-statuses-review-findings-1.md`) eindigde op **approve with
nits** met drie punten. Ze zijn verwerkt in `e1ebdd8`:

1. **De loader-kant van de statuskeuze was onbewaakt.** De drie prompttests in
   `tests/test_replay_api.py` injecteren een `PromptLoadError` met een zelfgekozen status en toetsen
   dus de doorgeefroute, niet de keuze in `prompt_selection.py`. Nieuw:
   `tests/test_replay_prompt_selection.py` draait `_load_prompt` tegen een nagebootste `urlopen` en
   pint 404 voor een prompt die de bibliotheek niet heeft, 502 voor een HTTP-fout van de service,
   een onbereikbare service en een timeout, plus dat de reden meereist en dat een geldig antwoord een
   `PromptRecord` wordt. De door de reviewer gebruikte mutatie (404 naar 502 in de loader) laat nu
   een test falen.
2. **Het `detail`-object leverde minder op dan een platte string.** Een ontbrekend bestand antwoordt
   nu met `"File not found: /abs/pad"` in plaats van `{"error": "File not found", "path": "..."}`,
   zodat het pad de gebruiker wél bereikt; de bijbehorende test toetst begin en eind van de string.
3. **De browsercheck-fixture antwoordde 404** met de tekst die op `create_session` juist 502 is; die
   staat nu op 502 en volgt daarmee de regel van de PR.

Ook rechtgezet in de PR-body: de websocket sluit al met `4001 Session not found` (dus geen gat), en
het aantal tests klopte niet.

## Te beoordelen

1. **Pint de nieuwe test de juiste dingen?** Dekken de vijf gevallen (`404`, `5xx`, `URLError`,
   `TimeoutError`, geldig antwoord) de loader, of blijft er een pad onbewaakt — bijvoorbeeld de
   quoting van de prompt-id, `_base_url()`, of een 3xx/4xx-anders-dan-404? Is de mock van `urlopen`
   eerlijk genoeg (het is de enige seam die de loader heeft)?
2. **Is de platte string een verbetering zonder verlies?** Het pad staat nu in de melding, maar de
   oude body had `error` en `path` als aparte velden. Is er een client denkbaar die daarop leunde, en
   weegt dat op tegen wat de gebruiker nu ziet?
3. **Is de fixturewijziging genoeg?** De view behandelt elke non-2xx hetzelfde, dus de wijziging is
   consistentie en geen nieuw gedrag. Klopt die redenering, of maskeert die het feit dat de
   browsercheck de statuscode niet werkelijk toetst?
4. **Is er nu iets nieuws stuk?** De mutatie uit ronde 1, de drie suites, en of `e1ebdd8` iets raakt
   dat in ronde 1 goedgekeurd was.
5. **Wat is er niet af?** De websocket, de snelheidsselect die alleen logt, en de skip-probe die op
   status had kunnen kijken — is dat nog steeds de juiste grens?

## Scopegrens

- **Alleen `e1ebdd8` en wat daaruit volgt**; de rest van de PR is in ronde 1 goedgekeurd en wordt
  niet opnieuw gereviewd.
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

Verwacht: **214 passed, 5 skipped**; 6 JS-tests; browsercheck groen inclusief "refused replay start".

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel in
`docs/reviews/pr-24-replay-error-statuses-review-findings-2.md`. Beantwoord expliciet of de nieuwe
test de loader echt afdekt en of het vervallen van `detail.path` ergens pijn doet. Eindig met één
verdict:

- approve;
- approve with nits;
- changes requested.
