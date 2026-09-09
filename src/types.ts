export type Env = {
  PUB_NAME: string;
  PUB_DESCRIPTION: string;
  AUTHOR_DID: string;
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
}
