import { Hono } from 'hono';
import { getVerifiedDids, getVerificationBadges } from '../lib/verifications';
import { getPdsEndpoint } from '../lib/atproto';
import { Env } from '../types';

const verifications = new Hono<{ Bindings: Env }>();
const didPattern = /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/;
const maxDids = 50;

verifications.get('/', async (c) => {
  const dids = [...new Set(c.req.queries('did') || [])];
  if (!dids.length || dids.length > maxDids || dids.some((did) => !didPattern.test(did))) {
    return c.json({ error: `Provide between 1 and ${maxDids} valid DIDs.` }, 400);
  }

  try {
    // Badges are granted by the coffeencode.cc account, not the publication owner.
    const badgeDid = 'did:plc:z7hzwpuv5ytin56wecfxa4mx';
    const badgePds = await getPdsEndpoint(badgeDid, c.env.OWNER_PDS);
    const [verifiedDids, badgeMap] = await Promise.all([
      getVerifiedDids(dids),
      getVerificationBadges(badgePds, badgeDid),
    ]);
    const badges: Record<string, string[]> = {};
    dids.forEach((did) => {
      const types = badgeMap.get(did);
      if (types?.length) badges[did] = types;
    });
    return c.json({ verifiedDids: [...verifiedDids], badges }, 200, {
      'Cache-Control': 'public, max-age=300',
    });
  } catch (error) {
    console.error('Failed to load author verifications:', error);
    return c.json({ error: 'Author verifications are temporarily unavailable.' }, 502);
  }
});

export default verifications;
