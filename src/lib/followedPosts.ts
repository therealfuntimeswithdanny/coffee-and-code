import type { StandardDocument } from '../types';

export type FollowedPostMatch = {
  document: StandardDocument;
  actorDid: string;
  matchedTags: string[];
};

export function findFollowedPostMatches(
  documents: StandardDocument[],
  authorFollowedAt: Map<string, number>,
  tagFollowedAt: Map<string, number>,
  recipientDid: string,
): FollowedPostMatch[] {
  return documents.flatMap((document) => {
    const actorDid = document.author?.did || document.repoDid;
    const publishedAt = Date.parse(document.publishedAt);
    if (!actorDid || actorDid.toLowerCase() === recipientDid.toLowerCase() || !Number.isFinite(publishedAt)) return [];

    const followedAuthorAt = authorFollowedAt.get(actorDid.toLowerCase());
    const seenTags = new Set<string>();
    const matchedTags = (document.tags || []).filter((tag) => {
      const key = tag.toLocaleLowerCase();
      const followedAt = tagFollowedAt.get(key);
      if (followedAt === undefined || publishedAt < followedAt || seenTags.has(key)) return false;
      seenTags.add(key);
      return true;
    });
    if (!(followedAuthorAt !== undefined && publishedAt >= followedAuthorAt) && !matchedTags.length) return [];
    return [{ document, actorDid, matchedTags }];
  });
}
