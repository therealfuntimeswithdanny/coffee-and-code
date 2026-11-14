// Helpers for the reader profile record (cc.coffeencode.profile, rkey "self").
// Kept free of DOM and network access so they can be unit tested.

export const USER_PROFILE_COLLECTION = 'cc.coffeencode.profile';
export const USER_PROFILE_RKEY = 'self';

export const USER_PROFILE_LIMITS = {
  displayName: 64,
  pronouns: 40,
  description: 256,
} as const;

export type UserProfileField = keyof typeof USER_PROFILE_LIMITS;
export type UserProfileFields = Partial<Record<UserProfileField, string>>;
export type UserProfileRecord = Record<string, unknown> & { $type: typeof USER_PROFILE_COLLECTION };

const FIELD_LABELS: Record<UserProfileField, string> = {
  displayName: 'Display name',
  pronouns: 'Pronouns',
  description: 'Bio',
};

export function graphemeLength(value: string) {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    let count = 0;
    for (const _ of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)) count += 1;
    return count;
  }
  return [...value].length;
}

/** Returns an error message for the first field over its limit, or undefined. */
export function validateUserProfileFields(fields: UserProfileFields): string | undefined {
  for (const key of Object.keys(USER_PROFILE_LIMITS) as UserProfileField[]) {
    const value = fields[key]?.trim() ?? '';
    const limit = USER_PROFILE_LIMITS[key];
    if (graphemeLength(value) > limit) return `${FIELD_LABELS[key]} must be ${limit} characters or fewer.`;
  }
  return undefined;
}

/** Reads the editable fields from a stored record, ignoring anything malformed. */
export function readUserProfileFields(record: unknown): UserProfileFields {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return {};
  const value = record as Record<string, unknown>;
  const fields: UserProfileFields = {};
  for (const key of Object.keys(USER_PROFILE_LIMITS) as UserProfileField[]) {
    if (typeof value[key] === 'string' && value[key]) fields[key] = value[key] as string;
  }
  return fields;
}

/**
 * Builds the record to write with putRecord. Unknown fields from the existing
 * record are preserved so newer clients' data is not lost; empty fields are removed.
 */
export function buildUserProfileRecord(
  existing: Record<string, unknown> | undefined,
  fields: UserProfileFields,
  now: Date = new Date(),
): UserProfileRecord {
  const next: Record<string, unknown> = { ...(existing || {}), $type: USER_PROFILE_COLLECTION };
  for (const key of Object.keys(USER_PROFILE_LIMITS) as UserProfileField[]) {
    const value = fields[key]?.trim();
    if (value) next[key] = value;
    else delete next[key];
  }
  if (typeof next.createdAt !== 'string' || !next.createdAt) next.createdAt = now.toISOString();
  return next as UserProfileRecord;
}

/** True when an XRPC error response means the record does not exist yet. */
export function isMissingRecordResponse(status: number, payload: { error?: string } | null | undefined) {
  return status === 404 || (status === 400 && payload?.error === 'RecordNotFound');
}
