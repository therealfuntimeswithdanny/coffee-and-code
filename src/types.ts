export type Env = {
  PUB_NAME: string;
  PUB_DESCRIPTION: string;
  OWNER_DID: string;
  OWNER_PDS: string;
  PUSH_TOKENS: KVNamespace;
  // Optional upstream override for the handle typeahead API.
  TYPEAHEAD_UPSTREAM?: string;
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
