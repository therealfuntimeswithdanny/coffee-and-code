# Coffee & Code — Design Language

> This file distills the visual theme and design language of the project. For full page-structure and template specs, see [SITE-DESIGN.md](SITE-DESIGN.md); the canonical implementation lives in [src/templates/layout.ts](src/templates/layout.ts).

## Identity

- **Publication:** Coffee & Code — *“A small tech news publication built on the AT Protocol by Daniel Morrisey.”*
- **Personality:** independent technology publication — thoughtful, warm, literate, editorial. Never corporate or marketing-flavored.
- **Mood:** quiet, confident, considered. Think contemporary newspaper or literary journal: headlines and journalism lead; interface decoration stays subtle.

## Color system

Dark coffee-brown canvas with restrained sage/stone accents. Defined as CSS custom properties on `:root` and fully re-themed for the optional light mode (`html[data-theme="light"]`).

| Token | Dark value | Light value | Role |
| --- | --- | --- | --- |
| `--paper` | `#281914` | `#faf5ec` | Page/header background |
| `--paper-deep` | `#3b2a1d` | `#efe7d8` | Raised surfaces: footer, cards, placeholders, code blocks |
| `--ink` | `#ffffff` | `#2b1d12` | Primary text, headlines |
| `--accent` | `#b2ac88` | `#6f6335` | Links, labels, interactive emphasis, primary buttons |
| `--muted` | `#b2ac88` | `#6d675a` | Metadata, descriptions, supporting copy |
| `--line` | `rgba(178,172,136,.42)` | `rgba(111,99,53,.38)` | Fine rules, card outlines |
| `--line-strong` | `#b2ac88` | `#6f6335` | Section-bar top rules, emphasized borders |
| `--page-width` | `1180px` | — | Centered content maximum |

Supporting colors:

- Notification badge: `#ed6b79` (red accent, the only warm non-palette hue)
- Light-theme long-form prose ink: `#463c2b`; error text: `#a8462e`
- Selection highlight: accent at ~30–42% opacity

Rules of use:

- Fine rules (1px `--line`, 2px `--line-strong`) do the separating — not heavy cards or shadows.
- Primary action buttons invert the palette: `--accent` background with `--paper` text.
- Image placeholders are deliberate surfaces (`--paper-deep` or a paper→accent gradient with serif lettering), never broken-image grey.

## Typography

Two typefaces form the core voice, loaded from Google Fonts:

- **Lora** (serif) — display, headlines, wordmark, blockquotes, author names. Weight 600–700, tight tracking (`letter-spacing: -.045em` to `-.065em`), compact line-height (~1.1).
- **Source Sans 3** (sans) — body UI, navigation, metadata, controls. Base size 18px, line-height 1.45.

Type patterns:

- **Wordmark:** Lora bold, `clamp(1.55rem, 3vw, 2.3rem)`, shrinks when header compacts on scroll.
- **Section labels / eyebrows / nav:** sans, 12–14px, **bold, uppercase, letter-spacing .07–.1em**.
- **Home lead headline:** `clamp(2rem, 4.2vw, 3.45rem)`; **article headline:** `clamp(2.5rem, 6vw, 4.6rem)`; **front-page masthead h1:** up to 5rem.
- **Article dek/standfirst:** Lora italic-friendly serif, 22px, muted.
- **Prose body:** reader font at `--reader-size` (19px default), line-height 1.75–1.82, measure ~740–820px.
- **Blockquotes:** Lora italic, 1.35rem, 3px accent left border.
- **Code:** `--paper-deep` chip background, rounded 3px; blocks in bordered `--paper-deep` panels.

### Reader & UI font personalization

Users can swap fonts via `html[data-reader-font]` / `html[data-ui-font]` attributes. Options: default (Source Sans 3), `serif` (Lora), `monospace`, `system`, `atkinson` (Atkinson Hyperlegible — accessibility), `merriweather`, `fraunces`, `inter`. All alternates are preloaded; any new font option must be added to the preload list in layout.ts.

## Layout structure

- **Sticky full-width header** on `--paper` at 96% opacity with `backdrop-filter: blur(14px)` and a 1px bottom rule. Three-zone grid: nav left (Latest / Archive / Authors), centered serif wordmark, actions right (Search, RSS, Bluesky, Log in). Compacts to 68px with soft shadow after scrolling. Mobile: hamburger with full-width dropdown, Escape/outside-click dismissal.
- **Content:** centered column, max `--page-width` (1180px), 24px desktop / 16px phone gutters.
- **Footer:** `--paper-deep` surface, top rule, three-column grid (brand/tagline, links, social), compact copyright row.
- **Article page:** 820px reading column with sticky *From the newsroom* rail on wide screens; rail hidden below ~900px.
- **Home:** two-column editorial grid — dominant lead story (1.75/1 aspect cover) beside a narrower "Also new" rail, then numbered *Most read this week*, writers' callout on raised background, three-column archive grid.
- Floating back-to-top control appears on scroll.

## Component language

- **Section bars:** uppercase label + right-aligned count, 2px strong top rule, 1px bottom rule.
- **Story cards (archive grid):** `--paper-deep`, 1px `--line` border, 6px radius, image at 1.55/1 ratio, min-height 380px. Hover: border brightens to `--accent`, lifts 2–3px, soft dark shadow, 200ms transition.
- **Side-rail rows:** 100px square thumbnails, separated by fine rules, two-line clamped headlines.
- **Buttons:** 13px bold uppercase-ish sans, min-height 38px; pressed/active states invert accent/paper.
- **Links:** inherit color in prose contexts use `--accent` with 1px underline (3px offset); hover flips to `--ink`.
- **Metadata:** small muted sans — dates, view counts, "N min read" (~200 wpm).
- **Icons:** Font Awesome 6 (solid + brands) self-hosted woff2.
- **Images:** AT Protocol blobs via `cdn.coffeencode.cc/blob/{did}/{cid}[@ext]/{preset}` — `feed` preset for stories, `avatar` for profiles. Lazy-load below the fold, always preserve dimensions. **No Cloudflare image resizing features — serve originals.**

## Interaction & motion

- Transitions short and subtle (180–200ms ease) — hover lifts, border brightening, header compaction.
- Respect reduced-motion preferences.
- Keyboard focus always visible (accent focus rings, e.g. `0 0 0 2px var(--accent)`).
- `color-scheme: dark` on `:root` (light when themed).

## Responsive breakpoints

| Width | Behavior |
| --- | --- |
| ~1100px | Account page drops from 3 to 2 columns |
| ~900px | Article side rail hidden; mobile nav patterns begin |
| ~760px | Lead + rail stack; grids go single-column; footer simplifies; larger touch targets |
| ~520px | Tighter gutters, smaller wordmark, recommendation cards collapse to rows, wide tables scroll horizontally |

Content order is preserved across breakpoints: lead story → supporting stories → contribution → archive.

## Accessibility & constraints

- Semantic heading order, accessible nav labels, visible focus states, graceful empty states everywhere.
- Alt text required for content images; decorative covers get empty alt.
- `color-scheme` declared per theme so form controls and scrollbars match.
- Editorial first: never let the design drift toward marketing-landing or dashboard aesthetics.
