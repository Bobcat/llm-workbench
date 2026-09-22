# Reviewprompt PR #21 — de replay-sessietests en hun service

Review PR #21, branch `fix/replay-tests-external-service` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-21-replay-tests-review-findings-1.md`

## Context

Vijf tests in `tests/test_replay_api.py` maken een replay-sessie aan en hangen daarmee aan een
draaiende `translation-services` met de prompts `translate_realtime_first` en
`translate_realtime_second`. In deze omgeving draait die service wel, maar zonder die twee prompts,
en dan antwoordt hij met een fout in een **200-body**:

```
POST /api/replay/session  ->  status 200
body: {"error": "Prompt 'translate_realtime_first' not found in translation-services."}
```

De test doet daarna `response.json()["session_id"]` en faalt met een `KeyError` — een fout die op een
bug in de workbench lijkt maar een ontbrekend fixture in een service is die niet in deze repo zit.
Daardoor stond de suite permanent op vijf rood.

Deze PR laat die vijf skippen met een reden, via een probe die door dezelfde route kijkt die de
workbench zelf gebruikt (`GET /api/translation/prompts`). De zesde test in dat bestand draait door,
want die heeft geen service nodig. In de README staat nu dat die vijf een service met de
replay-prompts vragen.

## Te beoordelen

1. **Is de skip eerlijk, of verstopt hij een bug?** Dit is de belangrijkste vraag. De probe loopt via
   de workbench naar de service. Als de workbench zelf stuk is op die route, of als de sessieroute
   iets anders breekt dan de prompts, dan skipt de suite en blijft een echte regressie onzichtbaar.
   Is dat risico hier acceptabel, en is er een manier om het smaller te maken — bijvoorbeeld door de
   probe alleen op de prompts van de service te richten en niet op de werkbench-route, of door de
   skip-conditie te laten eisen dat de sessieroute zelf wél bereikbaar is?
2. **Is de probe zelf goed?** `_replay_prompts_available()` wordt één keer bij import uitgevoerd en
   het resultaat wordt bewaard. Klopt die caching, is het redelijk dat de suite bij het importeren al
   contact met de service zoekt, en wat gebeurt er als de service traag is of halverwege antwoordt?
3. **Is de vorm de juiste?** Vijf losse decorators op de vijf tests, versus de klasse splitsen in
   "heeft een sessie nodig" en "niet". En is skip de juiste uitkomst, of horen dit integratietests te
   zijn die je apart draait?
4. **Hoort de 200-met-een-foutbody zelf aangepakt te worden?** De sessieroute geeft succes en falen
   dezelfde status; een client moet de body lezen om het verschil te zien. Is dat een apart punt
   waard, en wat zou het de voorkant kosten (de replay-view leest die body nu)?
5. **Wat is er niet af?** Noem wat deze PR laat liggen en of dat de juiste grens is.

## Scopegrens

- **Alleen de tests en de README.** Geen gedrag van de workbench, geen endpoints.
- **De fasen 1 tot en met 5 en PR #20 worden niet opnieuw gereviewd.**
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
```

Verwacht: **199 passed, 5 skipped**, geen failures. Draait er een `translation-services` met de
replay-prompts, dan horen die vijf te draaien in plaats van te skippen — probeer dat te controleren
zonder de service te wijzigen (de PR doet hetzelfde met een tijdelijke aanpassing van de probelijst,
en dat is precies het bewijs dat de skip aan de probe hangt en geen uitgeschakelde test is).

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel in
`docs/reviews/pr-21-replay-tests-review-findings-1.md`. Beantwoord expliciet of de skip een bug kan
verbergen, of de probe klopt, en of de vorm de juiste is. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
