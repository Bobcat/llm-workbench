# Minimal CT2 Source-to-Target V1

## Doel

Deze repo heeft al de juiste abstractie voor een eerste lokale translator-integratie:

- de `.pc` file is voor de translator gewoon `source`
- de translator krijgt een `source_window`
- de translator levert `target_text`

## Boundary

De boundary voor v1 blijft:

```python
class Translator(Protocol):
    def translate(self, source_window: str) -> str:
        ...
```

Of nog explicieter als hook-vorm:

```python
on_committed_source_window(source_window: str) -> target_text
```

Belangrijk:

- de replayer weet van events
- de core weet van committed windows
- de translator weet alleen van `source -> target`

Daarom is "CT2-hook in de replayer" niet de beste formulering. De kleine eerlijke plek voor CT2 is de translator-backend.

## Wat De Huidige Repo Al Doet

De huidige code doet al bijna precies de gewenste v1:

- alleen `c`-events triggeren translation
- committed source wordt opgebouwd als delta's
- de laatste `N` committed chunks worden samen opnieuw vertaald
- de target tail wordt volledig vervangen

Dat betekent:

- `v1a` is `window_chunks = 1`
- `v1b` is `window_chunks = 2` of `3`

Voor de eerste evaluatie is `v1b` waarschijnlijk de betere default.

## V1 Gedrag

Bij iedere `c`-regel:

1. append aan `source_committed_text`
2. append aan `committed_chunks`
3. bouw een `source_window` uit de laatste `N` committed chunks
4. stuur dat window naar de CT2 translator
5. vervang `target_tail_text` met de nieuwe output
6. log de relevante metriek

Geen v1-onderdelen:

- geen target preview
- geen target commit policy
- geen rollbacklogica
- geen stale response handling
- geen queue prioriteiten
- geen scheduler

## Minimale Implementatierichting

### `app/translators.py`

Voeg een CT2-backend toe die de bestaande `Translator` protocol-vorm behoudt.

Doel:

- nieuwe translatornaam, bijvoorbeeld `ct2-eurollm`
- backend-specifieke setup volledig in deze module
- de rest van de app blijft `translate(source_window) -> str` aanroepen

Bewuste beperking:

- geen extra abstractielaag voor jobs, snapshots of async requests in deze fase

### `app/core.py`

Gedrag in de core hoeft in essentie niet te veranderen.

De bestaande policy blijft juist voor v1:

- alleen op `c`
- laatste `N` committed chunks
- volledige hervertaling van de tail

Alleen als trace logging dat nodig maakt, kan hier kleine extra metadata bijkomen, zoals:

- `source_window_chars`
- `target_chars`
- `latency_ms`

Maar ook dat moet klein blijven.

### `app/cli.py`

Voeg alleen de minimale configuratie toe om de nieuwe backend te kiezen en de run bruikbaar te evalueren.

Voorbeelden:

- `--translator ct2-eurollm`
- een model- of exportpad voor CT2
- optioneel device-configuratie

De precieze backend-flags mogen klein en pragmatisch blijven. Alles wat specifiek is voor de gekozen EuroLLM-export hoort hier of in `app/translators.py`, niet in de core.

### Tests

Hou de bestaande core-tests grotendeels intact.

Voeg alleen tests toe voor:

- translator factory kiest de CT2-backend correct
- onbekende backend geeft een fout
- optionele argumentvalidatie voor CT2-configuratie

De functionele `c`-only policy is al afgedekt in de bestaande tests.

## Logging Voor V1

Voor deze fase zijn dit de nuttige signalen:

- `line_number`
- `window_chunks_used`
- `source_window`
- `source_chars`
- `target_text`
- `target_chars`
- `latency_ms`

Nog niet loggen als aparte betekenisvolle metric:

- `queue_wait_ms`

Reden:

de huidige replay-loop is synchroon. Zonder scheduler of worker-queue is queue-wachttijd conceptueel nog nul of niet-bestaand.

`model_ms` is alleen zinvol als de CT2-backend dat geloofwaardig apart kan meten. Anders is alleen `latency_ms` genoeg voor v1.

## Aanbevolen Fasen

### Fase 1: Sync CT2 op committed windows

Doel:

- lokale `source -> target` vertaling via CT2
- bestaande committed-window policy behouden
- deterministische replay gebruiken als test harness

Wat nu werkt:

- alleen `c` triggert translation
- `window_chunks=1` versus `2-3` is direct vergelijkbaar
- latency per committed update is zichtbaar

Wat niet gedaan is:

- preview translation
- queueing
- stale response handling
- echte live scheduling

Aannames:

- een overlap-window van `2` of `3` committed chunks geeft al nuttige boundary-correctie
- sync CT2-calls zijn acceptabel voor eerste replay-evaluatie

### Fase 2: Tijdsrealistische replay

Doel:

- delays of replay-profielen toevoegen
- backlog- en latencygedrag realistischer maken

Wat nu werkt:

- kleine kunstmatige delay kan worden beoordeeld
- queue-wachttijd en totale doorlooptijd worden pas hier betekenisvol

Wat niet gedaan is:

- preview-target
- target frozen/active/preview splitsing

Aannames:

- synthetische replay-timing lijkt genoeg op live broninput om schedulingbeslissingen te testen

### Fase 3: Preview en corrigeerbare target tail

Doel:

- preview requests
- latest-snapshot-wins
- target opsplitsen in frozen, active en preview

Wat nu werkt:

- meeleesbare doeltekst tijdens preview-opbouw
- recente tail mag corrigeren zonder oude target volledig te herschrijven

Wat niet gedaan is:

- productietuning per model

Aannames:

- structured output of een andere betrouwbare splitsingsstrategie is haalbaar voor de gekozen backend

## Intentioneel Buiten Scope Voor De Eerstvolgende Patch

- asynchrone translator API
- bredere refactor van replay of core
- support voor meerdere upstream tekstlagen
- UI- of renderlogica voor target zones

## Concrete Eerste Patch

De kleinste eerlijke codepatch hierna is:

1. voeg een CT2 translator toe in `app/translators.py`
2. exposeer die via `--translator` in `app/cli.py`
3. gebruik de bestaande core-policy ongewijzigd
4. voeg alleen de strikt nodige trace/latency logging toe

Dat levert meteen een deterministische harness op voor:

- welk `window_chunks`-getal het best voelt
- hoe stabiel de target tail blijft
- wat de latency per committed update is

## Addendum: Mogelijke Implementatie Zonder Factory Uitbreiding

Dit addendum beschrijft een nog smallere variant voor de eerstvolgende implementatie, zolang model en inference engine vaststaan op EuroLLM/CT2.

Uitgangspunt:

- geen backend-selectie op naam
- geen extra factory-registratielaag
- geen `--translator` switch in de CLI voor deze fase

Mogelijke invulling:

1. gebruik een concrete translator-klasse, bijvoorbeeld `Ct2EuroLlmTranslator`
2. construeer die direct in `run_replay`
3. behoud de bestaande `Translator` protocol-vorm alleen voor testbaarheid en voor een latere uitbreiding

Waarom dit verdedigbaar is:

- minder branching en minder configuratie-oppervlak
- kleinere patch met minder bewegende delen
- gedrag blijft volledig in lijn met de `c`-only committed-window policy

Intentioneel buiten scope in deze variant:

- runtime backendkeuze
- extra CLI-opties voor backendnaam
- generieke plugin/factory-infrastructuur
