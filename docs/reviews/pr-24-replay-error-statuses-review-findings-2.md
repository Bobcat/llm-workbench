# Review PR #24, ronde 2 — de drie punten uit ronde 1

- Branch: `feature/replay-error-statuses` @ `f8d5f5f`, verwerking in `e1ebdd8`, tegen `main`
- Ronde 1 staat in `docs/reviews/pr-24-replay-error-statuses-review-findings-1.md` en eindigde op
  *approve with nits*
- Uitgevoerd: de mutatie uit ronde 1 herhaald plus de omgekeerde; zeven verdere mutaties op de
  loader om te zien wat onbewaakt blijft; de loader tegen zes soorten upstream-antwoord gedraaid;
  nagemeten wat de gebruiker bij een ontbrekend bestand leest; de browsercheck-fixture gemuteerd om
  te zien of de status werkelijk getoetst wordt; de drie suites
- Werkkopie schoon na afloop; mutaties teruggedraaid en `__pycache__` gewist, geen servers blijven
  draaien

**Verdict: approve with nits.**

De drie punten zijn verwerkt en het belangrijkste is echt opgelost: de statuskeuze in de loader is
nu in beide richtingen vastgelegd. Het pad dat de gebruiker moest bereiken bereikt hem. Wat ik nog
vond zit in dezelfde functie: er is een derde uitkomst die de loader kan hebben en die als 500 bij
de client aankomt in plaats van als 502.

## Zijn de drie punten dicht?

| punt uit ronde 1 | status |
| --- | --- |
| loader-kant onbewaakt | **dicht voor de twee `except`-takken**; zie bevinding 1 en 2 |
| `detail`-object leverde minder op dan een string | **dicht** |
| browsercheck-fixture antwoordde 404 waar 502 hoort | **dicht** |

### De loader-mutatie is nu rood

```
loader: unreachable 502 -> 404   FAALT  (test_timeout_is_a_502, test_unreachable_service_is_a_502)
loader: upstream 404 -> 502      FAALT  (test_prompt_the_library_does_not_have_is_a_404)
```

Beide richtingen, dus de keuze kan niet stilletjes omklappen. De mock is eerlijk: `request.urlopen`
is de enige seam die de loader heeft, `_Response` implementeert precies wat hij gebruikt
(`__enter__`, `__exit__`, `read`), en een `HTTPError` als `side_effect` opwerpen is wat de echte
aanroep ook doet.

### Het pad bereikt de gebruiker

Gemeten tegen de echte route:

```
status: 404
detail: "File not found: /home/gunnar/projects/llm-workbench/data/realtime_translation/sample/weg.pc"
gebruiker leest: "File not found: /abs/pad/weg.pc"
```

In ronde 1 las de gebruiker alleen *"File not found"*. Dit is dus een echte verbetering en geen
verplaatsing.

## Bevindingen

### Laag/medium — een antwoord dat aankomt maar onbruikbaar is, wordt een 500

De loader vangt twee dingen: een `HTTPError` en een transportfout. Er is een derde uitkomst — de
dienst antwoordt, maar met iets waar `json.loads(...)` of `data.get(...)` niets mee kan. Gemeten:

| upstream-lichaam | resultaat uit `_load_prompt` |
| --- | --- |
| `{"id":"x","user":"u","system":"s"}` | `PromptRecord` ✓ |
| `{niet json` | **`JSONDecodeError`** — geen `PromptLoadError` |
| `[1,2,3]` | **`AttributeError`** |
| `"tekst"` | **`AttributeError`** |
| leeg lichaam | **`JSONDecodeError`** |
| niet-UTF8 bytes | **`UnicodeDecodeError`** |

En wat de client daarvan merkt, end-to-end nagemeten:

```
/api/replay/{id}/first-pass-prompt  bij kapotte upstream-JSON  ->  500
```

Dat is het geval dat het meest letterlijk een *bad gateway* is: de dienst heeft geantwoord, en de
workbench kan er niets mee. Het is ook een realistisch geval — een proxy vóór
`translation-services`, of een verkeerde poort die een andere dienst raakt, levert HTML. De
operator krijgt dan een 500 die zegt "de workbench is stuk" voor een probleem dat aan de andere
kant zit, en dat is precies het onderscheid waar deze PR voor bestaat.

Geen enkele toets raakt dit pad, en `_set_session_prompt` vangt alleen `PromptLoadError`, dus er is
ook niets dat het opvangt. Een `except (json.JSONDecodeError, AttributeError, UnicodeDecodeError)`
rond het lezen — of een controle dat `data` een dict is — met status 502 sluit het, en de bestaande
testopzet kan het meteen pinnen: `_Response` accepteert al willekeurige bytes.

### Laag — alleen de 5xx-helft van de "al het andere"-tak is gepind

De regel is: upstream 404 → 404, **elke andere** HTTP-status → 502. Getoetst worden 500 en 503. Ik
heb de conditie veranderd naar `if exc.code in (404, 403):` — een 403 zou dan als *"Prompt not
found"* bij de client aankomen — en de suite bleef groen. Eén extra `subTest`-waarde (403 of 400)
legt de regel vast in plaats van alleen de helft die het vaakst voorkomt.

### Laag — de opbouw van het verzoek wordt nergens nagekeken

Vier mutaties, vier keer groen:

| mutatie | suite |
| --- | --- |
| `parse.quote(...)` weg | past |
| `safe=""` → `safe="/"` | past |
| pad `/v1/prompts/` → `/v1/PROMPTS/` | past |
| `timeout=5.0` weg | past |

De tweede is meer dan stijl. `prompt_id` komt rechtstreeks van de client (`request.prompt_id` op
`/first-pass-prompt` en `/second-pass-prompt`) en gaat in een upstream-URL; `quote(safe="")` is wat
voorkomt dat hij die URL hervormt:

```
prompt-id "../../v1/models"    nu:        /v1/prompts/..%2F..%2Fv1%2Fmodels
                               safe="/":  /v1/prompts/../../v1/models
```

Een door de client geleverde id is dus één tekenklasse verwijderd van het adresseren van een ander
upstream-endpoint, zonder dat iets het merkt. Ik reken het laag omdat het vandaag juist staat en
`translation-services` first-party is, maar het is de enige andere verantwoordelijkheid die deze
functie heeft naast de statuskeuze, en de nieuwe testfile is de logische plek ervoor.

## Is de platte string een verbetering zonder verlies?

Ja. De oude body had `error` en `path` als aparte velden, maar in ronde 1 heb ik vastgesteld dat
niets in `static/src/` `detail.path` leest en dat `formatApiErrorMessage` alleen `detail.error`
pakt — het gestructureerde veld bereikte dus niemand. Met een platte string neemt dezelfde functie
de eerste tak en toont de hele zin, pad inbegrepen.

Een client die op de velden leunde is niet denkbaar in deze opstelling: de route is same-origin, de
enige consument is deze repo's eigen voorkant, en FastAPI publiceert de vorm van `detail` niet in
het schema. Wat je opgeeft is een machineleesbaar `path`-veld voor een machine die niet bestaat;
wat je krijgt is dat de lezer ziet wélk bestand geprobeerd is. Dat is de goede ruil.

## Is de fixturewijziging genoeg?

De redenering klopt, en de kanttekening die de prompt zelf oppert klopt ook. Gemeten:

| fixture | browsercheck |
| --- | --- |
| 502 (nu) | groen |
| 418 | **groen** — de status wordt dus niet getoetst |
| 200 | faalt: *"a refused start was not shown to the user: ['Failed to start: Session not found']"* |

De check onderscheidt 2xx van non-2xx en verder niets. Dat is precies goed verdeeld — welke status
de server kiest is het werk van `tests/test_replay_api.py` en `tests/test_replay_prompt_selection.py`
— en de wijziging is dus consistentie, geen nieuw gedrag, zoals de commit zegt.

De 200-variant is de moeite van het noemen waard: daar reproduceert de check letterlijk de oude
bug. Bij een 200 loopt de view door, krijgt geen `session_id`, en de fout komt één aanroep later
boven als *"Session not found"*. Dat is het gedrag dat deze PR wegneemt, en de check zou het dus
gevangen hebben.

## Is er iets nieuws stuk?

Nee. `e1ebdd8` raakt vier bestanden en blijft binnen de drie punten.

| controle | resultaat |
| --- | --- |
| `pytest` | **214 passed, 5 skipped** — precies zoals verwacht |
| `node --test` | 6 pass |
| browsercheck | exit 0, inclusief "refused replay start" |
| mutatie uit ronde 1 | nu rood, in beide richtingen |

## Wat is er niet af?

De grens is ongewijzigd goed. De websocket is nog steeds geen gat — hij sluit met
`4001 Session not found` en heeft het 200-met-foutbody-probleem nooit gehad; dat staat nu ook juist
in de PR-body. De snelheidsselect die alleen logt en de skip-probe die op status had kunnen kijken
horen buiten een PR over één contract, en daar zou ik ze laten.

Wat ik wél binnen deze PR zou trekken is de eerste bevinding: het onbruikbare antwoord is geen
aparte feature maar de derde tak van dezelfde `try`, en hij hoort bij de statuskeuze die deze PR
juist expliciet maakt.

## Samenvatting

- De loader-mutatie uit ronde 1 is dicht, in beide richtingen, en de mock is eerlijk.
- De platte string kost niets en levert de gebruiker het pad op.
- De fixture volgt nu de eigen regel; dat de check de status niet toetst is een juiste taakverdeling
  en geen verhulling.
- Toe te voegen, in volgorde van belang: een 502 voor een upstream-antwoord dat niet te lezen is,
  een derde statuswaarde in de "al het andere"-tak, en een toets op de quoting van de prompt-id.
