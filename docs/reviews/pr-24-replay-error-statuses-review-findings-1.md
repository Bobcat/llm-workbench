# Review PR #24 — echte HTTP-statussen op de replay-sessieroutes

- Branch: `feature/replay-error-statuses` @ `477bbcf`, tegen `main`
- Beoordeeld: `2ead939` (de routes en de loader) en `8856ce5` (de view)
- Uitgevoerd: alle twintig omzettingen geteld en de module op achterblijvers doorzocht; vijf
  mutaties op de statuskeuzes; nagemeten wat de gebruiker per status werkelijk te zien krijgt; de
  view-guards op bereikbaarheid getoetst met een onderschepte `/start`; de browsercheck gemuteerd;
  de drie suites
- Werkkopie schoon na afloop; mutaties teruggedraaid, geen servers blijven draaien

**Verdict: approve with nits.**

De statuskeuze klopt per geval en de redenering erachter houdt stand, ook op de twee plekken waar
de prompt terecht twijfelt. `PromptLoadError` is de juiste vorm, en het weghalen van de view-guards
is veilig. Twee dingen zou ik aanpassen: de loader-kant van de statuskeuze wordt door geen enkele
toets vastgelegd, en het `detail`-object levert de gebruiker minder op dan een platte string zou
doen.

## Is de statuskeuze per geval verdedigbaar?

Ja. Alle twintig plekken zijn om — er staat nergens in `app/realtime_translation/` nog een
`return {"error": ...}` — en de verdeling is 12×404, 4×400, 2×409, 1×502 plus de doorgegeven
loaderstatus.

**409 voor "policy alleen while idle"** is juist, en 400 zou het niet zijn. Het verzoek is goed
gevormd en de waarde is geldig; alleen de toestand van de sessie verbiedt het, en precies hetzelfde
verzoek slaagt na een reset. Dat is wat 409 betekent.

**409 voor "export zonder events"** is ook verdedigbaar, en om een concrete reden: op
`GET /{id}/export` betekent 404 al *"sessie onbekend"*. Zou "geen events" ook 404 worden, dan
vallen twee verschillende situaties op één status samen en kan de client ze niet uit elkaar houden.
Dat weegt zwaarder dan het bezwaar dat 409 op een GET ongebruikelijk is — RFC 9110 beschrijft
conflicten vooral rond PUT, maar sluit GET niet uit. De toestand is bovendien tijdelijk: dezelfde
GET slaagt zodra er events zijn, en dat is dezelfde vorm als het policygeval.

**502 voor een ontbrekende default-prompt bij `create_session`** is de juiste keuze voor de client,
en de commentaarregel erboven legt precies uit waarom. Het is wel een lichte rek op de letter: als
`translation-services` netjes 404 antwoordt, is dat een geldig upstream-antwoord en geen "bad
gateway". Maar de alternatieven zijn slechter. 404 zou het verzoek van de client beschuldigen
terwijl die die prompt-id nooit heeft genoemd, en 500 zou de workbench beschuldigen van een prompt
die in een andere dienst hoort te staan. De detailregel lost de ambiguïteit op: de operator leest
*"Prompt 'translate_realtime_first' not found in translation-services"* en gaat niet eerst de
verbinding controleren.

**404 voor een prompt-id die de client zelf noemde** is onomstreden: de client vroeg om een
resource die er niet is.

Het onderscheid tussen die twee prompt-plekken — client noemt de id versus server kiest de default
— is de scherpste beslissing in deze PR en hij is goed geland.

## Is `PromptLoadError` de juiste vorm?

Ja. De loader weet het feit (upstream 404 tegenover een transportfout), de route weet wat dat
betekent voor dít verzoek. Een status op de exceptie laat de route hem doorgeven waar de betekenis
hetzelfde is (`_set_session_prompt`) en overschrijven waar dat niet zo is (`create_session` → 502).
Precies die twee gevallen bestaan, dus de vorm past. En het belangrijkste: geen enkele route matcht
nog op fouttekst.

Op de vraag wat er gebeurt met een loader die iets anders gooit: `_set_session_prompt` vangt alleen
`PromptLoadError`, dus een gewone `ValueError` of wat dan ook propageert en wordt een 500. Dat is
het juiste standaardgedrag — een onverwachte fout is een serverfout — en het is een verbetering ten
opzichte van `except ValueError`, dat vroeger alles ving en er een 200 met foutbody van maakte.

## Bevindingen

### Laag/medium — de loader-kant van de statuskeuze is door geen enkele toets vastgelegd

De route-kant is echt gepind. Vier mutaties, vier keer rood:

| mutatie | uitkomst |
| --- | --- |
| 409 → 400 bij policy tijdens spelen | **faalt** |
| promptstatus hard op 502 (in plaats van `exc.status_code`) | **faalt** — `test_absent_prompt_answers_404` |
| oud contract terug op `/speed` (200 + errorbody) | **faalt** |
| export 409 → 404 | **faalt** |

Maar de mapping die deze PR eigenlijk gaat, zit in `prompt_selection.py`, en die is onbewaakt:

| mutatie | uitkomst |
| --- | --- |
| loader geeft 404 waar 502 hoort (`unreachable`) | **past — gat** |

De reden is dat alle drie de prompttests een `PromptLoadError` **injecteren** met een zelfgekozen
status:

```python
side_effect=PromptLoadError("translation-services unreachable: refused", 502)
```

Daarmee toetsen ze dat de route de status doorgeeft, niet dat de loader de juiste status kiest. Wie
`HTTPError(404)` → 404, `HTTPError(5xx)` → 502 en `URLError` → 502 omdraait, merkt niets. Dat is
juist het oordeel waar de PR over gaat, en de seam die `PromptLoadError` introduceert maakt het
goedkoop te toetsen: één test die `_load_prompt` tegen een nagebootste `urlopen` draait en de
`status_code` op de opgevangen exceptie nakijkt.

### Laag — het `detail`-object levert minder op dan een platte string

`create_session` antwoordt met `detail: {"error": "File not found", "path": "..."}`. Dat werkt,
want `formatApiErrorMessage` heeft een `detail.error`-tak. Maar ik heb nagemeten wat de gebruiker
er werkelijk van ziet:

| status | detail | wat de gebruiker leest |
| --- | --- | --- |
| 404 | `{"error": "File not found", "path": "…"}` | **"File not found"** |
| 404 | `"Session not found"` | "Session not found" |
| 400 | `"Invalid speed: 9"` | "Invalid speed: 9" |
| 409 | `"Policy can only be changed while idle. Reset first."` | idem |
| 502 | `"Prompt '…' not found in translation-services."` | idem |

Het `path` valt weg, en niets in de voorkant leest `detail.path` — gezocht in heel `static/src/`.
Het object koopt dus compatibiliteit met een tak die juist de helft negeert die interessant is: het
pad dat geprobeerd werd. Een platte string (`"File not found: /abs/pad/sample.pc"`) gaat door de
eerste tak van dezelfde functie, toont het pad wél, en heeft geen aparte vorm nodig. Het is
bovendien de enige niet-string `detail` in deze diff; de andere negentien zijn strings.

Geen regressie — de oude guard deed `throw new Error(result.error)` en liet het pad net zo goed
vallen — maar de motivering *"omdat de voorkant die vorm al las"* klopt maar half: de voorkant
leest `detail.error`, niet `path`.

## Zijn de negen nieuwe tests eerlijk?

Ja. Een sessie direct uit het samplebestand bouwen verbergt niets dat hier telt: de twee gevallen
die `create_session` aangaan (ontbrekend bestand, onbereikbare dienst) gaan wél door de route, en
wat overgeslagen wordt is het gelukkige aanmaakpad — niet het onderwerp. Het is precies wat de
tests zonder draaiende `translation-services` laat werken, en dat is de reden dat er nu vijf skips
in plaats van vijf failures staan.

De mutatiechecks zeggen echt iets, zoals hierboven: drie van de vier gevraagde vallen om, en een
vierde die ik erbij deed ook. Alleen de loaderrichting niet.

## De view

Het weghalen van de vier guards is veilig. Ze waren vóór deze PR noodzakelijk — de server
antwoordde 200, dus `fetchJson` gooide niet en de guard was het enige vangnet. Nu antwoordt elk van
die routes 4xx/5xx en gooit `fetchJson`, en er is in de hele replay-module geen 200-met-foutbody
meer over. De scenario's die de prompt noemt houden geen stand: een proxy die bodies herschrijft
bestaat hier niet, en een nieuwe voorkant tegen een oude achterkant kan niet, want dezelfde server
levert beide en `Cache-Control: no-cache` laat de browser revalideren.

Wat wel verdwijnt is verdediging in de diepte: zou er ooit tóch een 200-met-foutbody komen, dan
toont `updatePolicyDisplay(result.policy || normalized)` stilletjes de gevraagde waarde alsof hij
is toegepast, waar de guard eerst gooide. Dat is een gevolg, geen defect.

**Lekt er een rauwe fout?** Nee. `err.message` is wat `fetchJson` uit `detail` heeft gemaakt, dus
een servermededeling en geen stack trace. Getoetst door `/start` te onderscheppen met een 404: de
gebruiker krijgt *"Failed to start: Session not found"* en er is geen onafgehandelde rejection.

## De browsercheck

Die meet de juiste laag. De onderschepping staat alleen voor een server die 404 antwoordt; wat
beweerd wordt is het gedrag van de view — de melding verschijnt en er volgt geen request met een
`undefined`-sessie. Dat de server die status werkelijk geeft is het werk van de Python-tests, en die
splitsing klopt. Geverifieerd dat hij een echte regressie vangt: de alert weghalen levert
`exit=1` met *"a refused start was not shown to the user: []"*.

Eén inconsistentie: de fixture antwoordt **404** met de tekst *"Prompt 'translate_realtime_first'
not found in translation-services."* — terwijl dat precies het geval is dat deze PR op
`create_session` naar **502** mapt. Het gedrag van de view is voor elke non-2xx hetzelfde, dus de
toets blijft zinnig, maar de fixture spreekt de regel tegen die de PR invoert. Een 502 daar maakt
het consistent.

## Wat is er niet af?

De grens is goed gekozen, met één correctie op de aanname in de prompt: **de websocket is geen
gat.** Die sluit al met `code=4001, reason="Session not found"` en heeft het 200-met-foutbody-
probleem dus nooit gehad. De snelheidsselect die alleen logt en de skip-probe die op status had
kunnen kijken vallen buiten deze contractwijziging, en daar zou ik ze ook laten: dit is een PR over
één contract, en die blijft er beter om.

## Verificatie

| controle | resultaat |
| --- | --- |
| `pytest` | **208 passed, 5 skipped** |
| `node --test` | 6 pass |
| browsercheck | exit 0, inclusief "refused replay start" |

De prompt noemt 207 passed; gemeten zijn het er 208. De vijf skips zijn de sessietests die
`translation-services` nodig hebben.

*Terzijde over mijn eigen meting:* mijn mutatieronde liet kortstondig verouderde bytecode achter —
`409` en `404` zijn even lang, dus bestandsgrootte en mtime bleven gelijk en de `.pyc`-cache gold
nog als geldig. Daardoor zag ik eenmalig een failure op
`test_export_without_events_answers_409` die er niet is. Na het wissen van `__pycache__` is alles
groen; ik noem het omdat het geen bevinding over deze PR is.

## Samenvatting

- De statuskeuze klopt per geval, inclusief de twee waar twijfel legitiem was: 409 op de export
  omdat 404 daar al bezet is, en 502 op de default-prompt omdat de client die id niet koos.
- `PromptLoadError` is de juiste vorm, en de versmalde `except` is een verbetering.
- De view-guards waren na deze wijziging onbereikbaar en mogen weg; er lekt geen rauwe fout.
- Toe te voegen: één toets op de loader zelf, want juist die mapping is nu onbewaakt.
- Te overwegen: `detail` een platte string maken bij "File not found", dan ziet de gebruiker ook het
  pad; en de browsercheck-fixture op 502 zetten zodat hij de eigen regel volgt.
