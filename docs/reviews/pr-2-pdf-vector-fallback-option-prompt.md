# Reviewprompt PR #2 — PDF-vectorfallback als renderoptie

Review de branch `feature/pdf-vector-fallback-option` tegen `main` in
`/home/gunnar/projects/llm-workbench`.

Schrijf de review naar:

`docs/reviews/pr-2-pdf-vector-fallback-option.md`

## Context

De translation service accepteert bij een vector-PDF-aanvraag een expliciete
keuze voor capabilityweigeringen:

```text
pdf_vector_fallback: "reject" | "raster"
```

`reject` is de veilige default. `raster` staat expliciet toe dat het volledige
document via bitmappagina's wordt uitgevoerd wanneer de vectorroute het niet
veilig ondersteunt.

Deze PR voegt die keuze toe aan het bestaande Render-paneel van de
PDF-translationworkflow. Dezelfde waarde wordt gebruikt voor een eerste run en
voor rerendering. Bij een toegestane fallback toont de timingkaart de werkelijk
gebruikte route en reasoncodes. Bij een weigering toont de bestaande statusregel
de stabiele foutcode en capabilityreden.

Lees eerst:

- `README.md`
- `docs/README.md`
- `static/src/workflows/pdf-translation/index.js`

## Scopegrens

Dit is één optie in de bestaande PDF-workflow. De PR voegt geen route, scherm,
documenteditor of browsereditor toe. Zij verandert ook geen backendbeleid en
raakt de SaaS-client niet.

## Te beoordelen

- Is `reject` zichtbaar en technisch de default?
- Stuurt zowel de eerste submit als rerender exact `pdf_vector_fallback` mee?
- Is duidelijk dat de optie niets verandert bij een directe rasteraanvraag?
- Wordt de optie tijdens een lopende request samen met de andere renderopties
  uitgeschakeld?
- Triggert een wijziging op een voltooid document de bestaande cached rerender,
  zonder nieuwe translationworkflow te introduceren?
- Rapporteert de outputregel de werkelijke route wanneer vector gevraagd maar
  raster uitgevoerd werd?
- Toont een terminale `PDF_VECTOR_OUTPUT_UNSUPPORTED`-lifecyclefout zowel de
  foutcode als de vroege of late capabilityreden?
- Blijft de raw lifecycle-response beschikbaar voor pagina- en groepsdetails?
- Is er nergens browsereditorfunctionaliteit of voorbereidende editorstructuur
  toegevoegd?

## Verificatie

Controleer handmatig in de browser:

1. een vectorrequest met `reject` dat de backend accepteert;
2. een vectorrequest met `reject` dat de backend weigert;
3. hetzelfde unsupported document met `raster`;
4. een rerender die tussen beide waarden wisselt;
5. een directe rasterrequest.

Controleer in de netwerkpayloads dat de waarde bij submit en rerender aanwezig
is. Controleer bij geval 2 de statusregel en raw response; controleer bij geval
3 de Output-regel in de timingkaart.

Op deze host is geen Node-runtime aanwezig, dus er is geen afzonderlijke
JavaScript-parser of frontendtestsuite gedraaid. Een tijdelijke lokale server
en headless Chromium laadden wel de applicatie en de gewijzigde ES-module zonder
syntax- of modulefout. De Python-suite van de workbench gaf **110 passed, 5
failed**. Dezelfde vijf tests falen op `main`, en deze PR wijzigt geen
Pythonbestand. De failures vallen daarom buiten deze diff; hun oorzaak is hier
niet vastgesteld.

## Gewenste reviewuitkomst

Noteer bevindingen op ernst en met bestand/regel. Eindig met één verdict:

- approve;
- approve with nits;
- changes requested.
