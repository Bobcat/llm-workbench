# PR 30 — Placement-kaders en vaste formuleobjecten, review 1

Review [llm-workbench PR 30](https://github.com/Bobcat/llm-workbench/pull/30), branch
`fix/pdf-placement-inspector` tegen `main`. Lees codecommit `bb565b8`;
de volgende documentatiecommit voegt alleen deze prompt toe. De codediff is
`fa60dc5..bb565b8`.

Wijzig alleen je bevindingenbestand:

`docs/reviews/pr-30-fix-pdf-placement-inspector-review-findings-1.md`

Begin met `APPROVED` of `CHANGES_REQUESTED`. Vermeld ernst, bestand/regel,
reproductie en gebruikersgevolg. Onderscheid een regressie van een bestaande
beperking. Toets ook of de beschrijving en het bewijs de claims dragen.

## Scope

De inspector tekent reflowable targets over meerdere bronregio's met losse
kaders, zodat een overgang tussen kolommen niet de hele pagina groen kleurt.
Fysieke formuleobjecten blijven zichtbaar zonder de checkbox voor andere vaste
objecten. Vaste objecten krijgen een paarse stippelrand. Selectie van een vaste
formule blijft behouden bij het omschakelen van de checkbox.

Alleen `static/src/workflows/pdf-translation/placement-plan.js`,
`static/css/workflows/omnidoc.css` en `tests/placement_plan_ui.mjs` wijzigen.
De API/artifactvorm en de PDF-plaatsing veranderen niet. Dit is de UI-tegenhanger
van de afzonderlijke translation-services placement-PR, geen tweede planner.

## Gerichte vragen

1. Zijn de getekende bronkaders juist voor meerdere kolommen, pagina's,
   referentiecontainers en meerdere fragmenten? Blijft selectie via de gedeelde
   target-ID werken? Kan de afbeelding inhoud buiten het target suggereren?
2. Blijven vaste én verplaatsbare formuleobjecten zichtbaar, terwijl de checkbox
   andere vaste objecten blijft bedienen? Kloppen dropdown, selectie en legenda?
3. Werkt de wijziging met bestaande artifacts en ontbrekende regio-informatie,
   zonder een fictieve backendgarantie te tonen?
4. Dekken de interactietest en Chromium-controle de bedoelde gebruikershandelingen?
   Onderscheid de gemockte Node-test van de echte browsercontrole.

## Verificatie

```bash
node tests/placement_plan_ui.mjs
node --test tests/js/*.test.mjs
.venv/bin/python -m pytest tests/test_pdf_translation_api.py tests/test_static_cache.py -q
```

Gemeten: de placement-interactietest slaagt, **12 JS-tests** en **5 Python-tests**
slagen. Chromium is met opgeslagen echte artifacts gecontroleerd. De screenshots
staan lokaal onder de translation-services repository in
`tmp/scientific-pdf-evidence/stack-restoration/page2-top.png`, `page3-top.png` en
`page3-bottom.png`; eerdere browserproeven staan in dezelfde evidence-root.

Bekende grens: rigid targets blijven één bounding rectangle gebruiken. Losse
fragmenten kunnen daardoor een smal kader over meerdere regels vormen. Blauwe
`withheld` kaders omvatten ook inline objecten met `with_text`; het is niet
hetzelfde als `page_fixed`. Deze PR verwijdert die overlappende weergavelagen niet.
Beoordeel wel of nieuwe labels of geometrie extra verwarring introduceren.

Geen modelcalls, serviceherstarts, fixturewijzigingen of aanpassingen aan de PDF
pipeline. Schrijf ontbrekend bewijs en beperkingen expliciet op.

## Samenhangende reviews

- [Bobcat/translation-services PR 141](https://github.com/Bobcat/translation-services/pull/141), branch `fix/pdf-scientific-translation`.
- [Bobcat/translation-services PR 142](https://github.com/Bobcat/translation-services/pull/142), branch `fix/pdf-placement-plan`.
