# Review PR #19 — plugin-architectuur fase 5, ronde 3

- Branch: `feature/plugin-discovery-phase-5` @ `f360340`, verwerking in `4839139`, tegen `main` @
  `06112cd`
- Ronde 2 staat in `docs/reviews/pr-19-plugin-discovery-phase-5-review-findings-2.md` en eindigde op
  *approve with nits* met vier punten
- Uitgevoerd: elf codeervarianten tegen `_checked_asset_path` gelegd **en tegen wat de browser er
  werkelijk mee doet**; de importcontrole in beide richtingen getoetst met vier echte pakketten op
  `PYTHONPATH`, inclusief twee ontwijkingsvormen; `CoreMountTests` met en zonder pakket; de
  half-gemounte-toestand; de volledige verificatie tegen `main`
- Werkkopie schoon na afloop; alle testpakketten opgeruimd, geen servers blijven draaien

**Verdict: approve.**

De vier punten uit ronde 2 zijn alle vier dicht, en een legitiem pakket laat de suite nu groen. Wat
ik nog vond is één ding, en het is geen defect maar een grens die het document niet trekt: de
importcontrole leest alleen statische specifiers.

## Zijn de vier punten uit ronde 2 dicht?

| punt | status |
| --- | --- |
| coderingen passeren de mountgrens | **dicht**, in de richting die telt — geen enkele onveilige afwijking meer |
| importcontrole te krap én te ruim | **dicht** in beide richtingen; zie de bevinding voor de reikwijdte |
| `CoreMountTests` valt om op een pakketrouter | **dicht** |
| `plugin.id` zonder vormcontrole | **dicht**, met een melding die uitlegt waarom |

### De coderingen

`_checked_asset_path` decodeert nu (`unquote`) en behandelt een backslash als separator vóór het
normaliseren. Ik heb elf waarden ernaast gelegd en er telkens bij gemeten wat `new URL(...)` ermee
doet — want dat is de enige vergelijking die iets zegt:

| waarde | check | browser blijft in de mount? | eens |
| --- | --- | --- | --- |
| `plugin-static/mine/x.js` | `True` | ja | ✓ |
| `…/../../secret.js` | `False` | nee | ✓ |
| `…/%2e%2e/%2e%2e/secret.js` | `False` | nee | ✓ |
| `…/%2E%2E/%2E%2E/secret.js` | `False` | nee | ✓ |
| `…/..\..\secret.js` | `False` | nee | ✓ |
| `…/%252e%252e/…` (dubbel gecodeerd) | `True` | **ja** — blijft een letterlijk segment | ✓ |
| `…/%00../../secret.js` | `True` | **ja** — de `..` popt `%00..` | ✓ |
| `…/..%2e/..%2e/secret.js` | `True` | ja | ✓ |
| `…/....//....//secret.js` | `True` | ja | ✓ |
| `…/%c0%af..%c0%afsecret.js` | `True` | ja | ✓ |
| `…/..%2f..%2fsecret.js` | `False` | **ja** | ✗ te streng |

**Geen enkele onveilige afwijking**: alles wat de check accepteert, houdt de browser binnen de
mount. De ene meningsverschil is de andere kant op — `unquote` decodeert `%2f` tot een separator
terwijl de URL-parser dat niet doet, dus een bestandsnaam met een letterlijke `%2f` wordt geweigerd.
Dat valt de veilige kant op en is in de praktijk onvindbaar. De frontendwachten in `iconMarkup` en
`applyPluginStyles` weigeren nu ook `%` en `\`, waarmee ze strenger zijn dan de core en dus nooit
iets doorlaten wat de core zou weigeren.

### De importcontrole

Getoetst met vier echte pakketten, elk met `dist-info` op `PYTHONPATH`:

| pakket | uitkomst |
| --- | --- |
| **A.** schoon: eigen views, eigen router, `../../src/shared/api/request.js` voor de core | alles groen op `test_without_packages_the_menu_is_the_registry` na |
| **B.** `import … from '/src/plugins/llm-pool/api.js'` | **`test_no_view_imports_outside_its_own_plugin` faalt** ✓ |

Daarmee zijn beide kanten uit ronde 2 opgelost: de core relatief importeren wordt niet meer
onterecht gemeld, en de absolute vorm naar een andere plugin wordt wél gevangen. De lijst met
toegestane prefixen (`/src/shared/`, `/foundation/`, de eigen plugin, de map van de module zelf) is
precies genoeg: niet te ruim — alle vier zijn core of eigendom — en niet te krap, want zowel de
ingebouwde suite als pakket A blijft groen.

Dat `test_without_packages_the_menu_is_the_registry` omvalt zodra er echt een pakket geïnstalleerd
staat, is een toets die een schone omgeving veronderstelt. Dat blijft een redelijke aanname.

### `CoreMountTests` en de id

`CoreMountTests` klopt nu in beide richtingen: met pakket A groen, en zonder pakket identiek aan wat
het was (185 passed). Een half gemounte map is niet mogelijk — met een goed eerste en een kapot
tweede pakket:

```
ValueError: plugin zzz from z (m:f) has no static_dir at /bestaat/niet
_DISCOVERED na de fout: None
```

`discovered_packages()` gooit als geheel en cachet niets, dus de mountlus in `app/main.py` begint
niet.

De id-vorm `^[a-z0-9-]+$` staat in het ontwerpdocument (regel 469 en 579) en de melding legt uit
waarom:

```
plugin id 'My_Plugin' from ep (m:f) must match ^[a-z0-9-]+$: it ends up in the mount path
and in the frontend's icon pattern
```

Dat is de juiste grens. De wrijving is echt — een pakket `my_plugin` moet `my-plugin` als id kiezen
— maar de alternatieven zijn slechter: zonder die controle mount een id met een hoofdletter of een
spatie prima en gooit `checkedIconName` daarna op het icoonpad, wat de hele sidebar leegt. Dat heb ik
in ronde 2 gemeten, en dit sluit het bij de bron in plaats van bij het symptoom.

## Bevinding

### Laag — de importcontrole leest alleen statische specifiers

De regex is `from\s*['"]([^'"]+)['"]`. Twee vormen vallen daarbuiten, allebei met een echt pakket
getoetst:

| vorm | suite | browser |
| --- | --- | --- |
| `import('/src/plugins/llm-pool/api.js')` — dynamisch | **43 passed, geen melding** | werkt: de view leent 5 methoden, geen fouten |
| `import '/src/plugins/llm-pool/api.js';` — side-effect, geen `from` | **43 passed, geen melding** | laadt |

De dynamische vorm heb ik in Chromium laten lopen: de pakket-view kreeg vijf methoden van llm-pool
binnen zonder dat iets omviel.

Ik noem dit laag en niet medium, omdat het geen defect is maar een reikwijdte. De controle vangt
elke vorm die je per ongeluk schrijft — een relatieve of absolute `from`-import — en mist de twee
die je bewust kiest om eromheen te werken. In een frontend zonder sandbox valt die laatste categorie
sowieso niet dicht te timmeren; dat is precies waarom de scopegrens "alleen first-party" er staat.

Wat er wel hoort te gebeuren: het opschrijven. De fase-5-sectie stelt *"Regel 2 is geen goede
intentie maar een toets"*, en dat leest nu als een absolute garantie. Eén zin — de toets leest
statische imports, een dynamische `import()` is niet af te dwingen zonder isolatie — maakt de
belofte even sterk als hij werkelijk is. Dat is dezelfde eerlijkheid die de rest van dit document
overal toepast.

## Is er iets nieuws stukgegaan?

Nee.

| controle | resultaat |
| --- | --- |
| `pytest` | 185 passed, 5 failed (de bekende replay-failures, ook op `main`) |
| `node --test` | 4 pass |
| browsercheck | exit 0 |
| documenttoets (regelverwijzingen) | 2 passed |
| routes vs `main` | identiek, 121 |
| payload vs `main` | identiek op de `styles`-sleutel na |
| een legitiem pakket geïnstalleerd | groen, op de schone-omgevingstoets na |

## Samenvatting

- De mountgrens is dicht: elf coderingen geprobeerd, geen enkele onveilige afwijking tussen wat de
  check accepteert en wat de browser doet. De ene afwijking is te streng en valt de goede kant op.
- De importcontrole in URL-ruimte lost beide klachten uit ronde 2 op, en de prefixlijst is goed
  afgesteld.
- Een legitiem pakket laat de suite groen — dat was het punt waarop iemand die een plugin
  installeert vorige ronde meteen vastliep.
- Eén ding over: schrijf op dat de toets statische imports leest. Geen code, één zin.
