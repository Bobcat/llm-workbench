# Review PR #20 — de vier open gaten uit sectie 4

- Branch: `feature/open-gaps-cleanup` @ `40844f7`, tegen `main` @ `06112cd`
- Beoordeeld: `21c9018` (b), `2d13863` (c), `7142b4f` (a) en `a37d2ca` (d), plus de
  documentwijziging
- Uitgevoerd: de zeven oude loaderkopieën vergeleken en de twee nieuwe **gedragsmatig** getoetst over
  tien bestandsvormen; het foutpaneel in beide faalgevallen gemeten plus het pakketgeval; de
  terugval in Chromium over zeven scenario's inclusief lusdetectie; de rookproef van punt c
  gemuteerd; de icoonregels voor beide wortels afgetast; de volledige verificatie tegen `main`
- Werkkopie schoon na afloop; alle mutaties teruggedraaid, testpakketten en `config/local.json`
  opgeruimd, geen servers blijven draaien

**Verdict: approve with nits.**

De vier punten zijn af. Punt a heeft het gedrag van de diensten aantoonbaar niet veranderd, punt c
breekt niets en kan niet in een lus komen, en punt b helpt in allebei de gevallen waarvoor het
paneel bestaat. Wat overblijft is één asymmetrie binnen punt d: het icoon kreeg een wortelpatroon
voor de ingebouwde kant, `styles` niet.

## Punt a — is het gedrag van de diensten onveranderd?

Ja, en niet op de gok. Eerst de uitgangspositie op `main` nagemeten: van `_load_json_object` waren
er zeven kopieën in **twee** vormen — zes byte-identieke in de diensten en de strenge in
`plugins.py` — en van `_merge_json_objects` zeven kopieën in **één** vorm. Dat klopt met wat de
commit zegt.

Daarna gedragsmatig vergeleken: de oude dienstkopie letterlijk overgenomen en naast `load_object`
gezet, over tien bestandsvormen:

| geval | oud = nieuw |
| --- | --- |
| bestand bestaat niet, leeg, alleen witruimte | ja (`{}`) |
| geldig object, ook genest | ja |
| lijst / string / `null` / getal als root | ja (`{}`) |
| kapotte JSON | ja — **`JSONDecodeError`, net als voorheen** |
| BOM vóór het object | ja — `JSONDecodeError` |

Dezelfde tien tegen `load_object_or_raise` en de oude `plugins.py`-kopie: ook tien van de tien
gelijk. `merge_objects` klopt over zeven samenvoegingen, inclusief het geval waar een object door
een niet-object wordt vervangen en andersom.

De rolverdeling klopt ook: zes dienstmodules importeren `load_object`, alleen `app/plugins.py:34`
importeert `load_object_or_raise`, en er staat nergens nog een eigen kopie.

**Zouden twee functies beter één functie met een argument zijn?** Nee. `load_object_or_raise(path)`
zegt op de aanroepplek wat er gebeurt; `load_object(path, strict=True)` zou een vlag zijn waarvan je
de betekenis moet opzoeken, en dit is precies het onderscheid dat in ronde 3 van PR #17 een
bevinding was. De module-docstring legt bovendien uit *waarom* er twee zijn en wat het verschil
betekent voor de lezer van een settingsbestand. De prijs is vier gedupliceerde regels (bestaat /
leeg); daar een derde private functie voor optuigen levert minder op dan het kost.

## Punt b — helpt het paneel nu echt?

Ja, en het is eerlijk in beide gevallen. Gemeten met een draaiende server:

| geval | paneeltekst |
| --- | --- |
| de lijst komt niet aan (request afgebroken) | identiek |
| de server weigert de lijst (`plugins.enabled: ["tikfout"]`) | identiek |

De tekst biedt twee dingen om te controleren — of de server draait, en `plugins.enabled` in
`config/settings.json` of `config/local.json` — zonder te beweren wat de oorzaak is. Er staat dus
niets in dat maar voor één van de twee waar is, en de verwijzing is concreet genoeg: bestandsnaam,
sleutelnaam, en de mededeling dat de serverlog het bestand noemt. Dat laatste is het stuk dat iemand
werkelijk verder helpt, en het klopt: sinds PR #17 ronde 2 noemt de melding het bestand waar de lijst
echt vandaan kwam.

Het derde denkbare geval — een kapot **pakket** — bereikt het paneel niet, want dan start de server
niet eens:

```
ValueError: plugin bad from bad (bad_plugin:make) has no static_dir at /bestaat/echt/niet
```

Daar kan de tekst dus ook niet misleiden.

Klein: *"a category id that does not exist makes /plugins.js fail"* noemt één van meerdere oorzaken
— een lege lijst, een `plugins` van de verkeerde vorm en kapotte JSON doen dat ook. Het wijst wel de
goede instelling aan en verwijst door naar de log, dus ik reken het niet als bevinding.

## Punt c — dekt de terugval, en breekt hij niets?

Alles gemeten in Chromium:

| scenario | uitkomst |
| --- | --- |
| deep link `#bestaat-niet` | hash herschreven naar `#replay-translate`, landing actief |
| deep link naar een alias `#ad-hoc-prompt` | alias blijft staan, `text-generation` actief — terecht niet aangeraakt |
| hashwijziging tijdens de sessie naar iets onbekends | hash gecorrigeerd naar de landing |
| alias tijdens de sessie `#vlm-test` | werkt, geen terugval |
| sidebarklik daarna | normaal |
| terug / vooruit | correct, geen inmenging |
| lusdetectie | één slechte hash = precies één history-entry erbij |
| pageerrors | geen |

De binding is de juiste. `router.navigate(..., {replace: true})` gaat via `history.replaceState`, en
dat vuurt noch `hashchange` noch `popstate` — dus de terugval kan zichzelf niet opnieuw triggeren.
Dat de listeners ná `router.bindPopState` (`static/app.js:352`) staan klopt ook: de router krijgt
eerst de kans te navigeren, en pas als die de route niet kent grijpt de terugval in.

**Observatie, geen bevinding.** De terugval verplaatst de gebruiker nu naar de landing wanneer hij
tijdens de sessie een hash vertypt; vóór deze commit bleef de view staan en loog alleen de url. Dat
is wat het gat vroeg ("normaliseer de hash naar de landing, net als bij een koude start"), maar het
is wel een zichtbare gedragsverandering en geen zuivere correctie.

**De rookproef vangt, maar half.** Zoals gevraagd de terugval weggehaald:

| mutatie | browsercheck |
| --- | --- |
| beide listeners weg | **exit 1** — *"a hash outside the menu was left in the address bar"* |
| alleen `hashchange` weg | exit 0 |
| alleen `popstate` weg | exit 0 |

Chromium vuurt bij een fragmentwijziging allebei de events, dus één listener volstaat er. De
controle bewijst dus dat de terugval bestaat, niet dat de dubbele binding nodig is — en die
noodzaak is per definitie niet in Chromium te meten. Het commentaar in de code legt uit waarom er
twee zijn; dat scenario één keer in WebKit of Firefox draaien zou de claim toetsbaar maken.

## Punt d — klopt de regel voor beide wortels?

Ja, en even streng. De twee patronen verschillen alleen in hun wortel, en de `escapes`-wacht
(`..`, `%`, `\`) draait vóór allebei. Afgetast:

| waarde | pad-icoon? |
| --- | --- |
| `src/plugins/llm-pool/icon.svg`, `plugin-static/mine/icon.svg` | ja |
| `…/../../assets/icons.svg`, `…/%2e%2e/x.svg` | nee |
| `/src/plugins/llm-pool/icon.svg` (absoluut) | nee |
| `src/workflows/chat/icon.svg` (andere wortel) | nee |
| `src/plugins//icon.svg`, `src/plugins/llm-pool/` | nee |

Geen derde vorm gevonden die erdoorheen komt. De bestaanscontrole werkt ook voor de ingebouwde
wortel: een icoon naar `src/plugins/llm-pool/bestaat-niet.svg` laat
`test_every_view_module_and_path_icon_exists` vallen.

**Is het eerlijk dat de core een ingebouwd icoonpad niet controleert?** Ja. Het is core-code, het
wordt gereviewd als de rest, en de realistische fout — een typefout in het pad — wordt door de
bestaanscontrole gevangen. Maar dan hoort die redenering wel consequent te zijn, en dat is ze niet:

### Laag — `styles` kreeg geen wortelpatroon, het icoon wel

`applyPluginStyles` (`static/app.js`) weigert alleen `..`, `%` en `\`. Er is geen wortelpatroon,
dus:

| stylepad | doorgelaten | resolveert naar |
| --- | --- | --- |
| `src/plugins/llm-pool/x.css` | ja | eigen map ✓ |
| `https://evil.example/x.css` | **ja** | een andere origin |
| `//evil.example/x.css` | **ja** | een andere origin |
| `/etc/x.css` | **ja** | buiten elke pluginmap |
| `src/workflows/chat/x.css` | **ja** | andermans map |
| `../../x.css` | nee | — |

Voor een **pakket** vangt de core dit: `_checked_asset_path` draait ook over `plugin.styles`. Voor
een **ingebouwde** plugin vangt niets het, want `_validate_package` wordt alleen vanuit
`_discover_packages` aangeroepen (`app/plugins.py:355`). Punt d opent `styles` dus voor de
ingebouwde kant zonder de wacht die het in dezelfde commit wél aan het icoon gaf.

De impact is klein — het is core-code, net als bij het icoon — maar de inconsistentie zit binnen één
commit: hetzelfde argument leidde bij het ene veld tot een patroon en bij het andere niet. Eén
`BUILT_IN_STYLE_PATTERN` naast het icoonpatroon, of de `escapes`-wacht uitbreiden met een
wortelcontrole, trekt het gelijk.

Los daarvan: geen van beide patronen koppelt de `<id>` in het pad aan de plugin die het veld
declareert. Een view van llm-pool mag `src/plugins/image-pool/icon.svg` opgeven; alleen de
handgeschreven sidebarpin merkt dat, en dat is een pin en geen regel. Voor een pakket is die
koppeling er wél, via `_checked_asset_path(plugin.id, …)`.

## Wat is er niet af?

Geen enkele ingebouwde plugin gebruikt vandaag een pad-icoon of een stylesheet — gemeten: alle
iconen zijn nog sprite-id's en `styles` is overal leeg. Punt d is dus een mogelijkheid zonder
gebruiker in de repo, alleen uitgeoefend in de toetsen.

Dat lijkt me de juiste grens, en om dezelfde reden als in fase 5: de mogelijkheid toevoegen is iets
anders dan de migratie doen, en `css/app.css` opsplitsen zou een indelingswijziging door een
opruiming van vier losse punten heen hebben gemengd. Het heeft wel een prijs, en die is hierboven
zichtbaar: omdat niets in de repo het nieuwe pad gebruikt, viel het ontbrekende wortelpatroon op
`styles` nergens op.

## Is er iets nieuws stukgegaan?

Nee.

| controle | branch | `main` |
| --- | --- | --- |
| `pytest` | 197 passed, 5 failed | 185 passed, 5 failed — dezelfde vijf |
| `node --test` | 5 pass (één toets erbij) | — |
| browsercheck | exit 0 | — |
| documenttoets | 2 passed | — |
| routes | identiek, 121 | |
| payload | **volledig identiek** | |

De payload is overigens niet "identiek op `styles` na" zoals de prompt zegt: die sleutel kwam met
fase 5 mee en staat dus al op `main`. Hij is nu helemaal gelijk.

## Samenvatting

- Punt a is aantoonbaar gedragsneutraal: twintig gedragsvergelijkingen, geen enkel verschil, en de
  twee losse functies zijn de betere keuze boven één met een vlag.
- Punt b klopt in beide gevallen waarvoor het paneel bestaat; het derde geval haalt het paneel niet
  omdat de server dan niet start.
- Punt c dekt alle zeven scenario's, kan niet lussen, en breekt niets — met één zichtbare
  gedragsverandering en een rookproef die de dubbele binding niet kan toetsen.
- Punt d klopt voor beide wortels, behalve dat `styles` aan de ingebouwde kant zonder wortelcontrole
  blijft. Dat is het enige dat ik zou repareren.
