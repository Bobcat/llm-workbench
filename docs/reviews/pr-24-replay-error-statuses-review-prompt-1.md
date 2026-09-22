# Reviewprompt PR #24 — echte HTTP-statussen op de replay-sessieroutes

Review PR #24, branch `feature/replay-error-statuses` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-24-replay-error-statuses-review-findings-1.md`

## Context

De replay-routes in `app/realtime_translation/replay/replay.py` antwoordden op elke fout met status
**200** en een body als `{"error": "..."}`. Twintig van die plekken geven nu een echte status:

| status | gevallen |
| --- | --- |
| 404 | samplebestand ontbreekt, onbekende sessie, prompt die de client zelf noemde maar de bibliotheek niet heeft |
| 400 | onbekende snelheid, onbekende policy, lege source/target-taal |
| 409 | policywijziging tijdens het spelen, export zonder events |
| 502 | translation-services onbereikbaar, HTTP-fout van die service, of de default-prompt die de *server* zelf kiest ontbreekt |

`PromptLoadError(ValueError)` in `prompt_selection.py` draagt die status uit de loader, zodat geen
enkele route op fouttekst matcht. De twee prompt-plekken verschillen bewust: noemt de **client** de
prompt-id, dan is 404 het antwoord; kiest de **server** de default-id (`create_session`), dan is een
ontbrekende prompt een storing aan de andere kant en is het antwoord 502.

Aanleiding was concreet: in deze omgeving draait `translation-services` zonder
`translate_realtime_first`, dus `POST /api/replay/session` antwoordde `200` met een foutbody. De
replay-view las daar `session_id` uit en ging verder met een `undefined`-sessie — `POST
/api/replay/undefined/policy` — voordat de gebruiker iets over de ontbrekende prompt zag. De view
controleerde na vier calls `result?.error`; die guards zijn nu weg omdat `fetchJson` al gooit.

## Te beoordelen

1. **Is de statuskeuze per geval verdedigbaar?** Vooral: is 409 juist voor "policy alleen while
   idle" en "export zonder events", of is dat eerder 400 respectievelijk 404? Is 502 juist voor een
   ontbrekende default-prompt bij het aanmaken van een sessie, of hoort dat 404 of 500 te zijn? En
   is 404 juist voor een prompt-id die de client noemde maar de bibliotheek niet heeft?
2. **Is `PromptLoadError` de juiste vorm?** De loader kent de upstream-status het beste, maar de
   route kent de betekenis voor de client. Is een `status_code`-attribuut op een exception houdbaar,
   of hoort de route zelf te mappen — en wat gebeurt er met een loader die iets anders gooit?
3. **De detailvorm.** Een ontbrekend bestand antwoordt met `detail: {"error": "File not found",
   "path": "..."}` — een object met een `error`-sleutel onder `detail`, omdat de voorkant die vorm al
   las. Is dat een houdbaar contract, of hoort `detail` hier een platte string te zijn?
4. **Zijn de negen nieuwe tests eerlijk?** Ze bouwen een sessie direct uit het samplebestand in
   plaats van via de route, zodat ze zonder draaiende service kunnen. Verbergt dat iets? En zeggen
   de mutatiechecks (409 naar 400, promptstatus hard op 502, oud contract in de browsercheck) echt
   iets, of alleen dat de tests meebewegen met de code?
5. **De view.** Klopt het dat de vier `result?.error`-guards onbereikbaar waren, of verdedigden ze
   iets anders (een proxy die bodies herschrijft, een oude server, een gecachte module)? En is het
   tonen van `err.message` in de alerts voldoende, of lekt er ergens een rauwe fout naar de
   gebruiker?
6. **De browsercheck.** De nieuwe sectie onderschept `/api/replay/session` en eist de melding plus
   dat er geen request met een `undefined`-sessie volgt. Meet dat de juiste laag, of test het vooral
   de interceptie?
7. **Wat is er niet af?** De websocket voor een onbekende sessie, de snelheidsselect die alleen logt,
   en de skip-probe die nu op status had kunnen kijken. Is dat de juiste grens?

## Scopegrens

- **Alleen deze contractwijziging**: de replay-routes, de loader, de replay-view en de twee
  testbestanden in deze diff.
- **De fasen 1 tot en met 5, PR #20 en PR #23 worden niet opnieuw gereviewd.**
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

Verwacht: **207 passed, 5 skipped**; 6 JS-tests; de browsercheck groen inclusief de nieuwe sectie
"refused replay start". Een `translation-services` met de replay-prompts laat die vijf skips draaien
— probeer dat niet te forceren door de service te wijzigen.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel in
`docs/reviews/pr-24-replay-error-statuses-review-findings-1.md`. Beantwoord expliciet of de
statuskeuze per geval klopt, of `PromptLoadError` de juiste vorm is, en of het weghalen van de
view-guards veilig is. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
