// HTML files are imported as text modules via the wrangler `rules` config.
declare module '*.html' {
  const content: string;
  export default content;
}
