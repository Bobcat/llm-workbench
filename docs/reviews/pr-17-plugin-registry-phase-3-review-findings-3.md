# Review PR #17 — plugin-architectuur fase 3, ronde 3

- Branch: `feature/plugin-registry-phase-3` @ `642bcf1`, tegen `main` @ `895d16d` (onveranderd
  sinds ronde 1)
- Beoordeeld: `0e044ac`, de verwerking van de drie nits uit ronde 2; `724cdc3` legt alleen het
  findings-bestand vast
- Uitgevoerd: zestien configuratievormen tegen `enabled_plugins()`, waarvan acht die vóór de fix
  werkten; dezelfde zes vormen met een echte `config/local.json` en een draaiende uvicorn, met de
  serverlog erbij; zes mutaties op de nieuwe controles; de reikwijdte van de strengere lezer
  nagelopen; de drie suites, de documenttoets, de hermeticiteit en de payloadvergelijking met `main`
- Werkkopie schoon na afloop; elke `config/local.json` opgeruimd, mutaties teruggedraaid, geen
  servers blijven draaien

**Verdict: approve.**

De drie nits zijn alle drie afgehandeld, en de eerste is afgehandeld zonder collateral schade: alles
wat vóór de fix werkte werkt nog, en alles wat stil faalde faalt nu luid met het juiste bestand
erbij. De strengere lezer doet nergens anders pijn — de reikwijdte is aantoonbaar het menu. Wat ik
nog vond zijn twee nits en een ontbrekend woord.

## Zijn de drie nits afgehandeld?

| nit uit ronde 2 | status |
| --- | --- |
| vormfout bóven `enabled` faalt stil | **opgelost**, zestien vormen nagemeten |
| `enabled: null` ongedocumenteerd | **opgelost**: README, fase-3-sectie én een pin |
| hashgat zonder vervolgstap | **opgelost**, sectie 4 noemt hem nu |

### Nit 1 — weigert hij genoeg, en niet te veel?

Beide kanten gemeten. Eerst wat moest blijven werken, en dat doet het allemaal:

| configuratie | resultaat |
| --- | --- |
| `plugins` ontbreekt | alles aan |
| `plugins` is `null` (basisbestand) | alles aan |
| `plugins` is `null` (`local.json`) | alles aan |
| leeg settingsbestand | alles aan |
| settingsbestand bestaat niet | alles aan |
| `local.json` is `{}` | lijst uit basisbestand blijft gelden |
| `local.json` bestaat niet | idem |
| `local.json` is een leeg bestand | idem |

En de vormfouten, met het bestand in de melding:

| configuratie | melding |
| --- | --- |
| `"plugins": "kapot"` in `local.json` | `plugins in local.json must be an object, not str` |
| `"plugins": "kapot"` in `settings.json` | `plugins in settings.json must be an object, not str` |
| `"plugins": ["image-pool"]` in `local.json` | `plugins in local.json must be an object, not list` |
| root van `local.json` is een lijst | `local.json must contain a JSON object` |
| root van `settings.json` is een lijst | `settings.json must contain a JSON object` |

Niet alleen in een tmp-pad. Met een echte `config/local.json` en een draaiende uvicorn:

```
plugins is een string  -> /plugins.js 500
   log: ValueError: plugins in config/local.json must be an object, not str
plugins is een lijst   -> /plugins.js 500
   log: ValueError: plugins in config/local.json must be an object, not list
root is een lijst      -> /plugins.js 500
   log: ValueError: config/local.json must contain a JSON object
plugins is null        -> /plugins.js 200   (geen foutregel)
leeg object            -> /plugins.js 200   (geen foutregel)
```

Dat `null` als afwezig telt is expliciet in de code opgeschreven en werkt in beide bestanden. De
grens ligt dus precies waar hij hoort: een waarde die *iets* beweert en de verkeerde vorm heeft is
een fout, een waarde die niets beweert niet.

### Vangen de nieuwe pins een terugval?

Zes mutaties, vijf rood:

| mutatie | uitkomst |
| --- | --- |
| vormcontrole helemaal weg | **faalt** — `test_a_shape_error_above_enabled_is_an_error` |
| niet-object root weer stil negeren | **faalt** — `test_a_settings_file_that_is_not_an_object_is_an_error` |
| alleen het basisbestand op vorm controleren | **faalt** |
| alleen `local.json` op vorm controleren | **faalt** |
| `null` telt niet als afwezig (te streng) | **faalt** — drie tests |
| **`plugins: null` wordt een fout, afwezig blijft goed** | **past** — zie de tweede nit |

Dat de "te streng"-richting ook valt is belangrijk: de controle kan niet stilletjes verscherpen
zonder dat iets omvalt.

### Nit 2 en 3

`enabled: null` staat nu in de README en in de fase-3-sectie, en
`test_an_explicit_null_turns_everything_on` pint het. Het hashgat in sectie 4 noemt nu een
vervolgstap — *"normaliseer de hash naar de landing, net als bij een koude start"* — in dezelfde
vorm als het gat over routebotsingen ernaast. Allebei afgerond.

## Doet de strengere lezer ergens anders pijn?

Nee, en dat is te begrenzen in plaats van te hopen.

`_load_json_object` in `app/plugins.py` is privé en wordt alleen door `enabled_plugins` gebruikt;
`enabled_plugins` wordt alleen aangeroepen vanuit `frontend_payload` (`app/plugins.py:425`), dat
`/plugins.js` voedt. Geen enkel service-pad raakt de strengere lezer. De andere zes kopieën van de
loader — in `image_pool/models.py`, `llm_pool/models.py`, `tts_pool/models.py`,
`video_pool/models.py`, `translation_services/proxy.py` en `realtime_translation/replay/settings.py`
— doen nog steeds `return {}` bij een niet-object root.

Daarmee wordt hetzelfde `config/local.json` door zeven lezers gelezen en wijst er één hem af. Die
asymmetrie is verdedigbaar en valt de goede kant op: bij een kapot `local.json` krijgt de operator
een luide 500 die het bestand noemt, terwijl de services stil terugvallen op `settings.json`. Het
alternatief — overal stil negeren — is precies het beeld dat deze fix wegneemt. Het bewuste verschil
staat ook in de comment bij de loader.

## Is er iets nieuws stukgegaan?

Nee.

| controle | zonder `local.json` | mét `local.json` (alleen `image-pool`) |
| --- | --- | --- |
| `pytest` | 158 passed, 5 failed | 158 passed, 5 failed |
| `node --test` | 4 pass | 4 pass |
| browsercheck | exit 0 | exit 0 |
| documenttoets (regelverwijzingen) | 2 passed | — |

`/api`-oppervlak identiek aan `main` (113 routes), niets erbij of eraf buiten `/api`, en de
`/plugins.js`-payload is als data nog steeds identiek aan die op `main`. De hermeticiteit voor
`config/local.json` is intact. `app/router.py` en `app/main.py` zijn opnieuw onaangeroerd.

## Nieuwe bevindingen

### Nit — een JSON-syntaxfout noemt het bestand niet

De vormfouten noemen netjes hun bestand, maar een bestand dat geen geldige JSON is doet dat niet.
Met een echte `config/local.json`:

```
kapotte JSON -> /plugins.js 500
   log: json.decoder.JSONDecodeError: Expecting property name enclosed in double quotes:
        line 1 column 14 (char 13)
```

Twee kandidaatbestanden, en de melding zegt niet welke. Dat is ouder dan deze commit — `json.loads`
stond er altijd onbeschermd — maar het is nu wel schever: twee regels verderop is er juist moeite
gedaan om het bestand te noemen, en deze ronde maakt `local.json` het bestand dat operators met de
hand bewerken. Een komma te veel is daar het waarschijnlijkste ongeluk. Dezelfde vorm als bevinding
1 uit ronde 1, en dezelfde oplossing: vang de decodeerfout en noem het pad.

### Nit — `plugins: null` is een expliciete beslissing zonder pin

De comment bij de vormcontrole zegt het met zoveel woorden: *"`null` counts as absent."* Dat is een
keuze, geen toeval — maar niets legt hem vast. Een mutatie die alleen `plugins: null` tot fout
maakt en een ontbrekende sectie met rust laat, laat de hele suite groen.

Dat valt op omdat de zusterbeslissing één niveau lager — `enabled: null` — deze ronde juist wél een
eigen pin kreeg. Eén `_settings({"plugins": None})`-geval in
`test_a_shape_error_above_enabled_is_an_error` sluit het.

### Nit — ontbrekend woord in de README

`README.md:237`: *"Name the list and only those ids are, in registry order."* Er mist iets als "in
the menu". Klein, maar het staat in de alinea waar een operator de schakelaar opzoekt.

## Samenvatting

- De drie nits uit ronde 2 zijn afgehandeld; de vormcontrole weigert wat hij moet weigeren en laat
  de acht configuraties die eerder werkten met rust.
- De reikwijdte van de strengere lezer is begrensd tot het menu, aantoonbaar via de aanroepketen.
- De pins dekken vijf van de zes terugvalrichtingen, inclusief de "te streng"-kant.
- Wat overblijft: het bestand noemen bij een JSON-syntaxfout, een pin voor `plugins: null`, en een
  ontbrekend woord in de README. Geen ervan raakt het gedrag in een gedocumenteerde configuratie.

Wat mij betreft kan de reeks hier sluiten: fase 3 doet wat hij belooft, het core-model is in ronde 1
aangetoond en sindsdien onaangeroerd, en de drie rondes daarna gingen over de scherpte van de
schakelaar en zijn meldingen — niet meer over het ontwerp.
