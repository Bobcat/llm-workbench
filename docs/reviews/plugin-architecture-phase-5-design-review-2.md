# Ontwerpreview — fase 5, ronde 2

- Branch: `feature/plugin-discovery-phase-5` @ `280a8bc`, herziening in `ef90f68`, tegen `main` @
  `06112cd`
- Ronde 1 staat in `docs/reviews/plugin-architecture-phase-5-design-review.md` en eindigde op
  *changes requested*
- Uitgevoerd: de wortel-per-view **geprototypeerd** tegen een echt nagebouwd extern pakket buiten
  `static/`; de drie helpers daarop losgelaten; het gedrag bij een niet-bestaande wortel gemeten;
  de consistentie van het `module`-veld, de icoonregel en de twee scopelijsten door het hele
  document nagelopen; de drie suites op beide kanten gedraaid
- Er is geen code gewijzigd; de branch raakt alleen het document

**Verdict: approve with nits.**

Van de drie contractpunten uit ronde 1 zijn er twee volledig gesloten en is er één gesloten op de
helft die ik kon meten — de wandeling werkt aantoonbaar buiten `static/` — terwijl de andere helft,
hoe een bestand aan een plugin wordt toegeschreven, nog niet in het ontwerp staat. Dat is een zin,
geen herontwerp, en het faalt luid in plaats van stil. De rest zijn drie kleine inconsistenties
tussen de fase-5-sectie en de secties eromheen.

## Zijn de punten uit ronde 1 afgehandeld?

| punt uit ronde 1 | status |
| --- | --- |
| padanalyse kan regel 2 niet afdwingen | **half** — zie bevinding 1 |
| absoluut `module`-pad geeft de subpad-eigenschap op | **opgelost**, met de meting erbij |
| `icon` als pad opent een vierde injectiepunt | **opgelost** in de fase-5-sectie; sectie 4 loopt achter (bevinding 3) |
| `styles` past niet in de payloadpin | **opgelost**, als bewust gevolg benoemd |
| ontbrekende faalmodes | **opgelost**, vier gevallen met een expliciete keuze |
| sectie 6 heeft niets open | **opgelost**, met een kanttekening (nit 4) |

### Het relatieve `module`-pad — opgelost

De sectie kiest nu `plugin-static/<plugin-id>/view.js` zonder leidende slash en zet mijn meting er
als tabel bij. Die tabel klopt met wat ik zelf mat: onder basis `http://host/workbench/` resolvet
het relatieve pad naar `…/workbench/plugin-static/mine/view.js` en het absolute naar
`/plugin-static/mine/view.js`, met de basis weg. De keuze om de servermount absoluut te houden en
het payloadpad relatief is intern consistent: de browser plakt het aan `document.baseURI`, en het
voorvoegsel dat een proxy eventueel stript zit aan de serverkant.

### De faalmodes — opgelost

Vier gevallen met een keuze in plaats van stilte, en de redenen kloppen. De keuze bij een
ontbrekende `static_dir` is de juiste en de onderbouwing is scherp: de core mag zijn eigen map stil
overslaan (`app/main.py:74`) omdat er dan simpelweg geen frontend is, maar bij een plugin betekent
hetzelfde gedrag dat zijn views niet laden terwijl hij wel in het menu staat. Dat "twee entry points
uit één pakket gewoon twee plugins zijn" is ook het juiste antwoord: het pakket is geen eenheid, de
plugin wel.

De sortering binnen discovery op plugin-id is niet cosmetisch en de sectie zegt waarom: de landing
is `WORKFLOWS[0]` (`static/app.js:331`). Dat klopt met de code.

## Bevindingen

### Laag/medium — de wortel repareert de padanalyse, maar niet de eigendomstoets

Ik heb de wortel-per-view nagebouwd: een map buiten `static/` met een view die relatief een client
importeert, en die client met twee `/api`-literals erin. De drie helpers erop losgelaten:

```
_module_files : 3 bestanden -> ['api.js', 'request-stub.js', 'view.js']
_api_paths    : ['/api/mine/things']
_client_owners: set()
```

De eerste helft van de bewering klopt dus: **dezelfde wandeling werkt op een `static_dir` buiten
`static/`**, en `_api_paths` vindt wat er staat. Dat was het punt waar ronde 1 op viel, en het is
opgelost.

`_client_owners` niet. Die bepaalt eigendom aan de hand van de *locatie*:

```
PLUGIN_ROOT = …/static/src/plugins
relative_to -> ValueError: '/tmp/…/mine_static/api.js' is not in the subpath of '…/static/src/plugins'
```

Alles buiten die map wordt overgeslagen, dus voor een gevonden plugin is de uitkomst leeg. Het
gevolg is precies het patroon uit ronde 1, één laag dieper:

- `test_no_view_imports_another_plugins_client` — de toets die regel 2 draagt — vergelijkt
  `owners - {plugin.id}` met `set()`. Met een lege `owners` slaagt hij zonder iets te controleren;
- `test_the_scan_finds_a_client_for_every_view_with_paths`, de controle op de controle, valt nu wél
  om, want er zijn paden en geen eigenaar.

Dat is beter dan ronde 1, waar allebei stil doorgingen: het faalt luid, en luid falen is het veilige
einde. Maar het betekent dat wie precies bouwt wat er staat, de suite rood ziet worden op een
**correcte** externe plugin, en dan ter plekke moet bedenken hoe toeschrijving werkt.

Het antwoord ligt in het ontwerp zelf klaar: dezelfde `static_dir` die de wortel levert, kan de
eigenaar leveren — een bestand onder de `static_dir` van plugin X hoort bij X, net zoals een bestand
onder `static/src/plugins/<id>/` vandaag bij `<id>` hoort. Dat moet er alleen staan; de sectie zegt
nu alleen dat de analyse een wortel krijgt, en dat is de helft.

### Laag — sectie 2 zegt nog dat `module` een pad onder de static root is

`docs/plugin-architecture.md:76`: *"`module` | pad onder de static root, geresolveerd tegen
`document.baseURI`"*. Na fase 5 is dat voor een plugin niet waar: `plugin-static/<id>/view.js` wordt
uit de `static_dir` van het pakket geserveerd via een eigen mount, niet uit `static/`. De
fase-5-sectie is hier nu expliciet en correct over; sectie 2 — de plek waar een lezer het
veldcontract opzoekt — spreekt hem tegen.

Dezelfde formulering staat in `static/src/plugins/registry.js:25`. Dat is code en valt buiten deze
review, maar het is dezelfde zin en zal dezelfde correctie nodig hebben.

### Laag — sectie 4 noemt het icoon niet, terwijl de fase-5-sectie dat juist toevoegt

De fase-5-sectie zegt nu terecht: *"drie velden escapen, het vierde veld een vormcontrole geven én
escapen — anders sluit deze fase drie gaten en opent ze er één."* Het gat in sectie 4
(`docs/plugin-architecture.md:600-603`) is niet meegegroeid en beslist nog steeds alleen over
`name`, `tooltip` en `route`.

Dat is de sectie waar iemand naar kijkt met de vraag "wat is hierover besloten", dus de beslissing
hoort daar compleet te staan. Een halve regel volstaat.

### Nit — de twee buiten-scope-lijsten lopen uiteen

De scopegrens van fase 5 (`:525-528`) noemt: derden isoleren, ingebouwde plugins blijven in de repo,
hot reload, een versiebeleid **en een pluginregister**. De lijst in sectie 6 noemt de eerste vier en
laat het pluginregister weg. Klein, maar het zijn twee lijsten die hetzelfde horen te zeggen en de
tweede is er net bijgekomen.

### Nit — niets controleert het icoonpad van een plugin

Voor de ingebouwde plugins verifieert de JS-suite dat elk icoon in de sprite zit. De sectie zegt dat
die toets "over die gevallen" gaat — dus over sprite-id's — en dat klopt, maar er komt niets voor in
de plaats voor een pad-icoon. Een typefout in `plugin-static/<id>/icon.svg` is dan een gebroken
plaatje dat geen enkele toets ziet, terwijl de vormcontrole alleen zegt dat het pad er goed *uitziet*.
Een bestaanscontrole op de `static_dir` is dezelfde wandeling die de padanalyse toch al maakt.

## Is het ontwerp klaar om gebouwd te worden?

Ja, met één zin erbij. De drie contractpunten:

1. **De adresregel.** De wortel is de juiste oplossingsrichting en werkt aantoonbaar; wat ontbreekt
   is hoe een bestand aan een plugin wordt toegeschreven. Zonder dat is regel 2 nog steeds niet
   afgedwongen — het verschil met ronde 1 is dat je het nu meteen merkt.
2. **Het relatieve `module`-pad.** Klopt, en de meting staat erbij.
3. **Het icoon.** Klopt in de fase-5-sectie; sectie 4 moet meebewegen.

De overige beslissingen zijn ongewijzigd goed: de trust-grens, "de ingebouwde plugins blijven de
regressiebasis", en de twee beslissingen die sectie 4 uit deze fase overnam (weigeren bij het laden,
en escapen) staan nog steeds juist — de tweede alleen te smal geformuleerd.

| suite | branch | `main` |
| --- | --- | --- |
| `pytest` | 161 passed, 5 failed | 161 passed, 5 failed — dezelfde vijf |
| `node --test` | 4 pass | — |
| browsercheck | exit 0 | — |

Er is door de herziening niets stukgegaan: de branch raakt geen code, en de drie suites staan
identiek aan `main`.

## Samenvatting

- Twee van de drie contractpunten uit ronde 1 zijn dicht; het derde is dicht op het deel dat ik kon
  meten en open op de toeschrijving.
- Vóór de bouw toevoegen: dat een bestand onder de `static_dir` van een plugin bij die plugin hoort.
  Eén zin, en het maakt regel 2 werkelijk afdwingbaar.
- Bijwerken: `module` in sectie 2, het icoon in de escape-beslissing van sectie 4, en het
  pluginregister in de lijst van sectie 6.
- Overwegen: een bestaanscontrole op een pad-icoon, nu de sprite-toets daar niet meer over gaat.
