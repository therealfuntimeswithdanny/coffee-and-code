import { getEdgeCachedValue } from './atproto';

const verifierDid = 'did:plc:z7hzwpuv5ytin56wecfxa4mx';
const badgeCollection = 'cc.coffeencode.verification';
const badgeTypes = new Set(['verified', 'author', 'moderator', 'developer']);
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

type BadgeRecord = { value?: { subject?: unknown; type?: unknown; types?: unknown } };

function recordBadgeTypes(value: BadgeRecord['value']): string[] {
  const raw = Array.isArray(value?.types) ? value.types : [value?.type];
  return [...new Set(raw.filter((type): type is string => typeof type === 'string' && badgeTypes.has(type)))];
}

async function loadBadgeMap(pdsUrl: string, ownerDid: string): Promise<Record<string, string[]>> {
  const badges: Record<string, Set<string>> = {};
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const url = new URL(`${pdsUrl}/xrpc/com.atproto.repo.listRecords`);
    url.searchParams.set('repo', ownerDid);
    url.searchParams.set('collection', badgeCollection);
    url.searchParams.set('limit', '100');
    if (cursor) url.searchParams.set('cursor', cursor);
    const response = await fetch(url, { headers });
    if (!response.ok) break; // A missing collection just means no badges yet.
    const payload = await response.json() as { records?: BadgeRecord[]; cursor?: string };
    for (const record of payload.records || []) {
      const subject = record.value?.subject;
      const types = recordBadgeTypes(record.value);
      if (typeof subject === 'string' && /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(subject) && types.length) {
        badges[subject] = badges[subject] || new Set();
        types.forEach((type) => badges[subject].add(type));
      }
    }
    if (!payload.cursor) break;
    cursor = payload.cursor;
  }
  return Object.fromEntries(Object.entries(badges).map(([did, types]) => [did, [...types]]));
}

/** cc.coffeencode.verification badges granted by the publication owner. */
export async function getVerificationBadges(pdsUrl: string, ownerDid: string): Promise<Map<string, string[]>> {
  const map = await getEdgeCachedValue('verifications', `${pdsUrl}\n${ownerDid}`, 300, () =>
    loadBadgeMap(pdsUrl, ownerDid));
  return new Map(Object.entries(map));
}
