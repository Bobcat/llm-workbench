# Review PR #18 — plugin-architectuur fase 4

- Branch: `feature/api-client-phase-4` @ `47bb2ab`, tegen `main` @ `e2b0eda`
- Beoordeeld: `67d3186` (de splitsing) en `7d3ca0a` (documentatie); `c5192dc`, `9508d6c` en
  `6d725ad` zijn het ontwerp, de ontwerpreview en de verwerking daarvan
- Uitgevoerd: alle 101 methodelichamen tekstueel vergeleken met `main`; de fetch-helper, de
  foutformatter en de twee websocket-klassen apart vergeleken; de verdeling per methode en per
  plugin nagemeten; vier mutaties op `ClientOwnershipTests` en de padanalyse, waaronder een
  indirecte cross-plugin import; het frontend- en serveroppervlak vergeleken met `main`; alle
  twintig routes in Chromium doorlopen met de console erbij; de drie suites
- Werkkopie schoon na afloop; mutaties teruggedraaid, worktree opgeruimd, geen servers blijven
  draaien

**Verdict: approve.**

De splitsing is een verhuizing en geen herschrijving, en dat is niet aannemelijk gemaakt maar
bewezen: alle honderd overgebleven methodelichamen zijn byte-identiek aan die op `main`. De
verdeling klopt tot op de methode, de nieuwe toetsen dragen de belofte, en het serveroppervlak is
onaangeroerd. Wat ik vond zijn drie tekstuele nits in het ontwerpdocument.

## 1. Is het een verhuizing?

Ja, aantoonbaar. Ik heb de methodelichamen uit `git show main:static/src/api-client.js` geëxtraheerd
en tegen de nieuwe modules gelegd, als tekst en niet op naam:

```
main: 101 methodes | nieuw: 100 methodes
alleen op main : ['getTtsModels']
alleen nieuw   : []
lichaam gewijzigd: 0
```

Geen enkel lichaam is aangeraakt. `getTtsModels` is de enige verdwijner, precies zoals het
document zegt.

Wat níet had mogen veranderen, is ook niet veranderd:

| onderdeel | resultaat |
| --- | --- |
| `formatApiErrorMessage` | byte-identiek |
| `fetchJson` | identiek op het toegevoegde `export` na |
| `const API_BASE = ''` | ongewijzigd |
| `ReplayWebSocket` | byte-identiek, nu in `static/src/plugins/realtime-translation/api.js` |
| `ReplaySpeakWebSocket` | byte-identiek, nu in `static/src/plugins/realtime-tts/api.js` |

De twee socketklassen zitten bij de plugin van hun view, zoals het ontwerp zegt.

## 2. Klopt de verdeling?

Ja, tot op de methode. Ik heb per view de `api.<methode>()`- en `sharedApi.<methode>()`-aanroepen
verzameld en herleid naar de categorie van die view:

- **methodes die niet bij hun aanroeper wonen: 0**;
- **gedeeld over meer dan één categorie: 4**, en exact `getAdminModels`, `getModels`,
  `getTtsAdminModels`, `listTranslationPrompts` — dezelfde vier als in het ontwerp;
- de twee correcties uit de ontwerpreview zijn toegepast: `getDefaultModel` woont in
  realtime-translation en `testTranslationPrompt` in translation-services, beide bij hun enige
  aanroeper.

De aantallen in de tabel van de fase-4-sectie kloppen ook allemaal, nageteld uit de bestanden zelf:

| categorie | document | geteld |
| --- | --- | --- |
| image-pool | 22 | 22 |
| translation-services | 40 | 40 |
| realtime-translation | 13 | 13 |
| video-pool | 7 | 7 |
| realtime-tts | 6 | 6 |
| llm-pool | 5 | 5 |
| tts-pool | 3 | 3 |
| core | — | 4 |
| **totaal** | **96** | **96 + 4 = 100** |

## 3. Dragen de eigendomstoetsen?

Ja, en ze zijn niet te makkelijk groen. `_client_owners` leunt op `_module_files`, dat de **hele**
relatieve importgraaf afloopt — niet alleen de directe imports van de view. Gemuteerd:

| mutatie | uitkomst |
| --- | --- |
| view importeert direct de client van een andere plugin | **faalt** — `test_no_view_imports_another_plugins_client` |
| view importeert die client **indirect**, via een eigen hulpbestand | **faalt** — dezelfde toets |

Dat tweede is het geval waar de prompt naar vraagt, en het wordt gevangen omdat de wandeling de
graaf volgt in plaats van één bestand te lezen.
`test_the_scan_finds_a_client_for_every_view_with_paths` is de controle op de controle: een view
die paden bouwt maar geen client binnenhaalt, valt om. Daarmee kan de eerste toets niet groen staan
doordat de scan niets vindt.

## 4. Is de padanalyse nog wat hij zegt?

Hij vangt nog steeds een pad dat niemand serveert:

| mutatie | uitkomst |
| --- | --- |
| `'/api/tts-pool/models/admin/gpu-memory'` → `'/api/nope/gpu-memory'` | **faalt**, twee tests |
| `/api/pdf-benchmark/results` → `/api/pdf-benchmark/verzonnen` | **faalt**, twee tests |

Het tweede is het scherpere geval: een verzonnen pad binnen een familie die verder wél bestaat,
wordt ook gevangen.

**Wat er doorheen glipt**, zoals de prompt vraagt te benoemen: alles ná de eerste `${...}`. Een
literal wordt daar afgekapt en als prefix gecontroleerd, dus een verkeerd segment daarachter valt
buiten beeld. Er zijn **42** van zulke paden in de nieuwe clients. Concreet aangetoond in
`static/src/plugins/image-pool/api.js`:

| mutatie | uitkomst |
| --- | --- |
| `.../models/admin/${modelName}/load` → `/laad` | **past — glipt erdoor** |
| `.../training/datasets/${datasetSlug}/files` → `/bestanden` | **past — glipt erdoor** |

Dit is inherent aan statisch lezen van een URL die uit template-delen wordt gebouwd, en het is
dezelfde grens die in ronde 4 van PR #16 is vastgesteld — niet iets dat deze fase introduceert.
Fase 4 verbetert wel wat hij belooft: de methode → pad-tabel is weg en de paden worden in de
subtree van de view zelf gelezen. De twee resterende templates met een variabele basis
(`` `${protocol}//${window.location.host}/ws/...` ``) zijn de websocket-URL's, en die hebben hun
eigen `_socket_paths`-helper.

## 5. Is de oppervlakte identiek?

Ja.

| | `main` | branch |
| --- | --- | --- |
| `/api`-paden die de voorkant aanroept | 53 | 52 |
| verschil | — | alleen `/api/tts-pool/models` eraf, niets erbij |
| serveroppervlak (`app.main.app`, pad + methoden) | | **identiek** |

Het ene verschil is `getTtsModels`, precies zoals de prompt voorspelt. Het endpoint zelf blijft
gemount — dat hoort, want deze fase raakt de endpoints niet.

## 6. Werkt de app nog?

Statisch én in de browser gecontroleerd.

Statisch: voor elke view is elke `api.X()`- en `sharedApi.X()`-aanroep een methode die werkelijk in
de client van zijn eigen plugin of in de core-client staat, en die client wordt ook geïmporteerd.
Geen enkele uitzondering. Dat is het foutbeeld dat een clientsplitsing typisch oplevert — een
aanroep die naar de verkeerde module verhuisde — en het komt niet voor.

In Chromium alle twintig routes aangeklikt met de console aan: elke view mount precies één kind,
geen foutpaneel, en **nul** `TypeError`, "is not a function" of `undefined`. Eén view
(`video-pool-models`) logt twee 503's; dat is een service die hier niet draait en geen codefout —
de paden die die view aanroept antwoorden los bevraagd met 200.

| suite | resultaat |
| --- | --- |
| `pytest` | 161 passed, 5 failed (de bekende replay-failures, ook op `main`) |
| `node --test` | 4 pass |
| browsercheck | exit 0 |
| documenttoets (regelverwijzingen) | 2 passed |

## Bevindingen

### Nit — de meting in sectie 3 is achterhaald

Sectie 3 zegt over de padanalyse: *"Gemeten over de 20 views levert de toets zoals hier beschreven
**0 paden voor `icons`** en **2 tot 15 paden voor de andere 19**."* Na deze fase klopt alleen het
eerste getal. Nagemeten met `_api_paths`:

```
icons: 0 paden | overige 19: 5 tot 25
laagste drie: tts-pool-models 5, video-generation 5, video-pool-models 5
```

De analyse leest sinds fase 4 de literals uit de subtree in plaats van een methodetabel, dus de
spreiding is verschoven. De alinea eronder erkent dat het mechanisme veranderde, maar de getallen
zijn niet opnieuw gemeten. Dat is jammer, want het zijn juist de getallen die het argument dragen
("wat precies is wat je wilt zien").

### Nit — sectie 3 stuurt de lezer naar een verwijderd bestand

In dezelfde sectie staat als instructie: *"Lees uit `static/src/api-client.js` de tabel methode →
pad; alle 101 methodes hebben een statisch pad."* Dat bestand bestaat niet meer. Drie alinea's
verderop staat de correctie — *"Tot fase 4 rustte deze toets op `api-client.js`; die tabel is er in
fase 4 uitgehaald"* — maar de instructie zelf is niet als verleden gemarkeerd. Wie de
fase-2-verificatie naleest, wordt eerst naar een bestand gestuurd dat er niet is.

De documenttoets vangt dit niet: die controleert `bestand:regel`-verwijzingen, en dit is een
bestandsnaam in lopende tekst.

### Nit — de scopegrens is strenger geformuleerd dan hij is

`docs/plugin-architecture.md:404`: *"geen wijziging aan de views buiten hun imports"*. Tien
viewbestanden wijzigden ook dertien aanroepregels, van `api.X()` naar `sharedApi.X()`:

```
chat, image-train, llm-pool, pdf-translation, replay-speak, text-generation,
translation-prompts, translation-requests, replay/model-options, replay/prompt-dialog
```

Die wijziging is noodzakelijk en volgt rechtstreeks uit de beslissing dat de plugin-client niets
her-exporteert — dat staat een paar regels hoger correct beschreven. Alleen de scopezin sluit hem
uit. "Buiten hun imports en de vier gedeelde aanroepen" dekt de lading.

## 7. Wat is er niet af?

Niets dat fase 4 had moeten doen. De scopegrens is verder houdbaar: de endpoints zijn onaangeroerd,
er is geen bundelstap bijgekomen en plugin-pakketten zijn terecht naar fase 5 geschoven. Dat
`/api/tts-pool/models` nu een endpoint is dat geen enkele view meer aanroept, is het bewuste gevolg
van het verwijderen van `getTtsModels` en staat in het document.

Wat na deze fase open blijft en niet van fase 4 was: de padanalyse verifieert nog steeds maar tot
de eerste placeholder. Nu de paden bij de plugins wonen, is dat de laatste plek waar een
frontendaanroep en een endpoint stil uit elkaar kunnen lopen. Het hoort in de gatenlijst van sectie
4, niet in deze fase.

## Samenvatting

- Verhuizing bewezen: 100 van 100 lichamen byte-identiek, helper en socketklassen ongewijzigd.
- Verdeling exact, inclusief de twee correcties uit de ontwerpreview; alle tabelgetallen nageteld.
- De eigendomstoets vangt ook de indirecte cross-plugin import; de padanalyse vangt een niet
  bestaand pad, ook binnen een bestaande familie.
- Oppervlak identiek op `/api/tts-pool/models` na; server onaangeroerd; geen runtimefouten over
  twintig views.
- Drie nits, alle drie in het document: een achterhaalde meting, een verwijzing naar een verwijderd
  bestand, en een scopezin die krapper is dan de diff.
