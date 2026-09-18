# Reviewprompt — plugin-registry: hardening na de eerste review

Review de branch `refactor/plugin-registry` tegen `main` in
`/home/gunnar/projects/llm-workbench`.

Schrijf de review naar:

`docs/reviews/plugin-registry-hardening.md`

## Context

De branch bestaat uit twee commits:

- `58739e0` — de sidebar en routeregistratie komen uit plugin-manifesten onder
  `static/src/plugins/` in plaats van uit hardcoded lijsten in `static/app.js`.
- `a9939ed` — de hardening: een mislukte view-load wordt zichtbaar, een koude
  route toont een placeholder, in-flight loads worden gedeeld, en het contract
  is als testsuite gecommit.

`58739e0` is al gereviewd; die review staat in
`docs/reviews/refactor-plugin-registry.md` en vond één medium-bevinding
(stille lege pagina bij een kapotte manifest-verwijzing) en drie kleine
(geen in-flight dedupe, geen loading-state, README achtergebleven), plus het
ontbreken van een gecommitte test.

Deze ronde beoordeelt of `a9939ed` die bevindingen correct en zonder scope creep
opheft, en of de hardening zelf geen nieuwe fouten introduceert.

Lees eerst:

- `docs/reviews/refactor-plugin-registry.md`
- `static/app.js`
- `static/src/plugins/registry.js`
- `tests/js/plugin-registry.test.mjs`
- `README.md` (Code Map, Runtime Model, Verification)

## Scopegrens

Bewust **niet** opgelost, omdat het gedrag is dat al vóór `58739e0` bestond.
Rapporteer deze niet als nieuwe bevindingen:

- de dubbele `host.innerHTML = ''` (`RouterCore.navigate()` doet het ook al);
- ongeëscapete interpolatie in de sidebar-markup met statische manifestdata;
- `replay-translate` dat in de shell special-cased is;
- `WORKFLOWS[0]` als impliciete defaultroute;
- de asymmetrie waarbij een alias bij een koude start uit de URL verdwijnt maar
  via popstate blijft staan;
- het ontbreken van `__onActivate` in `pdf-anatomy` en `translation-prompts`;
- het handmatige `PLUGINS`-array in `registry.js` (backend-discovery is een
  latere stap);
- het ongebruikte manifestveld `id` (gereserveerd voor die latere stap).

Ook buiten scope: backend-wijzigingen, nieuwe features, per-plugin CSS of
iconen, en het aanpassen van de view-modules zelf. De diff raakt geen `.py`-bestand.

## Te beoordelen

- Wordt een mislukte load in **elk** pad zichtbaar, of blijft er een pad over
  waarin de fout alsnog stil verdwijnt — bijvoorbeeld wanneer de generatie-
  teller intussen is opgehoogd?
- Klopt de dedupe: kan één view nog twee keer geconstrueerd worden bij weg- en
  terugklikken tijdens een koude load, en kan een mislukte load opnieuw
  geprobeerd worden?
- Is de placeholder nooit zichtbaar voor een al geïmporteerde module, en blijft
  hij niet staan wanneer de load faalt?
- Is de snelle route — een gecachete persistente view — echt synchroon en
  ongewijzigd gebleven?
- Dekt `tests/js/plugin-registry.test.mjs` het contract, of is de test
  tautologisch? Let op: de verwachte categorieën en routes staan als lijst in de
  test, terwijl de registry ze uit de manifesten afleidt. Bepaal of dat een echte
  pariteitscontrole is of een tweede kopie die net zo goed kan afwijken.
- Faalt de suite **daadwerkelijk** bij een rename? Doe een mutatie: wijzig tijdelijk
  een `factory` in één manifest, draai de suite, en revert. Rapporteer het
  resultaat.
- Wordt de icooncontrole uitgevoerd en niet stil overgeslagen wanneer
  `static/assets/icons.svg` ontbreekt of geen `<symbol>` bevat?
- Zijn er stille faalwijzen over: een module die wél importeert maar waarvan de
  factory tijdens de aanroep gooit?
- Is de README nu accuraat op de punten die deze branch raakt?
- Zijn de commit messages weer accuraat over hun eigen werk, inclusief de claims
  over verificatie?
- Is er scope creep: is er iets aangeraakt dat buiten de drie hierboven genoemde
  bevindingen valt?

## Verificatie

Op deze host **is** Node aanwezig (v24.21.0), in tegenstelling tot wat de vorige
reviewprompt aannam. Draai:

```bash
node --test 'tests/js/**/*.test.mjs'
node --input-type=module --check < static/app.js
./.venv/bin/python -m pytest tests
```

De Python-suite geeft 116 passed en 5 failures in `tests/test_replay_api.py`.
Die vijf falen ook op `main` (ontbrekende replay-prompts in de draaiende
translation-services) en deze diff raakt geen Python. Controleer dat zelf en
schrijf niet af dat ze buiten de diff vallen.

Voor het gedrag in de browser: start de app op een vrije poort, bijvoorbeeld

```bash
./.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8099
```

Playwright met Chromium is beschikbaar in `.venv`. Intercepteer de request naar
een view-module om de twee nieuwe paden deterministisch te testen:

- houd de request tegen en controleer dat `.workflow-loading` verschijnt en
  daarna de view;
- breek de request af en controleer dat `.workflow-error` verschijnt met de
  viewnaam en het modulepad, en dat dit het enige in de host is;
- klik weg en terug terwijl de request nog vastgehouden wordt, laat dan los, en
  controleer dat er precies één view in de host staat zonder foutpaneel.

Een eerdere doorloop met deze drie scenario's plus alle 20 routes, de vier
aliassen, persistentie en themawissel slaagde, maar die doorloop zit niet in de
repo. Reproduceer hem of zeg expliciet dat je dat niet gedaan hebt.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel. Beoordeel expliciet of de
medium-bevinding uit de vorige review nu afdoende is opgelost. Eindig met één
verdict:

- approve;
- approve with nits;
- changes requested.
