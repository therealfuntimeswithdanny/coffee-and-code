const verifierDid = 'did:plc:z7hzwpuv5ytin56wecfxa4mx';
const verificationCollection = 'app.bsky.graph.verification';
const backlinksEndpoint = 'https://constellation.microcosm.blue/xrpc/blue.microcosm.links.getBacklinks';
const headers = {
  Accept: 'application/json',
  'User-Agent': 'CoffeeAndCode (coffeencode.cc; @coffeencode.bsky.social)',
};

type VerificationBacklink = { did?: string; collection?: string };

export async function getVerifiedDids(dids: string[]): Promise<Set<string>> {
  const uniqueDids = [...new Set(dids)];
  const verified = new Set<string>();

  for (let offset = 0; offset < uniqueDids.length; offset += 8) {
    const batch = uniqueDids.slice(offset, offset + 8);
    const results = await Promise.all(batch.map(async (did) => {
      const url = new URL(backlinksEndpoint);
      url.searchParams.set('subject', did);
      url.searchParams.set('source', `${verificationCollection}:subject`);
      url.searchParams.set('did', verifierDid);
      url.searchParams.set('limit', '1');
      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`Constellation returned ${response.status}`);
      const result = await response.json() as { records?: VerificationBacklink[] };
      return result.records?.some((record) => record.did === verifierDid && record.collection === verificationCollection)
        ? did
        : undefined;
    }));
    results.forEach((did) => { if (did) verified.add(did); });
  }

  return verified;
}
