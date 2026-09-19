# Review PR #16 — plugin-architectuur fase 2, ronde 2

- Branch: `feature/plugin-registry-phase-2` @ `1d853d3`, tegen `main` @ `435d00b`
- Beoordeeld: `91c00ef` (`fix(plugins): answer the PR #16 review, round 1`), bovenop `b882151`
  uit ronde 1
- Uitgevoerd: de drie suites; de mutatie uit ronde 1 herhaald plus de omgekeerde en een
  overbodige-router-variant; de websockets gemuteerd én live verbonden; het API-oppervlak
  opnieuw vergeleken met `main`; de foutweergave in Chromium bekeken in beide thema's; elke
  regelverwijzing en elk getal in het ontwerpdocument opnieuw gemeten
- Werkkopie schoon na afloop; mutaties teruggedraaid, worktree opgeruimd, geen servers blijven
  draaien

**Verdict: approve with nits.**

De drie bevindingen uit ronde 1 zijn alle drie echt opgelost, en dat is met mutaties vastgesteld
in plaats van aangenomen. Wat overblijft is één eenzijdige toets en een reeks onnauwkeurigheden in
proza — waaronder twee getallen die uit mijn eigen ronde 1 komen en daar al fout waren.

## Zijn de drie bevindingen uit ronde 1 opgelost?

### 1. De per-view routerkoppeling — **ja, en beter dan gevraagd**

De nieuwe `test_declared_routers_cover_every_path_the_view_calls`
(`tests/test_plugin_registry.py:290-306`) meet per view tegen de **eigen** declaratie in plaats
van tegen de gemounte app. Dat sluit het gat dat ronde 1 aantoonde. Gemuteerd, in beide richtingen:

| mutatie | ronde 1 | nu |
| --- | --- | --- |
| `pdf-anatomy`: eigen router → `chat_router` | past (het gat) | **faalt** |
| `chat`: `llm_pool_router` uit de lijst | n.v.t. | **faalt** |
| `pdf-translation`: benchmark-router uit de lijst | n.v.t. | **faalt** |

Belangrijker dan de toets: de gegevens kloppen nu ook. Ik heb doorgerekend of elke gedeclareerde
router ook daadwerkelijk gebruikt wordt door de view die hem noemt — **alle 34 (view, router)-paren
worden gebruikt, geen enkele is overbodig**. De koppeling is dus niet alleen volledig maar ook
juist. In ronde 1 waren negen views onvolledig; dat is weg.

### 2. De websockets — **ja**

Ze staan nu op de views die ze gebruiken (`ViewSocket`), en `app/main.py:43-44` registreert ze uit
`iter_websockets()`. De paden staan niet meer letterlijk in `app/main.py`. Nagemeten:

- exact twee geregistreerd, geen duplicaten: `/ws/replay/{session_id}`,
  `/ws/replay-speak/{session_id}`;
- beide mutaties vallen om — websocket weghalen bij `replay-translate` en het pad verkeerd
  spellen laten allebei `test_every_socket_the_client_connects_to_is_declared` falen;
- de endpointsignaturen `(websocket, session_id)` sluiten aan op de padparameter, en ik heb beide
  sockets **live verbonden** via `TestClient`: handshake OK op allebei, en een onbekend pad wordt
  geweigerd. Dat was de moeite waard omdat de bestaande `test_replay_websocket_uses_delta_
  transcript_updates` al vóór de socket faalt (`KeyError: 'session_id'`, identiek op `main`) en
  dus niets over deze refactor bewijst.

### 3. De zichtbare fout bij een ontbrekende pluginlijst — **ja**

`registry.js` exporteert `pluginLoadError` in plaats van te gooien, en `static/app.js:308-313`
rendert het paneel vóór de rest van `init()`. In Chromium met een afgebroken `/plugins.js`:

```
paneel gevonden: True
titel : 'Could not load the plugin list'
sidebar-items=0   in beeld=True   976x101px
licht  thema=light  contrast titel=5.55  detail=7.86
donker thema=dark   contrast titel=4.80  detail=11.79
themawissel werkt bij fout: True
```

Leesbaar in beide thema's, boven de AA-drempel, en in beeld. Dat de themawissel de vroege return
in `init()` overleeft komt doordat `applyPreset()` ervóór staat en de listener op moduleniveau
hangt — dat is toevallig goed, niet ontworpen, maar het werkt.

`pluginLoadError` boven een throw is de juiste keuze, en om de reden die in de code staat: het
inline bootscript op `static/index.html:82` heeft de shell al zichtbaar gemaakt tegen de tijd dat
de module draait, dus een throw laat de gebruiker naar een lege lijst kijken met de reden alleen in
de console. Een export laat `app.js` doorlopen en het paneel plaatsen. De JS-suite is
meeverhuisd: die pint nu dat de module laadt, `PLUGINS` leeg is en `pluginLoadError` de global
noemt.

## Ongewijzigd gebleven

| controle | resultaat |
| --- | --- |
| `pytest` op de branch | 142 passed, 5 failed |
| `pytest` op `main` (losse worktree) | 120 passed, 5 failed — **dezelfde vijf** |
| `node --test` | 4 pass, 0 fail |
| browsercheck | exit 0, groen |
| `/api`-oppervlak tegen `main` | **identiek**, 113 routes |
| routes buiten `/api` | alleen `/plugins.js` erbij; de twee websockets ongewijzigd |

## Bevindingen

### Laag — de declaratie wordt maar in één richting getoetst

`test_declared_routers_cover_every_path_the_view_calls` controleert *aangeroepen ⊆ gedeclareerd*.
De andere kant is open: voeg bij `pdf-anatomy` een `video_pool_router` toe die die view nergens
aanroept en de hele suite blijft groen.

Vandaag is dat theorie — ik heb gemeten dat geen enkele view over-declareert, 0 van 34 paren. Maar
het is precies de richting die fase 3 gaat gebruiken: de declaratie bepaalt straks wie wat verliest
als een plugin uitgaat. Een blijven staan entry na het verwijderen van een API-aanroep overdrijft
dan de schade en niets merkt het. Omdat de data vandaag schoon is, zou de assertie *gedeclareerd ⊆
gebruikt* er meteen groen in kunnen — hij kost niets en sluit de laatste kier.

Kanttekening bij de weging: dit is geen regressie en geen defect. Het is het spiegelbeeld van de
bevinding die deze ronde opgelost heeft, en het is goedkoop om er meteen bij te doen.

### Laag — twee regelverwijzingen zijn opnieuw verouderd, allebei door deze ronde zelf

Beide waren in ronde 1 gemeld, zijn in `91c00ef` gecorrigeerd, en zijn door de codewijzigingen in
diezelfde commit weer verschoven:

| verwijzing in het document | gecorrigeerd naar | werkelijk |
| --- | --- | --- |
| `WORKFLOWS_BY_ROUTE` (regel 115 en sectie 4) | `registry.js:50` | **`registry.js:54`** — de `pluginLoadError`-ternary voegde vier regels toe |
| `RevalidatingStaticFiles` (regel 137) | `app/main.py:17` | **`app/main.py:15`** — de `WebSocket`-import en de twee wrapperfuncties zijn weg |

De correctie is dus tegen de oude revisie gemeten. De rest klopt wel, nagemeten:
`static/app.js:170`, `:214`, `:326`, `59-67` (eindigt exact op 67), `mountGeneration` 119,
`buildViewError` 134, `app/image_pool/training.py:18`, `static/index.html:7-22`.

Dit is de derde ronde op rij waarin regelnummers in dit document mis zijn, en steeds om dezelfde
reden. Ze zijn mechanisch verifieerbaar en er is al een Python-suite die bestanden inleest; een
test van een regel of twintig die elke `bestand:regel` in `docs/plugin-architecture.md` natrekt,
maakt deze hele klasse fouten onmogelijk. Dat lijkt me nuttiger dan een vierde handmatige ronde.

### Laag — twee getallen in sectie 4 kloppen niet, en die fout komt uit mijn ronde 1

De bullet over cross-plugin-afhankelijkheden zegt *"Zes views buiten llm-pool halen hun
modellenlijst uit `/api/models` of `/api/models/admin`"* en *"zet je llm-pool uit, dan verliezen
views in vier andere plugins een deel van hun backend"*. Gemeten, op beide manieren gelezen —
views die `/api/models*` aanroepen, én views die een llm-pool-router declareren — is het hetzelfde
antwoord:

```
replay-translate    realtime-translation
image-train         image-pool
image-translation   translation-services
pdf-translation     translation-services
prompt-library      translation-services

5 views, 3 plugins
```

Niet zes en niet vier. De herkomst is mijn eigen ronde 1: daar schreef ik *"… `prompt-library` en
`chat` — views in vier andere plugins"*, met `chat` erbij terwijl die zelf in llm-pool zit, en met
een plugin te veel. Het document heeft die telling overgenomen. De fout is van mij; de correctie
hoort in beide documenten.

### Nit — `app/plugins.py:4` wijst de verkeerde module aan

De module-docstring zegt dat *"``app/main.py`` mounts the routers and websockets from
``iter_routers`` and ``iter_websockets``"*. `app/router.py:11` mount de routers;
`app/main.py:43` mount alleen de websockets. In dezelfde lijn: `docs/plugin-architecture.md:41`
zegt nog *"Twee dingen komen daaruit voort"* en noemt de routers en `/plugins.js`, terwijl het er
sinds deze ronde drie zijn — de websockets staan wel in de veldentabel eronder, maar niet in die
opsomming.

### Nit — `test_payload_carries_no_routers` controleert `websockets` niet

`frontend_payload()` laat `websockets` correct weg — nagemeten, de payload bevat alleen
datavelden. Maar de assertie op viewniveau noemt alleen `routers` en `backend`, terwijl op
pluginniveau wél de exacte sleutelverzameling wordt vastgelegd. `websockets` is juist het veld dat
niet mag lekken: het bevat Python-callables. Het zou weliswaar hard falen in `json.dumps` bij het
serveren, dus het risico is klein, maar de viewassertie op dezelfde exacte vorm brengen als de
pluginassertie is één regel.

### Nit — het foutpaneel geeft Node-advies aan een browsergebruiker

Het detail eindigt met *"if you are importing this outside a browser, stub that global first"*.
Dat is advies voor de JS-suite en kan in het paneel per definitie nooit van toepassing zijn. Wat
er voor een kijker wél toe doet — herlaad, of kijk of de server draait — staat er niet. De
boodschap was geschreven voor een throw en is ongewijzigd meeverhuisd naar de UI.

### Nit — "de enige routes buiten `/api`" klopt niet

Zowel de veldentabel (`websockets`) als de `ViewSocket`-docstring noemt de websockets *de* routes
buiten `/api`. Er zijn er meer: `/plugins.js`, `/docs`, `/openapi.json`, `/redoc`. Bedoeld is
waarschijnlijk "de enige applicatieroutes buiten `/api`".

### Nit — een test die niet doet wat zijn naam zegt

`test_removing_a_socket_from_the_registry_unregisters_it`
(`tests/test_plugin_registry.py:349-356`) verwijdert niets en toetst geen bedrading; hij pint dat
er twee sockets zijn met twee specifieke paden. Dat is nuttig, maar het is een pin, geen
bedradingscontrole — die zit in `test_every_declared_socket_is_registered` ernaast. Naam en
docstring beloven meer dan de body doet.

### Nit — ontbrekende lege regel

`91c00ef` haalde de lege regel tussen `test_the_backend_less_view_calls_nothing` en
`test_views_with_a_backend_reach_at_least_two_endpoints` weg
(`tests/test_plugin_registry.py:315-316`).

## Antwoord op de zes gestelde vragen

1. **Bevinding 1 opgelost?** Ja, in beide richtingen gemuteerd en beide keren rood.
2. **Is de koppeling ook juist, niet alleen volledig?** Ja — 0 van 34 paren is overbodig. Maar dat
   is gemeten, niet getoetst; zie de eerste bevinding. Kwaad kan het vooral in fase 3, waar de
   declaratie bepaalt wie wat verliest.
3. **Websockets volledig onderdeel van het contract?** Ja: gedeclareerd op de views, geregistreerd
   uit de registratie, paden weg uit `app/main.py`, beide mutaties gevangen, live verbonden. De
   gedekte faalmodus is een pad dat de frontend aanspreekt maar niemand declareert. Niet gedekt:
   een gedeclareerde socket die de frontend nooit gebruikt — dezelfde eenzijdigheid als bij de
   routers, en even onschuldig vandaag.
4. **De zichtbare fout.** Bruikbaar: in beeld, leesbaar in beide thema's, en gepind door de
   browsercheck. `pluginLoadError` boven een throw is juist, en om de goede reden. Alleen de tekst
   is nog voor een andere lezer geschreven — zie de nit.
5. **Zijn de documentcorrecties juist?** Overwegend wel, maar twee regelverwijzingen zijn opnieuw
   mis en twee getallen in sectie 4 kloppen niet. De beschrijving van `routers` in sectie 2 is
   accuraat en dekt nu de kern ("**elke** router die een endpoint bedient dat deze view
   aanroept"); die van `websockets` klopt op één woord na.
6. **Wat is er niet af?** De spiegelrichting van de padanalyse, en de documentcorrecties hierboven.
   De gatenlijst in sectie 4 is verder compleet en goed geprioriteerd: hij pakte mijn ronde-1-punt
   over de omvang op, benoemt de fase-3-vraag expliciet, en streept opgeloste punten door in plaats
   van ze te verwijderen.

## Samenvatting

- Alle drie de bevindingen uit ronde 1 zijn opgelost en het bewijs is meegeleverd. De koppeling is
  nu volledig én juist, de websockets zitten in het contract, en de lege schil is een zichtbaar
  paneel geworden.
- Goedkoop mee te nemen: de assertie *gedeclareerd ⊆ gebruikt* (groen vandaag), en de
  `websockets`-sleutel in de payload-assertie.
- Te corrigeren in de documentatie: `registry.js:54`, `app/main.py:15`, vijf views in drie plugins,
  en de module-docstring die `app/main.py` als mounter van de routers aanwijst.
- Aanbeveling boven een vierde handmatige ronde: laat een test de regelverwijzingen in
  `docs/plugin-architecture.md` natrekken. Drie rondes op rij dezelfde soort fout is een signaal
  dat het handwerk is, niet dat er slordig gewerkt wordt.
