# Code-review llm-workbench PR #2 — PDF-vectorfallback als renderoptie

- Base: `main` @ `69bcbd7`
- Head: `feature/pdf-vector-fallback-option` @ `07b953a`
- Eerste ronde: `1d34ae1` (`Expose PDF vector fallback option`; 45 regels in
  `static/src/workflows/pdf-translation/index.js`) — Tweede ronde: `07b953a`
  (`Close PDF fallback option review findings`; 12 regels in hetzelfde bestand)
- Uitgevoerd: de volledige diff en de omliggende code gelezen; `README.md` en `docs/README.md`
  nagekeken op vermeldingen van de renderopties; **de gewijzigde module echt geladen en
  geïnstantieerd in headless Chromium** en de nieuwe `<select>` uit de opgebouwde DOM gelezen;
  `lifecycleErrorMessage` en de outputregel-logica in diezelfde browser uitgevoerd op vijf
  respectievelijk vijf payloadvormen; de foutvorm van de service tegen `RequestLifecycle`
  gecontroleerd in de servicerepo; de Python-suite op deze branch én op `main` gedraaid
- Er is geen Node-runtime op deze host, dus geen aparte JS-parser of frontendtestsuite. Chromium
  is wel gebruikt als JS-engine, wat meer is dan een syntaxcontrole: de module is
  geïmporteerd en de view is opgebouwd
- Python-suite: **110 passed, 5 failed** op deze branch, en **exact dezelfde 5 failed, 110
  passed** op `main`. De diff raakt geen enkel `.py`-bestand
  (`git diff --stat main...HEAD -- '*.py'` is leeg), dus de failures zijn aantoonbaar bestaand en
  staan los van deze PR

**Status: beide bevindingen en de nit zijn verwerkt en nageteld. Verdict herzien naar
approve — zie *Tweede ronde* onderaan.**

**Verdict eerste ronde: approve with nits.** De optie is netjes ingepast: `reject` is zichtbaar én technisch
de default, submit en rerender lezen dezelfde bron, de select wordt met de andere renderopties
uitgeschakeld, en een wijziging op een voltooid document gaat door de bestaande cached
rerenderweg zonder nieuwe workflow. De nieuwe statusregel toont bij beide weigerpoorten zowel de
foutcode als de reden. Eén bevinding zou ik voor de merge willen zien: de outputregel verliest
de weigerreden zodra de service het veld `pdf_output_mode_requested` niet stuurt — en dat is
vandaag de situatie, want dat veld bestaat alleen op een nog niet gemergede servicebranch.

## Bevindingen eerste ronde

### ~~Medium~~ opgelost in `07b953a` — de Output-regel laat de weigerreden vallen tegen een service zonder `pdf_output_mode_requested`

`outputRouteRow` (`static/src/workflows/pdf-translation/index.js:479-492`) is van

```js
if (declined) {
  detail = `raster — vector declined: ${declined}`;
```

veranderd in

```js
const requested = String(doc.pdf_output_mode_requested || mode);
...
if (mode === 'raster' && requested === 'vector' && (declined || engineDeclined.length)) {
```

Ontbreekt `pdf_output_mode_requested`, dan valt `requested` terug op `mode` — dus op `raster` —
en is de conditie onwaar. De reden verdwijnt dan uit de regel. Uitgevoerd in Chromium op vijf
payloadvormen:

| responsevorm | Output-regel |
|--------------|--------------|
| nieuwe backend, late decline + raster | `raster — vector declined: PDF_TRANSLATED_PLAN_PAGE_CLASS_UNSUPPORTED` |
| nieuwe backend, vroege decline + raster | `raster — vector declined: document has pages this route cannot take (mystery)` |
| directe rasteraanvraag | `raster` |
| **alleen `vector_declined`, geen `requested`** | **`raster`** |
| vectorroute gelukt | `vector — …` |

De vierde rij is het probleem, en hij is geen hypothese: `pdf_output_mode_requested` komt in de
servicerepo **nul keer** voor op `main` en alleen op de nog openstaande branch
`feature/pdf-vector-fallback-policy`. Landt deze workbench-PR eerder dan die servicewijziging,
dan toont het paneel voor élk geweigerd document alleen nog `raster`, terwijl het vandaag
`raster — vector declined: …` toont. Dat is een regressie op bestaand gedrag, precies op de
regel die het commentaar erboven beschrijft als de reden dat deze regel bestaat: "a silent fall
back to raster would look like the flag doing nothing".

Kleinste eerlijke fix: laat de `requested === 'vector'`-voorwaarde weg. Zij voegt niets toe —
`vector_declined` wordt alleen gezet wanneer de vectorroute is gevraagd (de servicekant zet het
uitsluitend als `mode === "vector"`), en `pdf_engine_declined` bestaat alleen na een
vectorpoging. De conditie `mode === 'raster' && (declined || engineDeclined.length)` dekt beide
backendversies.

### ~~Laag~~ opgelost in `07b953a` — na een weigering doet het omzetten naar `raster` niets, en zegt ook niets

Dit is precies de vervolgstap die de nieuwe foutmelding uitlokt: je leest "vector PDF output is
unsupported for this document", je zet Vector fallback op `raster`, en er gebeurt niets.

De changelistener op de select roept `rerenderRequest` aan (`:1417`), en die begint met
`if (!canReenter()) return;`. `canReenter()` (`:502-504`) eist
`currentState() === 'completed'`. Een geweigerd verzoek staat op `failed`, dus de functie keert
stil terug: geen request, geen statusregel, geen zichtbaar verschil. De gebruiker moet zelf
bedenken dat het document opnieuw ingediend moet worden.

Ik stel niet voor om een rerender op een failed request toe te staan — of daar artifacts voor
bestaan is een servicevraag. Het kleinste dat het gat dicht is een statusregel in de
`!canReenter()`-tak wanneer de state `failed` is, in de trant van "submit the document again to
apply the new render options".

### ~~Nit~~ deels opgelost in `07b953a` — dat de optie niets doet bij een directe rasteraanvraag staat alleen in de tooltip

De `title` op de select zegt het expliciet: "This setting does nothing when Output is already
raster." Dat is de juiste tekst, maar hij is alleen zichtbaar bij hoveren, en er is geen
zichtbare koppeling met de Output-select ernaast — de fallback-select blijft actief en
onveranderd wanneer Output op `raster` staat. Dat is consistent met de buur-optie Structure
tree, die op dezelfde manier "Vector route only" in haar tooltip zet, dus ik zou er geen
patroonbreuk voor maken. Wel het noemen waard omdat de reviewprompt er expliciet naar vraagt.

## Wat aantoonbaar klopt (eerste ronde)

**`reject` is zichtbaar én technisch de default — gemeten in een echte DOM.** Ik heb de module
in Chromium geïmporteerd en `createPdfTranslationView()` aangeroepen:

```
MODULE OK — exports: createPdfTranslationView
view aangemaakt: ja
#pdfVectorFallback gevonden: value="reject" opties=["reject","raster"]
                             geselecteerd-attribuut=["reject"] disabled=false
```

De `selected` staat op `reject` in de markup (`:110`), de opgebouwde select levert `"reject"` als
waarde, en de leesfunctie valt bovendien nog eens terug met
`String(vectorFallbackSelect.value || 'reject')` (`:466`). Drie lagen, alle drie `reject`.
Terzijde: dit bevestigt ook dat de gewijzigde ES-module zonder fout laadt — sterker dan een
syntaxcontrole, want de view wordt daadwerkelijk opgebouwd.

**Submit en rerender sturen exact dezelfde waarde.** `pdf_vector_fallback` is toegevoegd aan
`renderFlags()` (`:458-471`), de functie waarvan het commentaar zegt: "one reader for both the
initial submit and the re-render, so the two can never drift apart". Beide callers gebruiken
hem: de submit via `Object.assign(payload, translatorFields(model), renderFlags())` (`:552`) en
de rerender via `api.rerenderPdfRequest(sourceRequestId, renderFlags())` (`:569`). Er is geen
tweede plek waar de payload wordt opgebouwd.

**De optie wordt met de andere renderopties uitgeschakeld.** `vectorFallbackSelect.disabled =
isBusy` staat in dezelfde `setBusy`-tak als `outputModeSelect`, `structureModeSelect` en de rest
(`:444`), tussen de buren waar zij hoort.

**Een wijziging op een voltooid document gebruikt de bestaande cached rerender.** De select is
toegevoegd aan de bestaande lijst die `rerenderRequest` als changelistener krijgt (`:1417`), en
die weg is ongewijzigd: `canReenter()` eist een voltooid document, en het commentaar erboven
beschrijft precies het bedoelde gedrag — "re-render every page of the shown result from its
cached per-page translations with the new flag — no new translation". Met niets geladen rijdt de
waarde gewoon mee op de volgende vertaling. Er komt geen nieuwe route, workflow of endpoint bij.

**De statusregel toont code én reden, voor beide poorten.** `lifecycleErrorMessage` (`:721-733`)
uitgevoerd in Chromium op vijf foutvormen:

| foutvorm | statusregel |
|----------|-------------|
| vroege poort (`vector_declined`) | `vector PDF output is unsupported for this document [PDF_VECTOR_OUTPUT_UNSUPPORTED] — document has pages this route cannot take (mystery)` |
| late poort (`pdf_engine_declined`) | `… [PDF_VECTOR_OUTPUT_UNSUPPORTED] — PDF_TRANSLATED_PLAN_PAGE_CLASS_UNSUPPORTED` |
| gewone fout met code | `KeyError: x [PIPELINE_FAILED]` |
| fout zonder code | `boom` |
| leeg errorobject | `request failed` |

Beide capabilitypoorten leveren dus de stabiele foutcode plus de reden, en de degradatie bij
ontbrekende velden is netjes: geen `undefined`, geen lege haakjes, geen dubbele code wanneer
code en message gelijk zijn.

De gelezen vorm klopt met wat de service werkelijk stuurt. In de servicerepo bouwt
`RequestRuntime` bij een `RequestRejected` het record op als
`{"code": …, "message": …, "details": {…}}` (`app/runtime/service.py:727-729`) en
`RequestLifecycle` draagt dat als top-level `error`-veld (`app/core/schemas.py:204`). De
frontend leest `result.error.code`, `.message` en `.details.vector_declined` /
`.details.pdf_engine_declined` — precies die sleutels.

**De drie nieuwe foutmeldingen zitten op de juiste plaatsen en laten geen state achter.** In de
rerenderhandler volgt `isRerendering = false` in hetzelfde blok (`:581`); in de submithandler is
`isRerendering` niet in het spel; in de pollinghandler wordt hij expliciet gereset vóór de
melding (`:653`), en de nieuwe `failed`-tak staat vóór de bestaande `else if (isRerendering)`,
zodat een mislukte rerender de lifecyclefout toont in plaats van het generieke "Re-render
failed."

**De ruwe lifecycle-response blijft volledig beschikbaar.** `applyLifecycle` schrijft nog steeds
`rawEl.value = JSON.stringify(result || {}, null, 2)` (`:730`), ongewijzigd. De
`details.issues`-lijst met `page_index`, `group_index` en `reason_code` per item staat daarmee
in het raw-veld, ook al vat de statusregel alleen de codes samen.

**Geen enkel spoor van editorfunctionaliteit.** De diff bevat geen `contenteditable`, geen
editor-, draft- of revisiestructuur; hij voegt één `<label>` met één `<select>` toe en raakt
verder alleen de rapportagefuncties. Geen nieuwe route, geen nieuw scherm, geen backendwijziging.

**Documentatie loopt niet achter.** `README.md` en `docs/README.md` noemen de individuele
renderopties niet, dus er is niets dat door deze toevoeging onjuist wordt.

## Open vragen en aannames (eerste ronde)

- De reviewprompt schrijft de vijf Python-failures toe aan een ontbrekende serviceprompt
  `translate_realtime_first`. Ik heb dat niet kunnen bevestigen: de fout die ik zie is
  `KeyError: 'session_id'` op `tests/test_replay_api.py:149`, na een create-sessionaanroep. Wat
  ik wél heb vastgesteld is het punt dat telt — dezelfde vijf falen identiek op `main`, en de
  diff raakt geen Python.
- Ik ben ervan uitgegaan dat de workbench altijd tegen een service praat waarvan de versie niet
  gepind is. Als er wel een versiegrens bestaat die de servicebranch afdwingt, is de eerste
  bevinding alleen een kwestie van mergevolgorde in plaats van een regressie.
- De handmatige browsercontroles uit de verificatieopdracht (vijf scenario's tegen een draaiende
  service) heb ik niet uitgevoerd: daarvoor is een live service met een geweigerd document
  nodig. Ik heb in plaats daarvan de twee beslisfuncties met de echte payloadvormen in een
  browser uitgevoerd en de DOM-opbouw gemeten.

## Resterende risico's (eerste ronde)

- **Mergevolgorde.** Deze PR leest twee velden die de service alleen op een openstaande branch
  stuurt: `pdf_output_mode_requested` en `pdf_engine_declined`. Het tweede degradeert netjes
  (het is er gewoon niet en de oude `vector_declined`-weg blijft over); het eerste degradeert
  niet netjes, zie de eerste bevinding.
- **Er is geen frontendtest.** De hele controle van dit paneel hangt op handmatige stappen; er
  is in deze repo geen JS-testsuite en op deze host geen Node om er een te draaien. Wat ik in
  Chromium heb uitgevoerd is reproduceerbaar maar staat niet in de repo.

## Tweede ronde — `07b953a`

- Uitgevoerd: de fixdiff gelezen; de gecorrigeerde outputregel-logica opnieuw in headless
  Chromium uitgevoerd op dezelfde vijf payloadvormen; de module opnieuw geladen en de view
  opgebouwd; de tooltip van de Output-select uit de opgebouwde DOM gelezen
- De Python-suite is niet opnieuw gedraaid: de diff raakt opnieuw geen `.py`-bestand

**Verdict tweede ronde: approve.**

### De outputregel geeft de reden terug, ook aan een oudere service

De voorwaarde `requested === 'vector'` is weg; wat overblijft is
`mode === 'raster' && (declined || engineDeclined.length)`. Opnieuw uitgevoerd in Chromium op
dezelfde vijf vormen als in de eerste ronde:

| responsevorm | eerste ronde | nu |
|--------------|--------------|-----|
| nieuwe backend, late decline | reden | reden |
| nieuwe backend, vroege decline | reden | reden |
| **alleen `vector_declined`, geen `requested`** | **`raster`** | **reden** |
| directe rasteraanvraag | `raster` | `raster` |
| vectorroute gelukt | vectorrapport | vectorrapport |

De derde rij is de bevinding: die toont nu weer
`raster — vector declined: document has pages this route cannot take (mystery)`. De twee andere
declinevormen en de twee niet-decline-vormen zijn ongewijzigd, dus de fix is precies zo smal als
hij moest zijn. Daarmee is de mergevolgorde ook geen risico meer: het paneel werkt tegen de
huidige service én tegen de versie met `pdf_output_mode_requested`.

### Een weigering geeft nu wél een vervolgstap

`rerenderRequest` keert niet langer stil terug: bij `!isBusy && currentState() === 'failed'`
zet hij "Choose the PDF again to apply the changed render options." als foutstatus. Dat is
precies de ontbrekende schakel — je leest de weigering, je zet Vector fallback op `raster`, en
je krijgt te horen wat je moet doen in plaats van niets. De guard blijft verder ongewijzigd, dus
er komt geen rerender op een niet-voltooid document bij.

### De Output-tooltip beschrijft de route die er nog is

Niet gevraagd, wel gedaan en de moeite waard: de tooltip van `#pdfOutputMode` beschreef nog de
oude route waarin een scanned pagina "keeps its own image and gains small patches over the text
areas" — precies wat de servicewijziging weghaalt. Uit de opgebouwde DOM gelezen:

```
Output-tooltip noemt scanned/hybrid-patchroute nog: false
Output-tooltip verwijst naar Vector fallback:       true
```

De tekst zegt nu "Vector output currently accepts born-digital pages only. For scanned or hybrid
pages, Vector fallback either rejects the request or sends the complete document through the
raster route." Dat maakt mijn derde punt grotendeels overbodig: de koppeling tussen de twee
selects staat nu in de Output-tooltip in plaats van alleen in die van de fallback. Zichtbaar
zonder hoveren is het nog steeds niet, maar dat is het patroon van het hele paneel.

### Niets anders bewoog

De module laadt nog steeds en de view bouwt op; `#pdfVectorFallback` heeft nog steeds
`value="reject"` met `reject` als `selected`-optie. De diff blijft 12 regels in één bestand,
zonder route, scherm of editorstructuur.
