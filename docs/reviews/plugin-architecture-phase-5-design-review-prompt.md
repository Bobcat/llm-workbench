# Reviewprompt — ontwerp fase 5: discovery buiten de repo

Review het fase-5-ontwerp in `docs/plugin-architecture.md` op branch
`feature/plugin-discovery-phase-5` (commit `fb4cad9`), tegen `main` (`06112cd`), in
`/home/gunnar/projects/llm-workbench`.

Dit is een **ontwerpreview, geen codereview**. Er hoeft geen code te veranderen; de branch raakt
alleen het document.

Schrijf de review naar:

`docs/reviews/plugin-architecture-phase-5-design-review.md`

## Context

Fase 1 tot en met 4 staan op `main`. De sidebar komt uit `app/plugins.py`, de core bezit en mount
alle adressen, categorieën zijn per installatie aan of uit te zetten via `plugins.enabled`, en sinds
fase 4 heeft elke plugin zijn eigen API-client met een dunne gedeelde kern.

Fase 5 moet een plugin in een **eigen package** mogelijk maken: discovery via pip entry points. Het
ontwerp op deze branch beschrijft wat een pakket aanlevert, hoe de core dat serveert, hoe botsingen
worden geweigerd, en — als antwoord op de open vraag uit sectie 6 — dat een plugin zijn eigen
adressen mag meebrengen met drie regels. Dat antwoord is van Gunnar: *"lijkt me wel; wat houdt het
tegen? enkel dat views uit andere plugins dat adres dan niet kunnen gebruiken, en als het nuttig is
kan het adres altijd nog naar de core verhuizen."* Het ontwerp maakt daar een toets van in plaats van
een intentie.

De fase-4-review (`docs/reviews/pr-18-api-client-phase-4-review-findings-1.md`) eindigde op approve;
de ontwerpreview van fase 4 staat in `docs/reviews/plugin-architecture-phase-4-design-review.md`.

Lees eerst:

- `docs/plugin-architecture.md`: de fase-5-sectie, sectie 2 (het registercontract), sectie 4 (de
  gaten, waarvan twee nu "beslist in fase 5" zeggen) en sectie 6
- `app/plugins.py` — de registratie, de schakelaar en de payload
- `app/router.py` en `app/main.py` — de core die alles mount, en de catch-all statische mount
- `static/src/plugins/registry.js`, `static/src/shared/icons.js` en `static/app.js`
  (`pluginItemMarkup`, `renderWorkflows`)
- `tests/test_plugin_registry.py` — vooral `CoreMountTests`, de padaanalyse en
  `ClientOwnershipTests`

## Te beoordelen

1. **Verifieer elke feitelijke bewering in de fase-5-sectie tegen de code.** Denk aan: dat een mount
   vóór de catch-all moet, dat `module` tegen `document.baseURI` wordt opgelost en of een absoluut
   pad daarmee werkt, dat `iconMarkup` nu een sprite-id eist en wat een pad zou veranderen, en dat de
   payload zonder entry points identiek blijft aan die van fase 4. Rapporteer elke bewering die
   onjuist, onverifieerbaar of optimistisch is. Dit is het belangrijkste onderdeel.
2. **Kan het contract dit dragen?** Een pakket levert `static_dir`, `routers` en `styles`. Is dat
   genoeg voor een echte plugin, en klopt het met de velden die sectie 2 beschrijft? Waar loopt de
   loader vast — bijvoorbeeld bij een plugin die onder een subpad wordt geserveerd, of bij een view
   waarvan de module niet naast de rest van het pakket ligt?
3. **Is de adresregel afdwingbaar zoals hij er staat?** Regel 2 ("een view gebruikt de core of zijn
   eigen plugin") moet door de padaanalyse gedragen worden. Kan die dat, gegeven hoe de analyse nu
   werkt? En wat kost regel 3 ("een gedeeld adres verhuist naar de core") concreet — is dat een
   verhuizing of een herschrijving?
4. **Is de trust-grens eerlijk?** "Alleen first-party" staat er met een reden. Klopt die reden, en
   sluit het escapen in `pluginItemMarkup` het gat uit sectie 4 of verplaatst het hem?
5. **Noem wat er ontbreekt.** Denk aan faalmodes die het ontwerp niet noemt: een pakket waarvan
   `static_dir` niet bestaat, een entry point dat bij het laden een fout geeft, twee entry points uit
   hetzelfde pakket, een plugin-id die alleen in zijn routenamen botst, een pakket dat verdwijnt
   terwijl het in `plugins.enabled` staat, de volgorde en stabiliteit van discovery, en wat er met
   `styles` gebeurt als een categorie uit staat.
6. **Is de afbakening goed?** Zit per-plugin CSS en iconen terecht in deze fase, en is "de ingebouwde
   plugins blijven in de repo" een verdedigbare grens of een uitstel dat de fase hol maakt?

## Scopegrens

- **Fase 1 tot en met 4 worden niet opnieuw gereviewd.** Ze zijn gereviewd en hun bevindingen zijn
  verwerkt; alleen als het fase-5-ontwerp iets over die code beweert dat niet klopt, is het een
  bevinding.
- **De gatenlijst in sectie 4 is gegeven.** Rapporteer die niet opnieuw; beoordeel wel of de twee
  beslissingen die er nu in staan ("weigeren bij het laden" en "escapen") de juiste zijn.
- **Geen implementatievoorstel in detail.** Een richting aangeven mag; een uitgewerkt ontwerp van de
  code is niet gevraagd.
- **Geen codewijzigingen.** Het document is het artefact.

## Verificatie

Node is aanwezig (v24.21.0), Playwright met Chromium zit in `.venv`.

```bash
./.venv/bin/python -m pytest tests
node --test 'tests/js/**/*.test.mjs'
./.venv/bin/python tests/browser/check_plugin_registry.py
```

De pytest-suite geeft 161 passed en 5 failures in `tests/test_replay_api.py`; die vijf falen ook op
`main`. Controleer dat zelf in plaats van het aan te nemen.

Controleer daarnaast zelfstandig:

- dat `PLUGINS` in `app/plugins.py` nog de enige lijst is en dat er niets is dat nu al naar discovery
  verwijst;
- dat de mount in `app/main.py` inderdaad een catch-all is, en wat er gebeurt als een plugin-map
  daarvóór wordt gemount (probeer het gerust in een throwaway checkout);
- dat een absoluut `module`-pad door de loader wordt geresolveerd zoals het ontwerp zegt.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel in
`docs/reviews/plugin-architecture-phase-5-design-review.md`. Beantwoord expliciet of het ontwerp
fase 5 kan dragen, of de adresregel afdwingbaar is, en of de trust-grens en de afbakening houdbaar
zijn. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
