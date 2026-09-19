# Review PR #16 — plugin-architectuur fase 2, ronde 4

- Branch: `feature/plugin-registry-phase-2` @ `a6c8aa8`, tegen `main` @ `435d00b`
- Beoordeeld: `28a1575` (`fix(plugins): answer the PR #16 review, round 3`), bovenop `edbf708`
- Uitgevoerd: de drie suites; alle tien buurwissels uit ronde 3 opnieuw; vijf syntactische vormen
  van handgebouwde URL's geprobeerd; de prefix-semantiek getoetst door endpoints te hernoemen die
  views echt aanspreken; drie socketmutaties; de ankerkeuze per verwijzing doorgerekend en
  vergeleken met de gedocumenteerde regel; het API-oppervlak opnieuw vergeleken met `main`
- Werkkopie schoon na afloop; mutaties teruggedraaid, worktree opgeruimd

**Verdict: approve. Wat mij betreft stopt de reeks hier.**

Alle vier de punten uit ronde 3 zijn opgelost en nagemeten. Wat ik deze ronde vond is één inerte
bug in een testhelper en twee grenzen van de aanpak die nu scherp genoeg in beeld zijn om ermee te
leven. Geen ervan rechtvaardigt een vijfde ronde; ze zijn hieronder precies genoeg beschreven om
zonder review af te handelen.

## Is alles uit ronde 3 weg?

| ronde 3 | status |
| --- | --- |
| exporttabel accepteert elke buurrij | **opgelost** — alle tien wissels falen nu, nul doorglippers |
| ankerheuristiek varieert 0,2%–65% zonder dat iets dat toont | **opgelost** — zie de meting hieronder; de docstring noemt de drie resterende beperkingen mét marges |
| stille-overslagtak bij een verwijzing zonder anker | **opgelost** — dat is nu een failure met een leesbare melding |
| socket-naamheuristiek uit het pad afgeleid | **opgelost** — `ViewSocket.client` draagt de naam |
| literale API-paden onzichtbaar | **grotendeels opgelost** — zie bevinding 2 en 3 |

De ankerkeuze is meetbaar strakker geworden. Per verwijzing het aandeel posities in het doelbestand
dat een verschuiving zou overleven:

| verwijzing | ronde 3 | nu |
| --- | --- | --- |
| `static/app.js:59-67` | 56,4% | **8,2%** |
| `registry.js:45` | 12,8% | 2,1% |
| `registry.js:41` | 10,6% | 4,3% |
| `app/main.py:15` | 9,5% | 3,2% |
| `static/app.js:134` | 6,5% | 0,6% |
| `static/app.js:170` | 1,2% | 0,6% |
| `static/index.html:7-22` | 65,4% | 65,4% |

Die laatste blijft staan omdat het een blok van zestien regels is, en de docstring zegt dat nu
hardop. Dat is de juiste afhandeling: de beperking is gemeten en opgeschreven in plaats van
weggewerkt.

De socketkoppeling is robuust geworden, met drie mutaties gecontroleerd:

| mutatie | uitkomst |
| --- | --- |
| socket op de verkeerde view met een plausibele clientnaam | **faalt** |
| clientnaam die nergens voorkomt | **faalt** |
| clientklasse consistent hernoemd in JS, registratie niet bijgewerkt | **faalt** — en dat hoort, de declaratie is dan verouderd |

Ongewijzigd: `/api`-oppervlak identiek aan `main` (113 routes), buiten `/api` alleen `/plugins.js`
erbij. `pytest` 147 passed met dezelfde vijf bestaande replay-failures (op `main` gecontroleerd:
120 passed, dezelfde vijf). `node --test` 4/4. Browsercheck groen.

## Bevindingen

### Laag — `source.count()` telt regels, niet voorkomens

`tests/test_plugin_registry.py`, in
`test_every_reference_resolves_to_the_symbol_it_names`:

```python
source = target.read_text(encoding="utf-8").splitlines()   # een list[str]
...
anchor = min(anchors, key=lambda candidate: (source.count(candidate), -len(candidate)))
```

`list.count()` telt elementen die *gelijk* zijn aan de zoekterm, dus hele regels die exact
`"buildViewError"` luiden. Dat zijn er nul, voor elk anker:

```
source.count('buildViewError') = 0   (bedoeld: 2)
source.count('debug')          = 0   (bedoeld: 2)
source.count('error')          = 0   (bedoeld: 14)
```

De sleutel is daarmee `(0, -len)` voor elke kandidaat, dus de regel is in de praktijk **"het
langste anker"**, niet "het anker dat het minst voorkomt". Het commentaar erboven ("the symbol
occurring least in the file") en de klasse-docstring beschrijven allebei de regel die er niet is.

**Vandaag heeft dat geen enkel gevolg.** Ik heb beide regels naast elkaar gelegd over alle
zeventien verwijzingen en ze kiezen stuk voor stuk hetzelfde anker. De winst van 56% naar 8% is
dus echt, alleen door een andere heuristiek behaald dan de tekst zegt.

De angel zit in de reparatie. Met de bedoelde telling ingebouwd blijft de suite groen op de
huidige code, maar kantelt hij zodra iets legitiems verandert:

```
met de bedoelde telling, code ongewijzigd      : groen
met de bedoelde telling, één console.debug weg : FAALT
    line 127: static/app.js:134 does not mention 'debug'
```

Eén `console.debug` uit `static/app.js` halen — precies de regel die ik in ronde 2 voorstelde —
laat `debug` (dan één voorkomen) winnen van `buildViewError` (twee), waarna regel 134 het gekozen
anker niet bevat terwijl de verwijzing gewoon klopt. Dat beantwoordt meteen vraag 4: de toets is
vandaag **niet** te streng, en dat komt deels doordat de specificiteitsregel niet actief is;
naïef repareren maakt hem wél te streng.

De uitweg die beide dicht: kies het anker dat op de regel van de verwijzing zelf staat
(`buildViewError` op docregel 127) in plaats van het zeldzaamste uit een venster van drie regels.
Het venster blijft dan alleen de vangnetfunctie houden die het had. Of, als dat te veel werk is
voor wat het oplevert: laat de code staan en pas de twee zinnen aan die hem beschrijven.

### Laag — de prefix-semantiek verifieert alleen de basis, niet het pad

Een handgebouwde URL wordt afgekapt bij `${` en als prefix gecontroleerd. Dat betekent dat alles
ónder die basis ongecontroleerd blijft. Twee views bouwen hun URL's op uit `REG_BASE`:

```js
const REG_BASE = '/api/pdf-regression';
`${REG_BASE}/fixtures/${...}/${...}/${...}/pages/${page}/${file}?v=${imgVer}`
`${REG_BASE}/fixtures/${...}/${...}/${...}/artifact/${artifact}`
```

`REG_BASE` is zelf een literal en wordt dus gevangen — daarom miste ik hem in ronde 3 niet als
blinde vlek. Maar de suffix telt niet mee. Gemuteerd in
`app/translation_services/pdf_regression.py`:

| mutatie | uitkomst |
| --- | --- |
| `/fixtures/{name}/{lang}/{variant}/pages/{page}/{artifact}` hernoemd | **past** — niemand merkt het |
| `/fixtures/{name}/{lang}/{variant}/artifact/{artifact}` hernoemd | **past** — niemand merkt het |
| `REG_BASE` naar `/api/nope` | **faalt**, twee tests |

Dus: de basis is gedekt, de endpoints eronder niet, terwijl de view er wel degelijk URL's voor
bouwt. Dit is inherent aan de aanpak — een URL die uit template-delen wordt samengesteld valt niet
statisch te herleiden zonder JS uit te voeren — en de winst ten opzichte van ronde 3 (van "ziet
niets" naar "ziet de basis") is echt. Wat ontbreekt is die prijs in de docstring van
`_called_paths`: daar staat waaróm literals als prefix worden behandeld, niet wat dat kost.

### Laag — vier syntactische vormen ontsnappen nog, alle vier ongebruikt

`LITERAL_API_PATH` eist dat het pad direct achter het aanhalingsteken begint. Geprobeerd, met een
pad dat nergens gemount is:

| vorm | gevangen? | komt voor |
| --- | --- | --- |
| `'/api/nope/'` als literal | **ja** — de mutatie uit ronde 3 faalt nu | 6 views |
| `'/api' + '/nope/x'` | nee | 0× |
| `` `${base}/nope/x` `` | nee | 3× (maar de basis is er zelf een gevangen literal) |
| `'api/nope/x'` (relatief) | nee | 0× |
| `'http://h/api/nope/x'` | nee | 0× |
| `new WebSocket('/ws/nope/x')` in een view | nee | 0× |

Geteld over alle twintig view-subtrees: alleen de template-met-variabele-basis komt voor, en daar
wordt de basis wél gezien. Er is vandaag dus geen enkel endpoint dat langs deze wegen aan de
controle ontsnapt. Ik noem het omdat de dekking smaller is dan "literale paden tellen mee"
suggereert, niet omdat er iets stuk is.

## Antwoord op de vijf vragen

1. **Is de blinde vlek dicht?** Voor de vorm die ik in ronde 3 aanwees: ja, gecontroleerd met
   dezelfde mutatie. Vier andere vormen ontsnappen nog, maar geen enkele view gebruikt ze, en de
   enige die wel voorkomt heeft een gevangen basis. Geen actief gat.
2. **Valse geruststelling door de prefixsemantiek?** Ja, aantoonbaar: twee endpoints die views
   werkelijk aanspreken kunnen hernoemd worden zonder dat iets omvalt. Inherent aan de aanpak,
   maar het hoort in de docstring.
3. **Is de socketkoppeling robuust?** Ja. Twee sockets op één view werkt (`websockets` is een
   tuple, elk met eigen `client`), een verkeerde view wordt gevangen door de padtoetsen, een
   niet-bestaande clientnaam door de spiegeltoets. Een socket die zonder klasse wordt aangesproken
   (`new WebSocket(...)` in een view) blijft onzichtbaar; dat doet vandaag niemand.
4. **Is de documenttoets te streng?** Nee — en de reden is bevinding 1. Legitieme
   documentwijzigingen die ik probeerde (een backtick-term weghalen, een toevoegen) laten hem
   groen. Met de gedocumenteerde regel wél actief zou hij het op één plek onterecht begeven.
5. **Wat is er niet af?** De drie bevindingen hierboven, alle laag. De gatenlijst in sectie 4 is
   compleet en juist geprioriteerd.

## Afsluiting

Vier rondes, en het patroon dat de eerste drie kenmerkte — een correctie die tegen de verkeerde
revisie was gemeten — is doorbroken: elk punt uit ronde 3 is nagemeten kloppend, en de documenttoets
die dat patroon moest afsluiten doet dat ook aantoonbaar. Van de drie bevindingen hier is er geen
die het gedrag van de workbench raakt; twee gaan over hoe nauwkeurig een test zichzelf beschrijft
en één over een grens die nu gemeten in de docstring hoort.

Ik zie geen reden voor een vijfde ronde. Als er nog iets gebeurt, is het één regel in
`tests/test_plugin_registry.py` plus twee zinnen commentaar, en dat is met de bestaande suites te
verifiëren zonder mij.
