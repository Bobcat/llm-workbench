# Review PR #17 — plugin-architectuur fase 3, ronde 2

- Branch: `feature/plugin-registry-phase-3` @ `5e5f0f0`, tegen `main` @ `895d16d` (onveranderd
  sinds ronde 1)
- Beoordeeld: `83d519f`, de verwerking van ronde 1; `43291ec` legt alleen het findings-bestand vast
- Uitgevoerd: veertien configuratiegevallen tegen `enabled_plugins()`, waaronder de vier
  randgevallen uit de prompt; dezelfde fout met een echte `config/local.json` en een draaiende
  uvicorn, met de serverlog erbij; vier mutaties op de nieuwe pin; de claim uit sectie 4 over
  onbekende routes in Chromium nagemeten; de drie suites, de documenttoets en de hermeticiteit
- Werkkopie schoon na afloop; elke `config/local.json` opgeruimd, mutaties teruggedraaid, geen
  servers blijven draaien

**Verdict: approve.**

Alle vijf punten uit ronde 1 zijn afgehandeld, en de belangrijkste is afgehandeld in de goede
richting: de melding noemt nu aantoonbaar het bestand waar `plugins.enabled` werkelijk vandaan
komt, in alle randgevallen die ik kon bedenken. Wat ik nog vond zijn drie nits in dezelfde
categorie die het ontwerp al bewust accepteert.

## Zijn de bevindingen uit ronde 1 afgehandeld?

| ronde 1 | status |
| --- | --- |
| 1 — melding noemde het verkeerde bestand | **opgelost**, veertien gevallen nagemeten |
| 2 — naam en docstring van de toets per categorie | **opgelost**, de docstring zegt nu precies wat de toets wel en niet meet |
| 3 — hash blijft staan bij een in-sessie wijziging | **als gat vastgelegd**, met de meting; de afweging klopt |
| 4 — `route_aliases()` beschreef frontendgedrag | **opgelost** |
| 5 — ontbrekende lege regel | **opgelost**; geen enkele klasse in het bestand mist er nog een |

### Bevinding 1 — de attributie klopt nu overal

`enabled_plugins()` onthoudt uit welk bestand de effectieve lijst komt
(`source = local_path if _enabled_entry(local_payload) is not None else path`). Veertien gevallen
doorgerekend:

| geval | genoemd bestand |
| --- | --- |
| fout in `settings.json`, geen `local.json` | `settings.json` ✓ |
| fout in `local.json`, `settings.json` schoon | `local.json` ✓ |
| fout in `local.json` terwijl `settings.json` een goede lijst heeft | `local.json` ✓ |
| lege lijst in `settings.json` | `settings.json` ✓ |
| lege lijst in `local.json` | `local.json` ✓ |
| string in plaats van lijst in `local.json` | `local.json` ✓ |
| **`local.json` zonder `plugins`** | `settings.json` ✓ |
| **`local.json` met `plugins` maar zonder `enabled`** | `settings.json` ✓ |
| **`enabled` expliciet `null` in `local.json`** | geen fout — alles aan |
| **lege lijst in `settings.json`, `local.json` heeft een lijst** | geen fout — `local.json` wint |

De vier vetgedrukte zijn de randgevallen die de prompt noemt; alle vier gedragen zich juist.

En niet alleen in een tmp-pad. Met een echte `config/local.json` en een draaiende uvicorn:

```
typefout in config/local.json   -> /plugins.js 500
   serverlog: ValueError: plugins.enabled in config/local.json names unknown categories: tikfout
lege lijst in config/local.json -> /plugins.js 500, melding noemt config/local.json
local zonder plugins-sleutel    -> /plugins.js 200, geen melding
```

De serverlog noemt hetzelfde bestand als de melding. Daarmee is ook de zin in sectie 4 — *"De
serverlog noemt het foute id wel, met het bestand erbij"* — voor het eerst helemaal waar.

### Is `_enabled_entry` een tweede lezer die uit de pas kan lopen?

Nee, en het `enabled: null`-geval dat de prompt aanwijst kan de foutpaden niet bereiken.

`_enabled_entry(payload)` levert de effectieve waarde, `_enabled_entry(local_payload)` alleen de
attributie. Die twee kunnen alleen uiteenlopen als de merge `plugins.enabled` anders maakt dan wat
`local.json` zegt. Dat kan niet: staat er in `local.json` een `plugins`-dict met `enabled`, dan wint
die waarde altijd in `_merge_json_objects`, dus samengevoegd == lokaal en `source` is terecht
`local.json`. Ontbreekt `enabled` in `local.json`, dan is `_enabled_entry(local_payload)` `None` en
komt de waarde uit het basisbestand, dus `source` is terecht `settings.json`.

Het enige geval waarin `_enabled_entry(local_payload)` `None` geeft terwijl `local.json` het veld
wél noemt, is `enabled: null`. Dan is de samengevoegde waarde óók `None`, waarna `enabled_plugins`
meteen `PLUGINS` teruggeeft en er geen melding bestaat om verkeerd te attribueren. Empirisch
bevestigd: met `enabled: null` in `local.json` en een typefout in `settings.json` komt er geen fout
maar staan alle acht categorieën aan.

### Is de nieuwe pin de juiste?

Ja. `test_the_error_names_the_file_the_switch_came_from` pint beide richtingen — fout in
`local.json` mag `settings.json` niet noemen, en andersom moet `settings.json` juist wél genoemd
worden. Vier mutaties op de `source`-regel, alle vier rood:

| mutatie | uitkomst |
| --- | --- |
| terug naar het oude gedrag (`source = path`) | **faalt** |
| altijd `local.json` noemen | **faalt** |
| conditie omgedraaid | **faalt** |
| `_enabled_entry(payload)` in plaats van `(local_payload)` | **faalt** |

Die laatste is de subtiele: de samengevoegde payload lezen in plaats van de lokale zou er in de
meeste gevallen hetzelfde uitzien. De pin vangt hem.

### Bevinding 2 en 4 — is de tekstuele afhandeling genoeg?

Ja, en hier hoefde niets te verdwijnen. De hernoemde toets heet nu wat hij doet, en zijn docstring
zegt letterlijk wat ik in ronde 1 aanwees: *"The mounted set is deliberately the same on every
iteration: `_app_paths()` reads the app that was built at import and never sees the switch."* Met
de verwijzing naar `CoreMountTests` voor de garantie die de lus zelf niet levert. Dat is de juiste
oplossing — het gedrag was correct, alleen de naam beloofde meer.

`route_aliases()` zegt nu dat de tests hem pinnen en dat de browser zijn eigen tabel uit de payload
bouwt. Ook goed: de functie weghalen zou de pin zijn onderwerp ontnemen.

### Bevinding 3 — klopt de afweging?

Ja, en de claim is checkbaar en klopt. Sectie 4 stelt dat het gedrag voor elke onbekende route
geldt en ouder is dan fase 3. Nagemeten met **alle** categorieën aan:

```
na #foo-bestaat-niet   hash='#foo-bestaat-niet'  actief=['replay-translate']
na #chat               hash='#chat'              actief=['chat']
deep link #foo-bestaat-niet -> hash herschreven naar '#replay-translate'
```

Een onbekende route gedraagt zich identiek aan een route van een uitgezette categorie, en een deep
link wordt wél gecorrigeerd. Het is dus routergedrag, niet iets dat fase 3 introduceert, en het
niet aanpassen is verdedigbaar. Zie wel de derde nit hieronder.

## Is er iets nieuws stukgegaan?

Nee. `83d519f` raakt alleen `app/plugins.py`, `docs/plugin-architecture.md` en de testsuite —
`app/router.py` en `app/main.py` zijn onaangeroerd, dus de oppervlaktevergelijking uit ronde 1
staat nog.

| controle | zonder `local.json` | mét `local.json` (alleen `image-pool`) |
| --- | --- | --- |
| `pytest` | 155 passed, 5 failed | 155 passed, 5 failed |
| `node --test` | 4 pass | 4 pass |
| browsercheck | exit 0 | exit 0 |
| documenttoets | 2 passed | — |

De hermeticiteit is dus intact en de regelverwijzingen in het document kloppen nog steeds.

## Nieuwe bevindingen

### Nit — een vormfout bóven `enabled` faalt stil

Het ontwerp kiest er bewust voor dat een typefout niet op een werkende installatie mag lijken. Dat
principe geldt binnen `enabled`, maar niet erboven:

| configuratie | gedrag |
| --- | --- |
| `"plugins": "kapot"` in `local.json` | **stil alles aan**, de lijst in `settings.json` wordt genegeerd |
| `"plugins": "kapot"` in `settings.json` | **stil alles aan** |
| `local.json` is een JSON-lijst in plaats van een object | **stil genegeerd** |

Een string waar een object hoort is precies zo'n typefout als een verkeerd categorie-id, en levert
nu het beeld op dat de schakelaar wel is opgepikt terwijl hij is weggegooid. Dat is dezelfde
faalvorm die `plugins.enabled` zelf juist hard maakt.

### Nit — `enabled: null` zet alles aan en overruled het basisbestand, ongedocumenteerd

`{"plugins": {"enabled": null}}` in `local.json` zet alle categorieën aan, óók als `settings.json`
een korte lijst heeft. Als lezing van "geen lijst betekent alles aan" is dat consistent, en als
lokale ontsnapping ("zet mijn beperking even uit") is het zelfs handig. Maar het staat nergens, en
het is de enige manier waarop `local.json` het basisbestand niet aanvult maar omkeert.

### Nit — het gat in sectie 4 noemt geen vervolgstap

Bij de routebotsingen staat wél wat er moet gebeuren ("weigeren bij het laden, of eerste-wint met
een waarschuwing"). Bij de hash blijft het bij een beschrijving. Eén zin — bijvoorbeeld: normaliseer
de hash naar de landing zoals bij een koude start — maakt het een taak in plaats van een
constatering.

## Samenvatting

- Bevinding 1 is niet alleen opgelost maar breder dan gevraagd nagemeten: veertien gevallen, de
  vier randgevallen uit de prompt, en met een echte `local.json` plus serverlog.
- `_enabled_entry` is geen divergerende tweede lezer; het `enabled: null`-geval kan de foutpaden
  niet bereiken.
- De pin dekt vier terugvalvarianten, inclusief de subtiele.
- Bevinding 2 en 4 zijn tekstueel opgelost en dat is hier de juiste oplossing; bevinding 3 is
  terecht een gat geworden en de onderbouwing klopt.
- Wat overblijft zijn drie nits: stille vormfouten boven `enabled`, ongedocumenteerd gedrag van
  `enabled: null`, en een gat zonder vervolgstap. Geen ervan raakt de schakelaar in een
  gedocumenteerde configuratie.
