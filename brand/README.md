# AgentZero logo assets

Colours: Black #000000 · Ember #170C0D · Signal Red #FF2E55 (ring + "Zero") · White #FFFFFF
The name is outlined vector paths (Outfit SemiBold), so no font install is needed.

## Colour versions
- primary: white A, red ring, "Zero" in Signal Red. On Black or Ember. The default.
- white: all white. On photos, Signal Red or busy backgrounds.
- black: all black. On white/light backgrounds.

## Folders (svg/ and png/)
- mark: the symbol only, no name
- wordmark: the name only
- lockup-horizontal: symbol + name side by side (website header, email signature, decks)
- lockup-stacked: symbol above name (splash screens, social posts, merch)
- app-icon: full-bleed black square (App Store / Play Store; they round corners themselves), rounded square, Ember version, social avatar (safe for circle crops)
- web/: favicon.svg, favicon-16/32/48.png, apple-touch-icon.png (180), icon-192/512.png (PWA manifest), og-image.png (1200×630 link preview)

## Website <head>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta property="og:image" content="/og-image.png">

## Rules
- Clear space: at least 3× the ring's line thickness on every side.
- Minimum size: symbol 16px, horizontal lockup 120px wide.
- Don't recolour, stretch, rotate, add effects, or use the primary version on light backgrounds.
