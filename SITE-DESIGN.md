# Coffee & Code: Site Design Reference

Use this document as the visual and structural reference for the Coffee & Code publication website. Keep the established independent-publication character and page types while refining the implementation. Story and author details are dynamic content, never fixed design copy.

The publication tagline is **“A small tech news publication built on the AT Protocol by Daniel Morrisey.”** The masthead uses the publication name alone; do not add a descriptor below it.

## Brand and visual direction

- **Personality:** Independent technology publication: thoughtful, warm, literate, and editorial rather than corporate or product-marketing focused.
- **Overall look:** A dark coffee-brown canvas with restrained sage/stone accents, fine rules, generous editorial typography, and real story photography where available. The visual language should feel like a contemporary newspaper or literary journal.
- **Mood:** Quiet, confident, and considered. The dark coffee theme stays intact while type hierarchy, spacing, imagery, and consistent component details make the publication feel finished and trustworthy. Headlines and journalism lead; interface decoration stays subtle.

### Color palette

| Role | Color | Use |
| --- | --- | --- |
| Main background | `#281914` | Page and header background |
| Raised background | `#3b2a1d` | Footer, secondary surfaces, image placeholders |
| Primary text | `#ffffff` | Headlines and high-emphasis text |
| Reading text | Soft ivory | Article paragraphs and long-form copy |
| Accent | `#b2ac88` | Links, labels, borders, and interactive emphasis |
| Muted text | `#b2ac88` | Descriptions, dates, and supporting copy |
| Fine rules | Accent at about 42% opacity | Separators and card outlines |

Maintain readable contrast. Use soft ivory for long-form reading text and the sage/stone accent for supporting metadata and interactive emphasis. Image placeholders should use publication colors rather than resemble failed image loads.

### Typography

- **Display and editorial headings:** Lora, serif; medium-to-bold weights.
- **Body, navigation, metadata, and controls:** Source Sans 3, sans-serif.
- **Headlines:** Prominent, compact line-height, and a clear scale hierarchy. Let long titles wrap naturally and scale down on narrow screens.
- **Navigation and section labels:** Small, bold, uppercase, with expanded tracking.
- **Reading text:** Comfortable measure (roughly 740px for article prose) and generous line-height.

## Shared site shell

- A full-width sticky header sits above a centered content area, with a fine accent-colored bottom rule and dark coffee-brown surface.
- On wide screens, the header has three zones: **Latest**, **Archive**, and **Authors** navigation on the left; publication wordmark centered; and **Search**, **RSS**, Bluesky, and **Log in** actions on the right.
- The wordmark uses the editorial serif. Keep the header focused on publication navigation and actions, without an extra descriptor beneath the logo. After scrolling, the header shortens and gains a soft shadow; the wordmark scales down.
- On mobile, replace desktop navigation with a menu button. Keep the wordmark and compact actions visible; reveal navigation in a full-width dropdown below the header.
- Main content uses a centered maximum width of about 1180px, with 24px desktop gutters and 16px phone gutters.
- The footer uses the raised coffee-brown surface and a top rule. It contains publication identity, description, social/feed links, and a compact copyright line.
- A floating back-to-top control appears after the visitor scrolls down the page.

## Page templates

### Home / Latest

1. Begin with a compact ruled section bar labeled **Latest**, with the current story count aligned opposite it.
2. Below it, use a two-column editorial layout: a dominant lead story on the left and a narrower **Also new** rail on the right.
3. The lead story contains a wide landscape cover image (or a restrained branded placeholder), a small **Most recent** label, a large headline, a short summary, author/date metadata, view count, and a clear read-story action.
4. The side rail contains up to four compact story rows with a small square thumbnail, headline, and date/views metadata. Rows are separated by fine rules rather than cards.
5. Follow the lead area with a contribution callout on the raised background, inviting writers to participate.
6. Show remaining recent stories in a three-column archive-style grid, followed by a **View all stories** link.
7. If no lead story exists, show a simple empty-state message in its place.

### Article detail

- On wide screens, use an article column up to about 820px and a narrow, sticky **From the newsroom** rail. Hide the rail on smaller screens to preserve reading width.
- Start with an **All stories** back link, a small editorial label, a large headline, optional serif standfirst, author/date attribution, and subdued view count.
- Show an optional wide cover image before the article body.
- Keep body copy near 740px wide with generous leading and a clear hierarchy for headings, paragraphs, lists, links, quotations, code, tables, and responsive images.
- Keep comments within the article reading flow and end the article with a compact source/footer link.
- After the article, show a **Continue reading** section with up to three related recent stories. Each entry may include a landscape image, headline, short excerpt, and date. Collapse these into compact rows on small phones.
- If there are no other stories, omit both the latest-story rail entries and recommendation section gracefully.

### Archive

- Start with an archive search field and submit button.
- Use a ruled section heading with **Archive** and a result count.
- Present stories as a responsive grid/list of editorial entries. Each entry may include a landscape image, date, headline, short excerpt, view count, and read link.
- Preserve clear empty states for an archive with no stories and for a search with no matches.

### Authors

- The author directory begins with a small **Contributors** label and a prominent **Authors** heading.
- Show authors in a two-column grid on desktop, collapsing to one column on mobile.
- Each compact author entry pairs a circular portrait (or simple placeholder) with the author's name and story count.
- An individual author page has a portrait and name in its header, followed by a ruled **Stories** heading/count and the same story-entry pattern used in the archive.

### Not found

- Use a restrained text-led message with a small 404 label, a clear headline, one short explanation, and links back to the publication and archive.

## Components and interaction

- **Section bars:** Strong dark top rule, lighter lower rule, compact uppercase label, optional count aligned to the opposite edge.
- **Story entries:** Image-led but restrained, minimal rounding, consistent image ratios, fine separators, and clear headline hierarchy. Keep thumbnail crops, headline spacing, and metadata placement consistent across home, archive, and recommendations.
- **Links:** Inherit text color by default; use the sage/stone accent for reading actions and interactive emphasis. Keep keyboard focus clearly visible.
- **Search:** Provide a site-wide search action in the header and a direct text-search form on the archive page.
- **Account:** The header’s **Log in** action opens a focused AT Protocol sign-in page. Explain that sign-in happens with the visitor’s account provider and state the record permissions requested.
- **Article reactions:** Place like and dislike controls after the story with public totals and a short status message. Signed-out readers go through sign-in and return to the story; signed-in readers can add, switch, or remove their reaction.
- **Mobile menu:** Toggle open/closed from the menu button; close it when a navigation link is selected.
- **Back to top:** Reveal on scroll and return smoothly to the top when activated.
- **Images:** Use AT Protocol blob URLs through `cdn.coffeencode.cc/blob/{did}/{cid}[@ext]/{preset}`, choosing a feed preset for story imagery and an avatar preset for profiles. Do not rewrite profile images to `avatars.coffeencode.cc`. Give content-bearing images useful alternative text; mark decorative covers empty. Lazy-load below-the-fold images and preserve dimensions to reduce layout shift.
- **Motion:** Keep hover transitions short and subtle. Respect reduced-motion preferences for nonessential movement.

## Responsive behavior

- Below roughly 900px, hide the article-side latest-story rail.
- Below roughly 760px, stack the home lead story and recent rail, switch archive grids to one column, simplify footer columns, and reduce article headline scale.
- Below roughly 520px, tighten outer gutters, reduce the wordmark size, and collapse recommendation cards into thumbnail-and-text rows.
- Preserve content order across breakpoints: lead story first, supporting stories next, then contribution and archive content.
- Keep article text, buttons, navigation, and images within the viewport; allow long titles and links to wrap naturally.

## Content and redesign constraints

- The publication focuses on technology news, analysis, and contributed writing.
- Story titles, summaries, dates, images, view counts, and authors are variable content.
- Keep the result editorial and easy to scan; do not turn it into a marketing landing page or dashboard.
- Retain accessible navigation labels, visible focus states, semantic heading order, responsive controls, and graceful empty states.
- This document describes the active experience and should be updated whenever shared visual tokens or page structures change.
