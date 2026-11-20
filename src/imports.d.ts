// HTML files are imported as text modules via the wrangler `rules` config.
declare module '*.html' {
  const content: string;
  export default content;
}

// Markdown files under docs/ are imported as text via the wrangler `rules` config.
declare module '*.md' {
  const content: string;
  export default content;
}
