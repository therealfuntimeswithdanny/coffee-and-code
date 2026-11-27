export type Env = {
  PUB_NAME: string;
  PUB_DESCRIPTION: string;
  OWNER_DID: string;
  OWNER_PDS: string;
  PUSH_TOKENS: KVNamespace;
  // Web Push (VAPID) credentials. PUBLIC is a var; PRIVATE is a secret.
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  // R2 bucket holding author-uploaded videos under video/<did>/<cid>.<ext>.
  STORAGE?: R2Bucket;
  // Public origin serving the bucket (custom domain), no trailing slash.
  STORAGE_PUBLIC_URL?: string;
  // Optional upstream override for the handle typeahead API.
  TYPEAHEAD_UPSTREAM?: string;
  // Better Stack (Better Uptime) API token for /api/pds-status; secret, optional.
  BETTERSTACK_TOKEN?: string;
  // Optional Cloudflare zone credentials. When set, updating a published post
  // also purges the story URL from the zone cache via the Cloudflare API.
  CF_ZONE_ID?: string;
  CF_API_TOKEN?: string;
  // Privo API key (links:write scope) used by /api/shortlink to create
  // per-story short links. Secret, optional — short links 503 without it.
  PRIVO_API_KEY?: string;
  // Google Identity Services web client ID used for Google account signup.
  // This is a public OAuth client identifier, not a secret.
  GOOGLE_CLIENT_ID?: string;
  // GitHub OAuth app credentials used for GitHub account signup. The client ID
  // is public; the secret must be configured with `wrangler secret put`.
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  // Optional Cloudflare Email Sending (`send_email`) binding.
  EMAIL?: {
    send(message: EmailMessage): Promise<void>;
  };
};

export interface StandardDocument {
  uri: string;
  cid: string;
  rkey: string;
  title: string;
  content: string;
  publishedAt: string;
  path: string;
  tags?: string[];
  pinnedOrder?: number;
  alternatePaths?: string[];
  description?: string;
  cover?: string;
  format?: string; // Content format: 'markdown', 'html', 'plaintext', 'richtext'
  mimeType?: string; // MIME type of the content
  record?: Record<string, unknown>;
  repoDid?: string;
  pdsUrl?: string;
  publicationUri?: string;
  author?: AuthorProfile;
  metadata?: PostMetadata;
  /** True when publishedAt is in the future — the story is scheduled and stays unlisted until then. */
  scheduled?: boolean;
  /** Additional author DIDs from the document's `authors` array (excluding the primary author). */
  coAuthorDids?: string[];
}

export interface PostMetadata {
  uri: string;
  cid: string;
  sources: string[];
  backlink?: string;
  createdAt?: string;
}

export interface AuthorProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
  banner?: string;
  description?: string;
  pronouns?: string;
  pinnedPosts?: string[];
}
