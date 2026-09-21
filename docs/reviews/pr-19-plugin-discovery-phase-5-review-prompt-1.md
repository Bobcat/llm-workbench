# Reviewprompt PR #19 — plugin-architectuur fase 5

Review PR #19, branch `feature/plugin-discovery-phase-5` tegen `main`, in
`/home/gunnar/projects/llm-workbench`.

Schrijf je bevindingen naar:

`docs/reviews/pr-19-plugin-discovery-phase-5-review-findings-1.md`

## Context

Fase 5 van de plugin-architectuur: een plugin kan in een eigen package leven. Het ontwerp is twee
keer gereviewd voordat er code kwam — `docs/reviews/plugin-architecture-phase-5-design-review.md`
(*changes requested*) en `...-design-review-2.md` (*approve with nits*) — en die punten zijn
verwerkt in `6d725ad`-achtige commits op deze branch (`ef90f68`, `b29ccd1`). Deze ronde gaat over de
**code**.

De branch bevat, in volgorde: het ontwerp en de twee reviewrondes daarop (`fb4cad9` t/m `b29ccd1`),
de backend (`7c7727f`), de voorkant (`db97d6f`) en de documentatie (`704884d`).

Wat er nu is:

- **Discovery** via de entry-point-groep `llm_workbench.plugins`. Een pakket levert een
  `PluginPackage`: de plugin zelf (`Plugin` met zijn `View`s en optionele `styles`) plus `static_dir`
  en `routers`.
- **De core mount alles**: de statische map op `/plugin-static/<id>/` vóór de catch-all, en de
  routers op de API. Een plugin mount nooit zelf.
- **Geweigerd bij het laden**, met de plugin of het entry point erbij: een ontbrekende `static_dir`,
  een view of icoon buiten de eigen mount, een dubbele plugin-id, een dubbele routenaam, een
  factory die gooit, en een entry point dat geen `PluginPackage` teruggeeft.
- **De voorkant** escapet de sidebar (`route`, `tooltip`, `name`, sectiekop), kent naast een
  sprite-id ook een pad-icoon onder de eigen mount, en linkt de stylesheets van een plugin.
- **De toetsen**: `tests/test_plugin_discovery.py` (14 tests, waarvan 2 end-to-end in een subprocess
  met echte entry-point-metadata) en de analyses in `tests/test_plugin_registry.py` kregen een
  wortel per view plus eigendom per plugin-wortel.

Lees eerst:

- `docs/plugin-architecture.md`, de fase-5-sectie en sectie 4/6
- `app/plugins.py` — het register, de discovery, de validatie en de payload
- `app/router.py` en `app/main.py` — het mounten van wat een pakket meebrengt
- `static/app.js` (`pluginItemMarkup`, `applyPluginStyles`) en `static/src/shared/icons.js`
- `tests/test_plugin_discovery.py` en de helpers in `tests/test_plugin_registry.py`
  (`_module_path`, `_plugin_roots`, `_client_owners`, `_api_paths`)

## Te beoordelen

1. **Is de discovery streng genoeg, en niet te streng?** Elke faalmodus uit de fase-5-sectie hoort
   een eigen toets te hebben; muteer ze en kijk wat erom valt. En: is er een configuratie die
   voorheen werkte en nu door de validatie geweigerd wordt?
2. **Draagt de adresregel?** Regel 2 ("een view gebruikt de core of zijn eigen plugin") moet door de
   analyses afgedwongen worden, ook voor een pakket buiten `static/`. Dat was het punt waar de
   tweede ontwerpronde op viel. Probeer een pakket-view die naar de client van een andere plugin
   grijpt, en kijk of de toets dat vindt — en of hij rood wordt als de wortel niet bestaat in plaats
   van stil groen.
3. **Is het escapen waterdicht voor deze fase?** De browsercheck meet één payload met markup. Zoek
   een veld of een pad waarlangs plugin-data ongeëscapet in de DOM komt, en kijk of het icoonpad de
   eigen mount kan verlaten.
4. **Klopt het serveren?** De mountvolgorde, `Cache-Control: no-cache`, 404 onder de mount in plaats
   van de shell, en een plugin-router die zonder de categorie aan toch gemount is.
5. **Is de end-to-end dekking echt?** Twee tests draaien in een subprocess met gefabriceerde
   entry-point-metadata. Is dat genoeg om "een geïnstalleerd pakket werkt" te geloven, of blijft er
   een gat tussen die fabricage en een echt `pip install`?
6. **Wat is er niet af?** Noem wat fase 5 had moeten doen en niet gedaan heeft, en of de scopegrens
   (geen isolatie van derden, de ingebouwde plugins blijven in de repo, geen hot reload of
   versiebeleid) houdbaar is nu de code er staat.

## Scopegrens

- **Fase 1 tot en met 4 worden niet opnieuw gereviewd.** Alleen als deze fase iets over die code
  beweert of verandert dat niet klopt, is het een bevinding.
- **De vijf falende tests in `tests/test_replay_api.py` zijn bestaand** en falen ook op `main`.
- **De ingebouwde plugins blijven in de repo.** Dat ze geen gebruikmaken van de nieuwe
  pakketmogelijkheid is een beslissing, geen omissie.
- Geen codewijzigingen: dit is een review, het artefact is het findings-document.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

De pytest-suite geeft 175 passed en 5 failures in `tests/test_replay_api.py`; die vijf falen ook op
`main`. Controleer dat zelf.

Controleer daarnaast zelfstandig:

- dat een echt pakket werkt: maak een map met een module en een `dist-info` met een entry point,
  zet die op `PYTHONPATH` en kijk wat `/plugins.js`, `/plugin-static/<id>/…` en de eigen
  `/api`-route doen (de test doet dit ook; doe het een keer met de hand, want daar zit de echte
  vraag);
- dat het API-oppervlak zonder pakketten identiek is aan dat op `main`;
- dat de payload zonder pakketten identiek is aan die op `main`, op de nieuwe `styles`-sleutel na.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel, in
`docs/reviews/pr-19-plugin-discovery-phase-5-review-findings-1.md`. Beantwoord expliciet of de
discovery streng en compleet is, of de adresregel nu werkelijk afgedwongen wordt, en of het escapen
en het serveren kloppen. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
