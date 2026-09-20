# Ontwerpreview — fase 4 in `docs/plugin-architecture.md`

- Branch: `feature/api-client-phase-4` @ `c5192dc`, tegen `main` @ `e2b0eda`
- Beoordeeld: `c5192dc` (`docs(plugins): leg het fase-4-ontwerp vast`), 59 toegevoegd / 7 verwijderd
- De branchdiff raakt uitsluitend `docs/plugin-architecture.md`; er is geen code gewijzigd, wat
  klopt met de statusregel ("op deze branch ontworpen en nog niet gebouwd")
- Dit is een ontwerpreview. Er is niets gewijzigd; elke bewering is nagemeten met de padanalyse uit
  `tests/test_plugin_registry.py`

**Verdict: approve with nits.**

Elk getal in de sectie klopt exact, en de kernclaim — dat de splitsing langs de bestaande
categoriegrenzen valt — is geen aanname maar een meetbaar feit. Twee padfamilies staan bij de
verkeerde plugin, en één verificatie-eis kan niet zoals hij beschreven staat. Alle drie zijn
tekstueel op te lossen vóór er een regel code voor geschreven wordt, en dat is precies waar een
ontwerpdocument voor is.

## Wat er klopt

Alle kwantitatieve beweringen nagemeten door per view de `api.<methode>()`-aanroepen te verzamelen
en naar categorie te herleiden:

| bewering in het document | gemeten |
| --- | --- |
| `api-client.js` heeft 101 methodes | 101 |
| 100 daarvan worden door views aangeroepen | 100 |
| `getTtsModels` wordt door geen enkele view aangeroepen | klopt, en het is de enige |
| vier methodes worden door meer dan één categorie aangeroepen | vier |
| `getModels` → image-pool, realtime-translation | exact |
| `getAdminModels` → llm-pool, translation-services | exact |
| `getTtsAdminModels` → realtime-tts, tts-pool | exact |
| `listTranslationPrompts` → realtime-translation, translation-services | exact |
| de overige 96 gaan naar één plugin | 96 |

En de dragende claim houdt ook: haal je die vier eruit, dan valt **elke** padfamilie op precies één
categorie. Geen enkele rest-methode wordt door twee categorieën gebruikt. De uitspraak *"dat blijkt
een schone verdeling langs de bestaande categorieën"* is daarmee aantoonbaar, niet hoopvol.

De beslissingslijn is bovendien consistent met fase 3: wat meer dan één categorie nodig heeft, is
van de core. Dat is dezelfde regel die daar op adressen werd toegepast, nu op methoden, en de
beslissingstabel noemt bij beide nieuwe regels het afgewezen alternatief met de reden. Sectie 6
vraag 2 is doorgestreept en beantwoord; vraag 1 blijft expliciet open. De statusregel klopt.

## Bevindingen

### Medium — twee padfamilies staan bij de verkeerde plugin

De sectie zegt dat de 96 gaan *"naar de plugin die ze gebruikt"*. Twee van de dertien genoemde
families volgen die regel niet:

| familie | document | gemeten aanroeper |
| --- | --- | --- |
| `/api/config` | llm-pool | **realtime-translation** — `getDefaultModel` wordt alleen door de replay-view aangeroepen |
| `/api/prompts` | realtime-translation | **translation-services** — `testTranslationPrompt` wordt alleen door prompt-library aangeroepen |

Bij `/api/prompts` is de herkomst herkenbaar: de router woont in
`app/realtime_translation/prompt_library/prompts.py`, dus hier is de backend-pakketnaam gevolgd in
plaats van de aanroepende categorie. Dat is dezelfde mismatch die in ronde 1 van PR #16 al is
vastgesteld — de view `prompt-library` hoort bij translation-services terwijl zijn router in het
realtime\_translation-pakket zit. Bij `/api/config` lijkt het eerder een semantische gok:
`default-model` klinkt als llm-pool, maar niemand in llm-pool roept het aan.

Waarom dit meer is dan een schrijffout: als fase 4 van deze lijst wordt gebouwd, krijgen twee
plugins een client die ze niet gebruiken en moeten twee views over een plugin-grens heen
importeren — wat de verificatie-eis twee regels verderop juist verbiedt (*"geen enkele view
importeert uit een andere plugin"*). De fout valt dan pas op als de toets erop staat, en het is
goedkoper om hem nu in de tabel te herstellen.

### Laag/medium — "elke view importeert nog precies één client" kan niet zoals beschreven

De vorm zet de vier gedeelde methoden in `static/src/shared/api/shared.js` en de rest in
`static/src/plugins/<id>/api.js`. Een view die zowel een gedeelde als een eigen methode aanroept,
importeert dan twee clients. Dat zijn er niet een paar maar **tien van de negentien** views die de
client gebruiken:

```
image-pool            image-train          gedeeld: getModels
llm-pool              chat                 gedeeld: getAdminModels
llm-pool              llm-pool-models      gedeeld: getAdminModels
llm-pool              text-generation      gedeeld: getAdminModels
realtime-translation  replay-translate     gedeeld: getModels, listTranslationPrompts
realtime-tts          replay-speak         gedeeld: getTtsAdminModels
translation-services  image-translation    gedeeld: getAdminModels, listTranslationPrompts
translation-services  pdf-translation      gedeeld: getAdminModels
translation-services  prompt-library       gedeeld: getAdminModels, listTranslationPrompts
tts-pool              tts-pool-models      gedeeld: getTtsAdminModels
```

Er zijn twee uitwegen en het document kiest er geen: óf de eis luidt "één plugin-client plus de
gedeelde", óf elke plugin-client her-exporteert wat zijn views uit `shared/` nodig hebben zodat de
view er werkelijk één importeert. Het tweede houdt de eis overeind en verbergt de core-client voor
de view, maar het is een ontwerpkeuze met gevolgen voor fase 5 — een plugin in een eigen pakket
moet dan weten wat hij mag her-exporteren. Dat hoort in dit document beslist te worden, niet
tijdens het bouwen.

### Nit — de prozalijst van padfamilies is niet compleet

De opsomming leest als uitputtend (*"`/api/image-pool` bij image-pool, `/api/translation` plus de
drie pdf-families bij translation-services, …"*) maar mist `/api/models`. Na aftrek van `getModels`
en `getAdminModels` blijven daar drie methodes over, alle drie alleen door llm-pool aangeroepen.
Geteld dekken de dertien genoemde families 93 van de 96; de ontbrekende drie zijn precies die
`/api/models`-rest.

## Wat ik niet als bevinding reken

- *"de noodoplossing die sectie 3 beschrijft"* — sectie 3 beschrijft de methode → pad-tabel
  neutraal als bewijsstap, niet als noodoplossing. Het gaat wel om hetzelfde mechanisme, en dat
  fase 4 het opheft klopt: liggen de paden na de splitsing in de subtree van de view, dan kan de
  tabel weg. Een waardeoordeel, geen onjuistheid.
- De verhuizing van `ReplayWebSocket` en `ReplaySpeakWebSocket` naar de plugin van hun view is
  juist: `session-controls.js` in replay (realtime-translation) en `replay-speak/index.js`
  (realtime-tts).
- Dat `getTtsModels` verdwijnt in plaats van mee te verhuizen is de juiste keuze en het document
  zegt erbij dat het gemeten is — dat klopt.

## Samenvatting

- Negen kwantitatieve beweringen, alle negen exact; de kernclaim over de schone verdeling is
  aantoonbaar.
- Te corrigeren vóór er code voor geschreven wordt: `/api/config` hoort bij realtime-translation en
  `/api/prompts` bij translation-services.
- Te beslissen, niet te ontdekken: of een view twee clients importeert of dat de plugin-client
  her-exporteert. De huidige verificatie-eis sluit de eerste uit terwijl de vorm hem oplegt.
- Aanvullen: `/api/models` in de prozalijst.
