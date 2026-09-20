# Reviewprompt — ontwerp fase 5, ronde 2

Review het herziene fase-5-ontwerp in `docs/plugin-architecture.md` op branch
`feature/plugin-discovery-phase-5` (commit `ef90f68`), tegen `main` (`06112cd`), in
`/home/gunnar/projects/llm-workbench`.

Dit is **ronde 2**. Ronde 1 (`docs/reviews/plugin-architecture-phase-5-design-review.md`) eindigde op
*changes requested*, beperkt tot drie contractpunten plus twee kleinere punten en een nit. Alles is
verwerkt in `ef90f68`; de diff `55be50f..ef90f68` is precies die verwerking. `294e6fc` legt alleen
het reviewbestand van ronde 1 vast.

Dit is weer een **ontwerpreview, geen codereview**: er hoeft geen code te veranderen.

Schrijf de review naar:

`docs/reviews/plugin-architecture-phase-5-design-review-2.md`

## Wat er sinds ronde 1 veranderd is

| punt uit ronde 1 | wat er nu staat |
| --- | --- |
| de padanalyse kan regel 2 niet afdwingen (medium) | de analyse krijgt **per view een wortel**: `static/` voor ingebouwde plugins, `static_dir` van de plugin voor een gevonden plugin; een wortel die niet bestaat laat de toets vallen in plaats van hem stil over te slaan. De JS-suite krijgt dezelfde wortel, met de `path.join`-meting erbij |
| een absoluut `module`-pad geeft de subpad-eigenschap op (laag/medium) | het `module`-pad van een plugin is nu **relatief** (`plugin-static/<id>/view.js`), met jouw meetresultaten als tabel in het document; de servermount blijft absoluut |
| `icon` als pad opent een vierde injectiepunt (laag/medium) | het icoon gaat mee in dezelfde beweging: alleen een relatief pad onder de eigen mount, vorm gecontroleerd én geëscapet, met de `iconMarkup`-wacht als reden |
| `styles` past niet in de payloadpin (laag) | staat er nu bij als bewust gevolg: `styles` is een pluginsleutel en de pin in `test_payload_carries_only_frontend_data` verandert mee |
| ontbrekende faalmodes (laag) | vier gevallen met een expliciete keuze: ontbrekende `static_dir`, een gooiend entry point, twee entry points uit één pakket, en de volgorde binnen discovery (gesorteerd op plugin-id, want `WORKFLOWS[0]` is de landingsroute) |
| sectie 6 heet "Nog open" maar heeft niets open (nit) | de sectie heet nu "Open vragen", zegt dat er niets meer open staat, en noemt wat er bewust buiten blijft met de reden |

## Te beoordelen

1. **Is elk punt uit ronde 1 echt afgehandeld?** Meet het opnieuw in plaats van het aan te nemen.
   Voor de padanalyse: probeer een view met een module buiten `static/` en kijk of de analyse hem
   vindt, en of een opzettelijk kapotte wortel de toets laat vallen in plaats van hem over te slaan.
2. **Is de wortel-per-view uitvoerbaar zoals hij beschreven staat?** De helpers in
   `tests/test_plugin_registry.py` halen hun invoer nu uit `STATIC / view.module`. Wat vraagt het om
   daar een wortel per view van te maken, en klopt de bewering dat dezelfde wandeling op een
   `static_dir` buiten `static/` werkt? Noem het als er iets ontbreekt dat het ontwerp niet zegt.
3. **Is het relatieve `module`-pad overal consequent?** Staat er nog ergens in het document dat
   `module` een pad onder de statische root is, of dat het absoluut is? En klopt de combinatie
   "relatief pad in de payload, absolute mount aan de serverkant" onder een subpad?
4. **Is de icoonregel compleet en consistent?** Vormcontrole plus escapen, en wat betekent dat voor
   de JS-toets die elke view-icoon in de sprite controleert en voor de ingebouwde plugins?
5. **Is sectie 6 nu eerlijk?** Staat er wat er te kiezen viel, en is "wat er bewust buiten blijft"
   dezelfde lijst als de scopegrens van fase 5, of lopen die twee nu uiteen?
6. **Is er door de herziening iets nieuws stukgegaan of tegenstrijdig geworden?** Het document is
   één geheel; een keuze die in de fase-5-sectie is bijgewerkt hoort ook in sectie 2, 4 of 6 te
   kloppen.

## Scopegrens

- **Fase 1 tot en met 4 worden niet opnieuw gereviewd.** De fase-4-uitkomst staat in
  `docs/reviews/pr-18-api-client-phase-4-review-findings-1.md`.
- **Geen codewijzigingen.** Het document is het artefact.
- **Geen implementatievoorstel in detail.** Een richting aangeven mag.
- De gatenlijst in sectie 4 is gegeven; beoordeel wel of de twee beslissingen die daar staan nog
  kloppen met de herziene fase-5-sectie.

## Verificatie

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

De pytest-suite geeft 161 passed en 5 failures in `tests/test_replay_api.py`; die vijf falen ook op
`main`. Controleer dat zelf.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel in
`docs/reviews/plugin-architecture-phase-5-design-review-2.md`. Beantwoord expliciet of de drie
contractpunten uit ronde 1 nu wel kloppen, en of het ontwerp klaar is om gebouwd te worden. Eindig
met één verdict:

- approve;
- approve with nits;
- changes requested.
