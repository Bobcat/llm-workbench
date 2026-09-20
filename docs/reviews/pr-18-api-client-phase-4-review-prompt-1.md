# Reviewprompt PR #18 — plugin-architectuur fase 4

Review PR #18, branch `feature/api-client-phase-4` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-18-api-client-phase-4-review-findings-1.md`

## Context

Fase 4 van de plugin-architectuur: `static/src/api-client.js` is weg. Dat bestand was 766 regels met
101 methodes in één object, gebruikt door 19 van de 20 views. Het is gesplitst in een dunne
gedeelde fetch-helper, een core-client met de vier methodes die meer dan één categorie aanroept, en
een client per plugin. De paden die de voorkant aanroept zijn daarmee niet meer één gedeeld
bestand, maar eigendom van de plugin die ze gebruikt.

Het ontwerp is eerst gereviewd (`docs/reviews/plugin-architecture-phase-4-design-review.md`,
*approve with nits*) en daarna aangepast in `6d725ad`. Die review vond twee padfamilies die bij de
verkeerde plugin stonden en een verificatie-eis die niet kon zoals hij beschreven stond; beide zijn
in het ontwerp rechtgezet voordat er code kwam.

De branch bevat vijf commits:

- `c5192dc` — het fase-4-ontwerp in `docs/plugin-architecture.md`
- `9508d6c` — de ontwerpreview vastgelegd
- `6d725ad` — de drie bevindingen daaruit verwerkt
- `67d3186` — de eigenlijke splitsing, inclusief de aangepaste tests
- `7d3ca0a` — documentatie en README bijgewerkt

Lees eerst:

- `docs/plugin-architecture.md` (de fase-4-sectie, sectie 3 en sectie 5)
- `static/src/shared/api/request.js` en `static/src/shared/api/shared.js`
- `static/src/plugins/<categorie-id>/api.js` (zeven stuks)
- een paar views, bijvoorbeeld `static/src/workflows/chat/index.js` en
  `static/src/workflows/pdf-translation/index.js`
- `tests/test_plugin_registry.py` (vooral `_api_paths`, `_client_owners` en `ClientOwnershipTests`)

## Te beoordelen

1. **Is de verhuizing echt een verhuizing?** Vergelijk de methodelichamen in de nieuwe modules met
   `git show main:static/src/api-client.js`. Elke methode zou byte-identiek moeten zijn, op de
   verwijderde `getTtsModels` na. Zoek ook naar wat er níet hoort te zijn veranderd: de
   fetch-helper, de foutmelding, de twee websocket-klassen.
2. **Klopt de verdeling?** Hoort elke methode bij de plugin die hem aanroept, en zijn dat er echt
   vier die meer dan één categorie gebruikt? Meet het zelf: per view welke `api.<methode>()`- of
   `sharedApi.<methode>()`-aanroepen er staan, en welke plugin die view heeft.
3. **Importeert geen enkele view de client van een andere plugin?** Dat is de kernbelofte van deze
   fase. `ClientOwnershipTests` meet het, maar controleer of die toets niet te makkelijk groen is:
   wat gebeurt er als een view een client van een andere plugin importeert, en wat als hij hem
   indirect via een gedeeld bestand binnenhaalt?
4. **Is de padaanalyse nog wat hij zegt?** De methode → pad-tabel uit `api-client.js` is weg; de
   analyse leest nu `/api`-literals in de subtree van de view. Vangt die nog steeds een pad dat
   niemand serveert — en niet te veel, want deze versie matcht ook op prefix voor een basis die een
   view zelf aanvult? Noem een pad dat er volgens jou doorheen zou glippen.
5. **Is de API-oppervlakte identiek?** Vergelijk de paden die de voorkant aanroept met die op
   `main`, en verklaar elk verschil. Vergelijk ook het serveroppervlak (`app.main.app`) — dat hoort
   helemaal niet veranderd te zijn.
6. **Werkt de app nog?** De browsercheck is groen, maar die raakt niet elke view even diep. Kijk of
   er een view is waarvan de aanroepen na de splitsing niet meer kloppen (naam, module, socket).
7. **Wat is er niet af?** Noem wat fase 4 had moeten doen en niet gedaan heeft, en of de scopegrens
   in de fase-4-sectie houdbaar is.

## Scopegrens

- **Fase 5 valt buiten deze review**: discovery buiten de repo en plugins als pakket zijn niet
  gebouwd.
- **Geen wijziging aan de endpoints zelf** hoort bij deze fase: het serveroppervlak is onaangeroerd.
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand** en falen ook op `main`.
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

Node is aanwezig (v24.21.0), Playwright met Chromium zit in `.venv`, en de JS-suite heeft Python
nodig omdat hij de pluginlijst daar ophaalt.

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

Controleer daarnaast zelfstandig:

- dat de methodelichamen identiek zijn aan die op `main` (vergelijk als tekst, niet op naam);
- dat de verzameling `/api`-paden die de voorkant aanroept gelijk is aan die op `main`, op
  `/api/tts-pool/models` na (dat hoorde bij de verwijderde `getTtsModels`);
- dat een pad dat niemand serveert nog steeds gevonden wordt: verander er één in een plugin-client
  en kijk wat erom valt;
- dat een view die de client van een andere plugin importeert gevonden wordt.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel, in
`docs/reviews/pr-18-api-client-phase-4-review-findings-1.md`. Beantwoord expliciet of de splitsing
een verhuizing is en geen herschrijving, of de verdeling klopt, en of de nieuwe toetsen de belofte
van deze fase dragen. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
