# Review PR #24, ronde 3 — de drie punten uit ronde 2

- Branch: `feature/replay-error-statuses` @ `3d4330b`, verwerking in `6a6a07e`, tegen `main`
- Ronde 2 staat in `docs/reviews/pr-24-replay-error-statuses-review-findings-2.md` en eindigde op
  *approve with nits*
- Uitgevoerd: de loader tegen tien lichaamsvormen en vier leesfouten gedraaid; de vier mutaties uit
  ronde 2 herhaald plus twee gedeeltelijke verruimingen van de quoting; acht prompt-id's door de
  URL-opbouw gehaald; de lege id end-to-end door de route; de drie suites
- Werkkopie schoon na afloop; mutaties teruggedraaid en `__pycache__` gewist, geen servers blijven
  draaien

**Verdict: approve with nits.**

De indeling van `_load_prompt` is goed en de grens tussen "de dienst faalde" en "wij hebben een
fout" ligt op de juiste plek. Alle tien lichaamsvormen die ik kon bedenken komen nu als 502 aan.
Wat overblijft zit één laag eerder: een antwoord dat halverwege het lezen afbreekt, is nog steeds
een 500.

## Zijn de drie punten dicht?

| punt uit ronde 2 | status |
| --- | --- |
| onbruikbaar antwoord werd een 500 | **dicht voor de inhoud**, open voor het lezen zelf — bevinding 1 |
| alleen de 5xx-helft van de "al het andere"-tak gepind | **dicht** |
| opbouw van het verzoek onbewaakt | **dicht voor `/`**, open voor de rest — bevinding 2 |

De vier mutaties die ronde 2 vroeg zijn alle vier rood:

| mutatie | gevangen door |
| --- | --- |
| `safe=""` → `safe="/"` | `test_a_client_supplied_id_cannot_reshape_the_upstream_request` |
| 403 in de 404-tak | `test_http_error_from_the_service_is_a_502` |
| onleesbaar antwoord 502 → 404 | `test_answer_that_cannot_be_read_is_a_502` |
| verkeerde soort 502 → 404 | `test_answer_that_is_not_a_prompt_is_a_502` |

## Is de nieuwe indeling goed?

Ja, en de grens ligt precies goed.

Het eerste `try` omsluit alleen de aanroep en het lezen; het tweede alleen het decoderen en parsen,
en vangt daar uitsluitend `json.JSONDecodeError` en `UnicodeDecodeError` — allebei eigenschappen van
het *lichaam*, dus van wat de dienst stuurde. Er wordt nergens breed gevangen, dus een fout in onze
eigen code blijft een 500. Dat is de goede kant op.

Het vervangen van het `AttributeError`-vangnet door `isinstance(data, dict)` is de belangrijkste
verbetering, en om een reden die het noemen waard is: een `AttributeError` kan net zo goed uit onze
eigen code komen, dus die vangen zou een workbench-bug hebben omgezet in een 502 die naar de dienst
wijst. Het expliciete vinkje kan alleen afgaan op de gegevens van de dienst. Dat is precies het
onderscheid dat deze PR maakt.

Na het tweede `try` kan niets meer struikelen over slechte gegevens: `data` is een dict, `.get` is
veilig, en elke waarde gaat door `str()`. De tweede `try` vangt dus niets dat een 500 hoort te
blijven.

Tien lichaamsvormen nagemeten, waaronder drie die de prompt niet noemt:

| lichaam | resultaat |
| --- | --- |
| geldig object | `PromptRecord` ✓ |
| `{niet json`, HTML van een proxy, leeg, niet-UTF8 | 502 |
| JSON-lijst, JSON-string | 502 |
| **JSON `null`, een getal, `true`** | 502 |

## Bevindingen

### Laag — een lees­fout halverwege is nog een 500

`response.read()` staat in het eerste `try`, maar dat blok vangt alleen `HTTPError`, `URLError` en
`TimeoutError`. Wat er gebeurt als de dienst de verbinding aanneemt en daarna laat vallen:

| leesfout | resultaat |
| --- | --- |
| `http.client.IncompleteRead` | **500** |
| `ConnectionResetError` | **500** |
| `OSError` tijdens het lezen | **500** |
| `TimeoutError` tijdens het lezen | 502 ✓ |

`IncompleteRead` is een `http.client.HTTPException` en `ConnectionResetError` een `OSError`; geen
van beide is een `URLError`, dus ze glippen langs. Een dienst die midden in het antwoord herstart,
of een proxy die de verbinding sluit, levert precies deze twee.

Dat is dezelfde vorm als het gat dat deze commit één regel verderop dicht: de dienst heeft
geantwoord en het gaat daarna mis aan die kant, en de workbench krijgt de schuld. Het commentaar
dat al boven het tweede `try` staat — *"The service answered, so a body we cannot read is its
failure, not ours"* — geldt hier woordelijk. De reparatie ligt in hetzelfde blok: de bestaande
`except (error.URLError, TimeoutError)` kan er `OSError` en `http.client.HTTPException` bij hebben.

### Laag — de verzoektoets beschermt één teken, niet de regel

`test_a_client_supplied_id_cannot_reshape_the_upstream_request` gebruikt één id,
`"../../v1/models"`, en die bevat alleen een `/`. Een gedeeltelijke verruiming komt er daarom
langs:

| mutatie | suite |
| --- | --- |
| `safe=""` → `safe="/"` | rood ✓ |
| `safe=""` → `safe="?"` | **groen** |
| `safe=""` → `safe="#"` | **groen** |

Met `safe="?"` wordt een id als `x?admin=1` een querystring op het upstream-verzoek. Kleiner dan
padtraversal, maar dezelfde soort. Eén testwaarde die `/`, `?`, `#` en een niet-ASCII-teken in één
string combineert, pint de regel in plaats van één voorbeeld ervan. Dat de andere gequote vormen
vandaag kloppen heb ik wel nagemeten:

```
'a/b'       -> /v1/prompts/a%2Fb
'x?y=1'     -> /v1/prompts/x%3Fy%3D1
'a#b'       -> /v1/prompts/a%23b
'é-prompt'  -> /v1/prompts/%C3%A9-prompt
```

### Laag — een lege prompt-id vraagt de collectie op en krijgt de dienst de schuld

De quoting breekt niet bij een lege id, maar het verzoek gaat naar een ander adres: het pad wordt
`/v1/prompts/` in plaats van een item. End-to-end door de route, met een upstream die op dat adres
de lijst teruggeeft zoals een collectie-endpoint doet:

```
prompt_id ""  ->  upstream GET http://127.0.0.1:8030/v1/prompts/
              ->  502 {"detail": "translation-services sent list instead of a prompt"}
```

Het nieuwe `isinstance`-vinkje vangt het, dus het is geen 500 meer — maar status en melding wijzen
naar de dienst voor iets dat de client fout deed. Een lege `prompt_id` is een 400. Dat is dezelfde
redenering die deze PR overal toepast: wie de fout maakt bepaalt de status. Eén regel in de route
of vóór de URL-opbouw sluit het.

## Is er iets nieuws stuk?

Nee. De commit raakt twee bestanden — `prompt_selection.py` en zijn testfile — en blijft daarmee
binnen de drie punten.

| controle | resultaat |
| --- | --- |
| `pytest` | **217 passed, 5 skipped** — precies zoals verwacht |
| `node --test` | 6 pass |
| browsercheck | exit 0, inclusief "refused replay start" |

De mock van `urlopen` is nog steeds de juiste seam: het is de enige die de loader heeft, en de
nieuwe toetsen gebruiken hem nu ook om het *verzoek* te inspecteren in plaats van alleen het
antwoord te sturen. Dat is een goede uitbreiding van dezelfde seam.

## Wat is er niet af?

De grens is ongewijzigd goed. De websocket is geen gat — hij sluit met `4001 Session not found` —
en de snelheidsselect en de skip-probe horen niet in een PR over één contract.

Van de drie bevindingen hierboven hoort de eerste er wél bij: de leesfout is geen nieuw onderwerp
maar het sluitstuk van de vraag die deze commit stelt, namelijk welke kant de schuld krijgt als het
tijdens het ophalen misgaat.

## Samenvatting

- De indeling klopt: het tweede `try` vangt alleen wat van de dienst komt, en `isinstance` in plaats
  van `AttributeError` voorkomt dat een eigen bug als 502 wordt gepresenteerd.
- Geen enkele lichaamsvorm komt nog als 500 door — tien geprobeerd, tien keer 502.
- Wel komt een leesfout halverwege nog als 500 door; dat is hetzelfde gat, één laag eerder.
- Klein: de verzoektoets pint `/` maar niet de regel, en een lege prompt-id krijgt een 502 waar een
  400 hoort.
