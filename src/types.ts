export type Env = {
  PUB_NAME: string;
  PUB_DESCRIPTION: string;
  AUTHOR_DID: string;
  PUBLICATION_URIS: string[];
  DEFAULT_PDS: string;
};

export interface StandardDocument {
  uri: string;
  cid: string;
  rkey: string;
  title: string;
  content: string;
  publishedAt: string;
  path: string;
  description?: string;
  cover?: string;
  format?: string; // Content format: 'markdown', 'html', 'plaintext', 'richtext'
  mimeType?: string; // MIME type of the content
  repoDid?: string;
  pdsUrl?: string;
  author?: AuthorProfile;
}

export interface AuthorProfile {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}
