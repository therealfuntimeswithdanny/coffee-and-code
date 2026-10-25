import { Hono } from 'hono';
import { getVerifiedDids } from '../lib/verifications';
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
    const verifiedDids = await getVerifiedDids(dids);
    return c.json({ verifiedDids: [...verifiedDids] }, 200, {
      'Cache-Control': 'public, max-age=300',
    });
  } catch (error) {
    console.error('Failed to load author verifications:', error);
    return c.json({ error: 'Author verifications are temporarily unavailable.' }, 502);
  }
});

export default verifications;
