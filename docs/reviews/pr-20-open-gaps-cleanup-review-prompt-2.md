# Reviewprompt PR #20 — de vier open gaten uit sectie 4, ronde 2

Review PR #20, branch `feature/open-gaps-cleanup` (commit `a2fc885`) tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-20-open-gaps-cleanup-review-findings-2.md`

## Context

Dit is **ronde 2**. Ronde 1 staat in `docs/reviews/pr-20-open-gaps-cleanup-review-findings-1.md` en
eindigde op *approve with nits* met één laag-bevinding: punt d gaf het icoon een wortelpatroon maar
`styles` niet, dus voor een ingebouwde plugin kwam een externe URL, een absoluut pad of andermans map
erdoor. Die is verwerkt in `a2fc885`, samen met de tweede asymmetrie die je noemde: geen van beide
patronen bond de `<id>` aan de plugin die het veld declareert.

Vier losse punten uit de gatenlijst in sectie 4 van `docs/plugin-architecture.md`, elk in een eigen
commit en geschreven in de volgorde van klein naar groot risico:

| commit | punt |
| --- | --- |
| `21c9018` | **b.** het foutpaneel noemt `plugins.enabled` en waar die staat |
| `2d13863` | **c.** een hash die de workbench niet kan oplossen valt terug op de landingsroute en herschrijft de url |
| `7142b4f` | **a.** de zeven kopieën van de settings-loader staan nu in `app/settings_files.py`, met de soepele en de strenge variant naast elkaar |
| `a37d2ca` | **d.** een ingebouwde plugin mag ook een eigen stylesheet en een eigen icoonbestand declareren |
| `a2fc885` | **ronde 2:** één wortelcontrole voor beide velden (`static/src/shared/plugin-assets.js`), plus een toets dat een ingebouwde plugin alleen naar zijn eigen map wijst |

Het is geen fase uit het document maar opruimwerk na fase 5; de fasen zelf zijn klaar en gereviewd
(PR #17, #18 en #19).

## Te beoordelen

1. **Is de bevinding uit ronde 1 dicht?** Herhaal je metingen op `styles`: externe URL,
   protocol-relatief, absoluut pad, andermans map, `..` in elke codering. Klopt het dat icoon en
   stylesheet nu door dezelfde helper gaan, en is er een vorm die er voor één van de twee nog door
   komt? En bindt de nieuwe toets de `<id>` echt aan de plugin, of kan een view nog naar een
   buurmap wijzen zonder dat iets omvalt?
2. **Punt b — helpt het paneel nu echt?** Het paneel verschijnt in twee gevallen: de lijst komt niet
   aan, en de server weigert de lijst. Klopt de tekst in beide gevallen, staat er niets in dat alleen
   voor één van de twee waar is, en is de verwijzing naar de instelling concreet genoeg om iemand te
   laten vinden wat er fout is? Kijk ook naar de twee toetsen die de paneeltekst pinnen.
3. **Punt c — dekt de terugval de gevallen, en breekt hij niets?** Wat gebeurt er bij een deep link,
   bij een hashwijziging tijdens de sessie, bij een alias, bij terug/vooruit in de browser, en bij een
   klik in de sidebar? Let op de gebeurtenissen: een fragmentwijziging vuurt `hashchange` en niet in
   elke browser `popstate`, en de router raakt bij een popstate de url niet aan. Is de gekozen binding
   de juiste, en kan de terugval in een lus terechtkomen?
4. **Punt a — is het gedrag van de zes dienstmodules echt onveranderd?** Vergelijk de nieuwe
   `load_object` met wat er stond (de zes lichamen waren byte-identiek aan elkaar). Klopt het dat
   alleen de registratie de strenge variant gebruikt, en dat een kapotte JSON in een dienstbestand
   zich nog steeds gedraagt als voorheen? En zijn de twee varianten samen niet verwarrend: zou één
   functie met een argument beter zijn?
5. **Punt d — klopt de regel voor beide wortels?** Een pad-icoon is nu `plugin-static/<id>/…` voor een
   pakket en `src/plugins/<id>/…` voor een ingebouwde plugin. Is de wacht in `iconMarkup` voor beide
   even streng, is er een derde vorm die erdoorheen komt, en is het eerlijk dat de core een
   ingebouwd icoonpad niet controleert (het is core-code) terwijl de toetsen het bestaan wel eisen?
6. **Wat is er niet af?** Noem wat er van deze vier punten blijft liggen. Het splitsen van
   `css/app.css` is bewust een eigen beslissing; is dat de juiste grens, of had punt d zonder die
   splitsing niet afgekondigd moeten worden?

## Scopegrens

- **De fasen 1 tot en met 5 worden niet opnieuw gereviewd.** Alleen als dit werk iets over die code
  verandert of beweert dat niet klopt, is het een bevinding.
- **Het oordeel over de vier punten zelf is in ronde 1 gegeven**; deze ronde gaat over de verwerking
  van de bevinding en over wat die raakt.
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand** en falen ook op `main`.
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

De pytest-suite geeft 199 passed en 5 failures in `tests/test_replay_api.py`; die vijf falen ook op
`main`. De JS-suite heeft er een toets bij voor de twee iconvormen, en de browsercheck meet de
terugval op de landingsroute met een hashwijziging tijdens de sessie.

Controleer daarnaast zelfstandig:

- dat het API-oppervlak en de payload zonder pakketten identiek zijn aan die op `main`, op de
  `styles`-sleutel na;
- dat de browsercheck-rookproef op punt c ook echt iets vangt (haal de terugval weg en kijk wat
  omvalt);
- dat `load_object` en `load_object_or_raise` zich gedragen zoals de twee oude kopieën, met een
  handmatig settingsbestand per geval.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel in
`docs/reviews/pr-20-open-gaps-cleanup-review-findings-2.md`. Beantwoord expliciet of de bevinding
over `styles` dicht is en of de vier punten nu af zijn.
Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
