# Coffee & Code: Site Design Reference

Use this document as a visual and structural reference for redesigning the Coffee & Code publication website. Preserve the editorial character and the page types described here, but feel free to reinterpret the visual design. Treat all story and author content below as dynamic content, not fixed copy.

## Brand and Visual Direction

- **Personality:** Independent tech publication; thoughtful, warm, literate, and editorial rather than corporate or product-marketing focused.
- **Overall look:** A dark coffee-brown canvas with restrained sage/stone accents, fine rules, generous editorial typography, and real story photography where available.
- **Mood:** Quiet and considered. Keep the reading experience clear and content-led; avoid decorative UI that competes with headlines and images.

### Color Palette

| Role | Color | Use |
| --- | --- | --- |
| Main background | `#281914` | Page and header background |
| Raised background | `#3b2a1d` | Footer, secondary surfaces, image placeholders |
| Primary text | `#ffffff` | Headlines and high-emphasis text |
| Accent | `#b2ac88` | Links, labels, borders, and interactive emphasis |
| Muted text | `#b2ac88` | Descriptions, dates, and supporting copy |
| Fine rules | Accent at about 42% opacity | Separators and card outlines |

### Typography

- **Display and editorial headings:** Lora, serif; medium-to-bold weights.
- **Body, navigation, metadata, and controls:** Source Sans 3, sans-serif.
- **Headlines:** Prominent, compact line-height, strong hierarchy; scale down on narrow screens.
- **Navigation and section labels:** Small, bold, uppercase, with expanded tracking.
- **Reading text:** Comfortable measure and generous line-height.

## Shared Site Shell

- A full-width sticky header sits above a centered content area, with a fine accent-colored bottom rule.
- On wide screens, the header has three zones: primary navigation on the left, publication wordmark centered, and utility links/actions on the right.
- The wordmark uses the editorial serif. The main navigation contains **Latest**, **Archive**, and **Authors**. Utilities include **Search** and **RSS**.
- After scrolling, the header becomes shorter and gains a subtle shadow; the wordmark also scales down.
- On mobile, replace the primary navigation with a menu button. Keep the wordmark and compact utility actions visible; reveal navigation links in a full-width dropdown beneath the header.
- Main content uses a centered maximum width of about 1100px, with roughly 24px side gutters on desktop and 16px on small phones.
- The footer uses the raised background and a top border. It contains the publication name and short description, useful site links, and a compact copyright line.
- A floating back-to-top control appears after the visitor scrolls down the page.

## Page Templates

### Home / Latest

1. Begin with a compact section bar labeled **Latest**, with the current story count aligned opposite it.
2. Below it, use a two-column editorial layout: a dominant lead story on the left and a narrower **Also new** rail on the right.
3. The lead story contains a wide landscape cover image (or a branded placeholder), a small **Most recent** label, a large headline, a short summary, date/author metadata, and a clear read-story link.
4. The side rail contains up to four compact story rows, each with a small thumbnail, headline, and date/views metadata.
5. Follow the lead area with a contribution callout inviting writers to participate.
6. Show remaining recent stories in a multi-column archive-style grid, followed by a **View all stories** link.
7. If no lead story exists, show a simple empty-state message in its place.

### Article Detail

- Keep the article column narrower than the site shell, approximately 820px, for comfortable reading.
- Start with an **All stories** back link, then a large headline, optional serif standfirst, author/date attribution, and subdued view count.
- Show an optional wide cover image before the article body.
- The article body supports a clear hierarchy of headings, paragraphs, lists, links, quotations, code, and responsive images. Keep its measure readable and vertical rhythm generous.
- End the article with a compact footer area. Prioritize the story and reading flow over secondary widgets.

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

### Not Found

- Use a restrained text-led message with a small 404 label, a clear headline, one short explanation, and links back to the publication and archive.

## Components and Interaction

- **Section bars:** Strong top rule, lighter lower rule, compact uppercase label, optional count aligned to the opposite edge.
- **Story cards:** Image-led but restrained; subtle border/background separation, minimal rounding, consistent image ratios, and clear headline hierarchy.
- **Links:** Inherit the text color by default; use the accent color on hover/focus and for primary reading actions.
- **Search:** Provide both a site-wide search action in the header and a direct text-search form on the archive page.
- **Mobile menu:** Toggle open/closed from the menu button; close it when a navigation link is selected.
- **Back to top:** Reveal on scroll and return smoothly to the top when activated.
- **Images:** Use landscape crops for story covers and thumbnails. When an image is unavailable, use a simple publication-colored placeholder rather than a broken-image state.

## Responsive Behavior

- At widths below roughly 760px, stack the home lead story and recent rail, switch story grids to one column, hide desktop navigation, and simplify the footer columns.
- At widths below roughly 480px, tighten outer gutters, reduce the wordmark size, and keep story rows and controls from overflowing.
- Preserve the same content order across breakpoints: lead story first, supporting stories next, then contribution and archive content.
- Keep article text, buttons, navigation, and images within the viewport; allow long titles and links to wrap naturally.

## Content and Redesign Constraints

- The publication focuses on technology news, analysis, and contributed writing.
- Story titles, summaries, dates, images, view counts, and authors are variable content.
- Keep the result editorial and easy to scan; do not turn it into a marketing landing page or dashboard.
- Retain accessible navigation labels, visible focus states, useful image alternatives where images convey content, and semantic heading order.
- Treat this document as a description of the current experience, not a requirement to preserve its exact implementation or styling.