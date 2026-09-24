# Reviewprompt PR #24, ronde 3 — de drie punten uit ronde 2

Review de verwerking van ronde 2 op PR #24, branch `feature/replay-error-statuses` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-24-replay-error-statuses-review-findings-3.md`

## Context

Ronde 2 (`docs/reviews/pr-24-replay-error-statuses-review-findings-2.md`) eindigde op **approve with
nits** met drie punten, alle in `_load_prompt`. Ze zijn verwerkt in `e1ebdd8`-opvolger (één commit):

1. **Een antwoord dat aankomt maar onbruikbaar is, werd een 500.** Het lezen en parsen zit nu in een
   tweede `try`: `json.JSONDecodeError` en `UnicodeDecodeError` geven een `PromptLoadError` met 502
   (*"translation-services sent an unreadable answer: …"*), en een antwoord dat geen object is geeft
   502 met de soort erin (*"… sent list instead of a prompt"*). Een `AttributeError` wordt dus niet
   meer gevangen als programmeerfout maar als verkeerd antwoord. End-to-end gemeten: een HTML-body
   van een proxy op `POST /api/replay/session` geeft nu **502** met de reden, voorheen 500.
2. **Alleen de 5xx-helft van de "al het andere"-tak was gepind.** De subTest op de 502-tak loopt nu
   over 400, 403, 500 en 503, zodat alleen een upstream-404 de 404-behandeling krijgt.
3. **De opbouw van het verzoek was onbewaakt.** Een test roept `_load_prompt("../../v1/models")` aan
   en kijkt naar het verzoek dat bij `urlopen` aankomt: het pad eindigt op
   `/v1/prompts/..%2F..%2Fv1%2Fmodels`, de methode is GET en de timeout is 5.0. Er staat nu ook een
   regel commentaar bij `quote(..., safe="")` waarom die quoting daar staat.

Mutaties nagemeten: 403 in de 404-tak → rood; `safe=""` naar `safe="/"` → rood; de twee nieuwe
502-takken naar 404 → zes tests rood.

## Te beoordelen

1. **Is de nieuwe indeling van `_load_prompt` goed?** Twee `try`-blokken na elkaar, en het
   `isinstance(data, dict)`-vinkje in plaats van een `AttributeError`-vangnet. Is dat de juiste grens
   tussen "de dienst faalde" en "wij hebben een fout", of vangt de tweede `try` nu iets dat een 500
   hoort te blijven?
2. **Zijn de nieuwe toetsen eerlijk?** Dekken de vier onleesbare antwoorden (`{niet json`, HTML, leeg,
   niet-UTF8) en de twee verkeerde soorten (lijst, string) het pad, of blijft er een vorm over die nog
   als 500 aankomt? Is de mock van `urlopen` nog steeds de juiste seam?
3. **Pint de verzoektoets het goede?** `endswith("/v1/prompts/..%2F..%2Fv1%2Fmodels")`, `GET` en
   `timeout == 5.0`. Is dat genoeg om de quoting te beschermen, of is er een id denkbaar die er toch
   langs komt (lege id, `id` met een queryteken, niet-ASCII)?
4. **Is er nu iets nieuws stuk?** De drie suites, en of deze commit iets raakt dat in ronde 1 of 2
   goedgekeurd was.
5. **Wat is er niet af?** De websocket, de snelheidsselect die alleen logt, en de skip-probe die op
   status had kunnen kijken — is dat nog de juiste grens?

## Scopegrens

- **Alleen deze commit en wat daaruit volgt**; de rest van de PR is in ronde 1 en 2 goedgekeurd en
  wordt niet opnieuw gereviewd.
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

Verwacht: **217 passed, 5 skipped**; 6 JS-tests; browsercheck groen inclusief "refused replay start".

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel in
`docs/reviews/pr-24-replay-error-statuses-review-findings-3.md`. Beantwoord expliciet of de nieuwe
indeling van de loader goed is en of er nog een antwoordvorm is die als 500 doorkomt. Eindig met één
verdict:

- approve;
- approve with nits;
- changes requested.
