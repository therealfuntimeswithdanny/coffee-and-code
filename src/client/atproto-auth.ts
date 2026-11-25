import {
  BrowserOAuthClient,
  OAuthCallbackError,
  type OAuthClientMetadataInput,
  type OAuthSession,
} from '@atproto/oauth-client-browser';
import rawClientMetadata from '../../media/oauth-client-metadata.json';
import rawCreateClientMetadata from '../../media/oauth-client-metadata-create.json';
import {
  USER_PROFILE_COLLECTION,
  USER_PROFILE_RKEY,
  buildUserProfileRecord,
  isMissingRecordResponse,
  readUserProfileFields,
  validateUserProfileFields,
  type UserProfileFields,
} from '../lib/userProfile';

type ForumImageInput = { file: File; alt: string };
type ForumStrongRef = { uri: string; cid: string };
type UserListSummary = { uri: string; rkey: string; title: string; about?: string; icon?: string; createdAt: string };
type ListMembership = UserListSummary & { inList: boolean };
type ListInput = { title: string; about?: string; icon?: string };
const oauthMetadata = rawClientMetadata as OAuthClientMetadataInput;
const authorScope = 'include:cc.coffeencode.authAuthor';
const sharedScope = rawClientMetadata.scope;
if (!sharedScope || !sharedScope.split(' ').includes(authorScope)) {
  throw new Error('Shared OAuth client metadata must include the author scope.');
}
const memberScope = sharedScope.split(' ').filter((scope) => scope !== authorScope).join(' ');
const handleResolver = 'https://database.coffeencode.cc';

function accountAvatarUrl(imageUrl: string): string | undefined {
  try {
    const url = new URL(imageUrl);
    const match = url.pathname.match(/^\/img\/[^/]+\/plain\/([^/]+)\/([^/]+)$/i);
    if (!match) return undefined;
    const did = decodeURIComponent(match[1]);
    const blob = decodeURIComponent(match[2]);
    return `https://cdn.coffeencode.cc/blob/${encodeURIComponent(did)}/${blob}/avatar_thumb`;
  } catch {
    return undefined;
  }
}

// The surface the site needs from a sign-in session. OAuth sessions satisfy
// this; app-password sessions implement it with bearer tokens instead.
type AuthSession = Pick<OAuthSession, 'did' | 'fetchHandler' | 'signOut'>;

let client: BrowserOAuthClient | undefined;
let session: AuthSession | undefined;
let initializationError: unknown;
let oauthInitialized = false;
let callbackState: string | null | undefined;
const clientInitializations = new WeakMap<BrowserOAuthClient, Promise<Awaited<ReturnType<BrowserOAuthClient['init']>>>>();

function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';

  try {
    const target = new URL(value, window.location.origin);
    if (target.origin !== window.location.origin || target.pathname === '/auth') return '/';
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return '/';
  }
}

function errorMessage(error: unknown) {
  if (error instanceof OAuthCallbackError) {
    const description = error.params.get('error_description');
    return description || error.message || 'Sign-in was canceled or could not be completed.';
  }
  return error instanceof Error ? error.message : 'An unexpected sign-in error occurred.';
}

// Accounts that have signed in on this device, for the account switcher.
type KnownAccount = { did: string; handle?: string; displayName?: string; avatar?: string; profileFetchedAt?: number };
const KNOWN_ACCOUNTS_KEY = 'cc:known-accounts';

function loadKnownAccounts(): KnownAccount[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KNOWN_ACCOUNTS_KEY) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is KnownAccount =>
      Boolean(entry) && typeof entry === 'object'
      && typeof (entry as KnownAccount).did === 'string'
      && (entry as KnownAccount).did.startsWith('did:'));
  } catch {
    return [];
  }
}

function saveKnownAccounts(accounts: KnownAccount[]) {
  try {
    localStorage.setItem(KNOWN_ACCOUNTS_KEY, JSON.stringify(accounts.slice(0, 12)));
  } catch {
    // Storage can be unavailable in private browsing; the switcher just won't persist.
  }
}

function rememberAccount(did: string, patch: Partial<KnownAccount> = {}) {
  const accounts = loadKnownAccounts();
  const existing = accounts.find((account) => account.did === did);
  if (existing) {
    Object.assign(existing, patch);
  } else {
    accounts.unshift({ did, ...patch });
  }
  saveKnownAccounts(accounts);
}

function forgetAccount(did: string) {
  saveKnownAccounts(loadKnownAccounts().filter((account) => account.did !== did));
}

// ---- App-password sign-in -------------------------------------------------
// App passwords skip OAuth entirely: the site talks to the account's PDS with
// bearer tokens from com.atproto.server.createSession. Only one app-password
// session is stored at a time; OAuth sessions keep their own storage.
type StoredPasswordSession = {
  pds: string;
  did: AuthSession['did'];
  handle?: string;
  accessJwt: string;
  refreshJwt: string;
};
const PASSWORD_SESSION_KEY = 'cc:pds-session';

function loadStoredPasswordSession(): StoredPasswordSession | undefined {
  try {
    const parsed = JSON.parse(localStorage.getItem(PASSWORD_SESSION_KEY) || 'null') as unknown;
    if (!parsed || typeof parsed !== 'object') return undefined;
    const candidate = parsed as Partial<StoredPasswordSession>;
    if (typeof candidate.pds !== 'string' || !candidate.pds.startsWith('https://')
      || typeof candidate.did !== 'string' || !candidate.did.startsWith('did:')
      || typeof candidate.accessJwt !== 'string' || typeof candidate.refreshJwt !== 'string') {
      return undefined;
    }
    return {
      pds: candidate.pds,
      did: candidate.did as AuthSession['did'],
      handle: typeof candidate.handle === 'string' ? candidate.handle : undefined,
      accessJwt: candidate.accessJwt,
      refreshJwt: candidate.refreshJwt,
    };
  } catch {
    return undefined;
  }
}

function savePasswordSession(stored: StoredPasswordSession) {
  try {
    localStorage.setItem(PASSWORD_SESSION_KEY, JSON.stringify(stored));
  } catch {
    // Private browsing without storage: the session still works until reload.
  }
}

function clearPasswordSession() {
  try {
    localStorage.removeItem(PASSWORD_SESSION_KEY);
  } catch {}
}

// When both an OAuth session and an app-password session are stored, this flag
// decides which one becomes active on the next load.
const LAST_AUTH_METHOD_KEY = 'cc:last-auth-method';

function lastAuthMethod() {
  try {
    return localStorage.getItem(LAST_AUTH_METHOD_KEY);
  } catch {
    return null;
  }
}

function setLastAuthMethod(method?: 'oauth' | 'password') {
  try {
    if (method) localStorage.setItem(LAST_AUTH_METHOD_KEY, method);
    else localStorage.removeItem(LAST_AUTH_METHOD_KEY);
  } catch {}
}

async function resolveSignInPds(identifier: string) {
  let did = identifier;
  if (!did.startsWith('did:')) {
    const response = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(did)}`);
    if (!response.ok) throw new Error('Could not resolve that handle. Check the spelling and try again.');
    const result = await response.json() as { did?: unknown };
    if (typeof result.did !== 'string' || !result.did.startsWith('did:')) {
      throw new Error('That handle did not resolve to an account.');
    }
    did = result.did;
  }

  let documentUrl: string;
  if (did.startsWith('did:plc:')) {
    documentUrl = `https://plc.directory/${did}`;
  } else if (did.startsWith('did:web:')) {
    const webId = did.slice('did:web:'.length).replace(/%3A/gi, ':').split(':').join('/');
    documentUrl = `https://${webId}/.well-known/did.json`;
  } else {
    throw new Error('This DID method is not supported for app-password sign-in.');
  }
  const docResponse = await fetch(documentUrl);
  if (!docResponse.ok) throw new Error('Could not load the account’s identity document.');
  const doc = await docResponse.json() as {
    service?: Array<{ id?: unknown; type?: unknown; serviceEndpoint?: unknown }>;
  };
  const endpoint = (doc.service || []).find((service) =>
    service.id === '#atproto_pds'
    || (typeof service.id === 'string' && service.id.endsWith('#atproto_pds'))
    || service.type === 'AtprotoPersonalDataServer')?.serviceEndpoint;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://')) {
    throw new Error('Could not find the account provider for that account.');
  }
  return { did, pds: endpoint };
}

// Decode the access token's `exp` claim so the session can refresh itself
// before it expires instead of waiting for a request to bounce off a 401.
function accessTokenExpiryMs(jwt: string): number {
  try {
    const segment = jwt.split('.')[1] || '';
    const payload = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: unknown };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function createPasswordSession(stored: StoredPasswordSession): AuthSession {
  let accessJwt = stored.accessJwt;
  let refreshJwt = stored.refreshJwt;
  let refreshPromise: Promise<void> | undefined;
  let refreshTimer: number | undefined;

  const refresh = () => {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const response = await fetch(`${stored.pds}/xrpc/com.atproto.server.refreshSession`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${refreshJwt}` },
        });
        if (!response.ok) {
          // Only a real auth rejection ends the session; network and server
          // errors keep it so a hiccup doesn't sign the user out mid-draft.
          if (response.status === 400 || response.status === 401) {
            clearPasswordSession();
            throw new Error('Your saved sign-in expired. Sign in again with your app password.');
          }
          throw new Error(`Could not refresh your sign-in (${response.status}). Retrying shortly.`);
        }
        const data = await response.json() as { accessJwt?: unknown; refreshJwt?: unknown };
        if (typeof data.accessJwt !== 'string' || typeof data.refreshJwt !== 'string') {
          throw new Error('The account provider returned an invalid session refresh.');
        }
        accessJwt = data.accessJwt;
        refreshJwt = data.refreshJwt;
        savePasswordSession({ ...stored, accessJwt, refreshJwt });
      })().finally(() => {
        refreshPromise = undefined;
      });
    }
    return refreshPromise;
  };

  // Keep the access token fresh: renew a minute before its `exp`, and retry
  // every minute after a failed attempt so the session survives being idle
  // far longer than the access token's short lifetime.
  const scheduleRefresh = (delayMs?: number) => {
    if (refreshTimer) window.clearTimeout(refreshTimer);
    let delay = delayMs;
    if (delay === undefined) {
      const exp = accessTokenExpiryMs(accessJwt);
      if (!exp) return;
      delay = Math.max(exp - Date.now() - 60_000, 5_000);
    }
    refreshTimer = window.setTimeout(() => {
      void refresh()
        .then(() => scheduleRefresh())
        .catch(() => scheduleRefresh(60_000));
    }, delay);
  };
  const refreshIfExpiringSoon = () => {
    const exp = accessTokenExpiryMs(accessJwt);
    if (exp && exp - Date.now() < 5 * 60_000) {
      void refresh().then(() => scheduleRefresh()).catch(() => scheduleRefresh(60_000));
    }
  };
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshIfExpiringSoon();
  });
  window.addEventListener('focus', refreshIfExpiringSoon);
  scheduleRefresh();

  const fetchHandler: AuthSession['fetchHandler'] = async (path, init = {}) => {
    const send = (token: string) => {
      const headers = new Headers(init.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return fetch(`${stored.pds}${path}`, { ...init, headers });
    };
    let response = await send(accessJwt);
    if (response.status === 401) {
      const payload = await response.clone().json().catch(() => null) as { error?: string } | null;
      if (payload?.error === 'ExpiredToken' || payload?.error === 'InvalidToken') {
        await refresh();
        response = await send(accessJwt);
      }
    }
    return response;
  };

  return {
    did: stored.did,
    fetchHandler,
    signOut: async () => {
      try {
        await fetch(`${stored.pds}/xrpc/com.atproto.server.deleteSession`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${refreshJwt}` },
        });
      } catch {
        // Signing out locally matters more than revoking server-side.
      }
      clearPasswordSession();
    },
  };
}

async function signInWithAppPassword(identifier: string, password: string) {
  const { did, pds } = await resolveSignInPds(identifier);
  const response = await fetch(`${pds}/xrpc/com.atproto.server.createSession`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identifier, password }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
    if (payload?.error === 'AuthenticationRequired' && payload.message?.includes('app password')) {
      throw new Error('That account requires an app password. Create one in your account provider’s settings.');
    }
    const detail = [payload?.error, payload?.message].filter(Boolean).join(': ');
    throw new Error(detail || 'Sign-in failed. Check your handle and app password.');
  }
  const data = await response.json() as {
    did?: unknown; handle?: unknown; accessJwt?: unknown; refreshJwt?: unknown;
  };
  if (typeof data.did !== 'string' || !data.did.startsWith('did:')
    || typeof data.accessJwt !== 'string' || typeof data.refreshJwt !== 'string') {
    throw new Error('The account provider returned an invalid session.');
  }
  const stored: StoredPasswordSession = {
    pds,
    did: (data.did || did) as AuthSession['did'],
    handle: typeof data.handle === 'string' ? data.handle : undefined,
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
  };
  savePasswordSession(stored);
  session = createPasswordSession(stored);
  setLastAuthMethod('password');
  rememberAccount(stored.did, { ...(stored.handle ? { handle: stored.handle } : {}) });
}


async function switchToAccount(did: string, trigger?: HTMLButtonElement) {
  if (!client || session?.did === did) return;
  if (trigger) trigger.disabled = true;
  try {
    const storedPasswordSession = loadStoredPasswordSession();
    if (storedPasswordSession?.did === did) {
      session = createPasswordSession(storedPasswordSession);
      setLastAuthMethod('password');
      rememberAccount(did);
      if (window.location.pathname === '/auth') {
        window.location.assign(safeReturnPath(new URLSearchParams(window.location.search).get('returnTo')));
      } else {
        window.location.reload();
      }
      return;
    }
    const restored = await client.restore(did);
    setLastAuthMethod('oauth');
    rememberAccount(restored.did);
    if (window.location.pathname === '/auth') {
      const returnTo = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
      window.location.assign(returnTo);
    } else {
      // Reload so every view picks up the new session cleanly.
      window.location.reload();
    }
  } catch (error) {
    // The stored session is gone (revoked or expired); drop it from the list.
    forgetAccount(did);
    renderAccountSwitchers();
    showAuthError(`Could not switch accounts: ${errorMessage(error)}`);
    if (trigger) trigger.disabled = false;
  }
}

// DIDs whose public profiles we've already tried to fetch for the switcher,
// so renderAccountSwitchers doesn't re-request them on every render.
const switcherProfileLookups = new Set<string>();
// Cached profiles refresh in the background after a day.
const PROFILE_STALE_MS = 24 * 60 * 60 * 1000;

function backfillSwitcherProfiles(accounts: KnownAccount[]) {
  accounts
    .filter((account) =>
      !account.handle || !account.avatar
      || !account.profileFetchedAt || Date.now() - account.profileFetchedAt > PROFILE_STALE_MS)
    .forEach((account) => {
      if (switcherProfileLookups.has(account.did)) return;
      switcherProfileLookups.add(account.did);
      fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(account.did)}`)
        .then((response) => response.ok ? response.json() : Promise.reject(new Error('Profile unavailable')))
        .then((profile: { avatar?: string; displayName?: string; handle?: string }) => {
          rememberAccount(account.did, {
            ...(profile.handle ? { handle: profile.handle } : {}),
            ...(profile.displayName ? { displayName: profile.displayName } : {}),
            ...(profile.avatar ? { avatar: accountAvatarUrl(profile.avatar) } : {}),
            profileFetchedAt: Date.now(),
          });
          renderAccountSwitchers();
        })
        .catch(() => {});
    });
}

// Set when the /auth?state=completed welcome panel takes over the card — the
// switcher (and anything else re-rendering later) must not un-hide itself.
let authWelcomeShown = false;

function renderAccountSwitchers() {
  const accounts = loadKnownAccounts();
  backfillSwitcherProfiles(accounts);
  const activeDid = session?.did;
  const returnTo = safeReturnPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
  document.querySelectorAll<HTMLElement>('[data-account-switcher]').forEach((container) => {
    if (authWelcomeShown && container.closest('[data-auth-options]')) {
      container.hidden = true;
      return;
    }
    container.replaceChildren();
    const entries = session ? accounts.filter((account) => account.did !== activeDid) : accounts;
    if (!entries.length && !session) {
      container.hidden = true;
      return;
    }
    const title = document.createElement('p');
    title.className = 'account-switcher__title';
    title.innerHTML = '<i class="fa-solid fa-users" aria-hidden="true"></i> Switch account';
    const list = document.createElement('ul');
    list.className = 'account-switcher__list';
    for (const account of entries) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'account-switcher__row';
      const avatar = document.createElement(account.avatar ? 'img' : 'span');
      if (avatar instanceof HTMLImageElement) {
        avatar.src = account.avatar || '';
        avatar.alt = '';
      } else {
        avatar.setAttribute('aria-hidden', 'true');
        avatar.innerHTML = '<i class="fa-solid fa-user"></i>';
      }
      avatar.className = 'account-switcher__avatar';
      const copy = document.createElement('span');
      copy.className = 'account-switcher__copy';
      const name = document.createElement('strong');
      name.textContent = account.displayName || account.handle || `${account.did.slice(0, 18)}…`;
      copy.append(name);
      if (account.handle) {
        const handle = document.createElement('small');
        handle.textContent = `@${account.handle}`;
        copy.append(handle);
      }
      button.append(avatar, copy);
      button.setAttribute('aria-label', `Switch to ${account.displayName || account.handle || 'this account'}`);
      button.addEventListener('click', () => switchToAccount(account.did, button));
      item.append(button);
      list.append(item);
    }
    container.append(title, list);
    if (session) {
      const add = document.createElement('a');
      add.className = 'account-switcher__add';
      add.href = `/auth?state=add&returnTo=${encodeURIComponent(returnTo)}`;
      add.innerHTML = '<i class="fa-solid fa-plus" aria-hidden="true"></i> Add account';
      container.append(add);
    }
    container.hidden = false;
  });
}

const authForm = document.querySelector<HTMLFormElement>('[data-auth-form]');
const providerButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-provider]'));
const handleInput = document.querySelector<HTMLInputElement>('#auth-handle');
const handleLabel = document.querySelector<HTMLElement>('[data-handle-label]');
const handleHint = document.querySelector<HTMLElement>('[data-handle-hint]');
const appPasswordForm = document.querySelector<HTMLFormElement>('[data-app-password-form]');
const authOptions = document.querySelector<HTMLElement>('[data-auth-options]');
const authWaiting = document.querySelector<HTMLElement>('[data-auth-waiting]');
const authWaitingDetail = document.querySelector<HTMLElement>('[data-auth-waiting-detail]');
const authWaitingCancel = document.querySelector<HTMLButtonElement>('[data-auth-waiting-cancel]');
const welcomeBlock = document.querySelector<HTMLElement>('[data-auth-welcome]');
const welcomeAvatar = document.querySelector<HTMLImageElement>('[data-welcome-avatar]');
const welcomePlaceholder = document.querySelector<HTMLElement>('[data-welcome-placeholder]');
const welcomeName = document.querySelector<HTMLElement>('[data-welcome-name]');
const welcomeHandle = document.querySelector<HTMLElement>('[data-welcome-handle]');
const welcomePronouns = document.querySelector<HTMLElement>('[data-welcome-pronouns]');
const welcomePronounsValue = document.querySelector<HTMLElement>('[data-welcome-pronouns-value]');
const welcomeContinue = document.querySelector<HTMLAnchorElement>('[data-welcome-continue]');
const signedOutBlock = document.querySelector<HTMLElement>('[data-auth-signedout]');
const signedOutContinue = document.querySelector<HTMLAnchorElement>('[data-signedout-continue]');
const authAccount = document.querySelector<HTMLElement>('[data-auth-account]');
const authName = document.querySelector<HTMLElement>('[data-auth-name]');
const authError = document.querySelector<HTMLElement>('[data-auth-error]');
const createCoffeeAccountButton = document.querySelector<HTMLButtonElement>('[data-create-coffee-account]');
const createCoffeeAccountLabel = createCoffeeAccountButton?.querySelector<HTMLElement>('strong') || createCoffeeAccountButton;
const inviteStatus = document.querySelector<HTMLElement>('[data-invite-status]');
const invitePanel = document.querySelector<HTMLElement>('[data-invite-panel]');
const inviteCodeElement = document.querySelector<HTMLElement>('[data-invite-code]');
const copyInviteButton = document.querySelector<HTMLButtonElement>('[data-copy-invite]');
const signoutButton = document.querySelector<HTMLButtonElement>('[data-auth-signout]');
const headerAccount = document.querySelector<HTMLElement>('[data-account-link]');
const accountMenuButton = document.querySelector<HTMLButtonElement>('[data-account-menu-button]');
const accountMenu = document.querySelector<HTMLElement>('[data-account-menu]');
const headerAccountAvatar = document.querySelector<HTMLImageElement>('[data-account-avatar]');
const headerAccountPlaceholder = document.querySelector<HTMLElement>('[data-account-placeholder]');
const mobileAccountLinks = document.querySelectorAll<HTMLAnchorElement>('[data-mobile-account-link]');
const accountPage = document.querySelector<HTMLElement>('[data-account-page]');
const signedOutAccount = document.querySelector<HTMLElement>('[data-account-signed-out]');
const notificationsPage = document.querySelector<HTMLElement>('[data-notifications-page]');
const notificationsInbox = notificationsPage?.querySelector<HTMLElement>('[data-notifications-inbox]');
const notificationsStatus = notificationsPage?.querySelector<HTMLElement>('[data-notifications-status]');
const notificationsRefresh = notificationsPage?.querySelector<HTMLButtonElement>('[data-notifications-refresh]');
const notificationLinks = document.querySelectorAll<HTMLElement>('[data-notifications-link]');
const notificationBadges = document.querySelectorAll<HTMLElement>('[data-notifications-badge]');
let signupInviteCode: string | undefined;
let accountAuthorRecord: Record<string, unknown> | undefined;
let accountAuthorDid: string | undefined;
let accountUserProfileRecord: Record<string, unknown> | undefined;
let accountUserProfileDid: string | undefined;
const blockCollection = 'cc.coffeencode.user.block';
const PREFERENCES_COLLECTION = 'cc.coffeencode.preferences';
const PREFERENCES_RKEY = 'self';
type UserBlockRecord = { uri: string; rkey: string; subject: string; createdAt: string };
let blockedRecords: UserBlockRecord[] = [];
let blockedRecordsDid: string | undefined;
let blockedRecordsPromise: Promise<UserBlockRecord[]> | undefined;
let activeBlockedDids = new Set<string>();
let notificationBadgeDid: string | undefined;
let notificationBadgeRequestDid: string | undefined;
let notificationsAutoReadTimer: number | undefined;

if (accountMenuButton && accountMenu && headerAccount) {
  accountMenu.querySelectorAll('a').forEach((link) => {
    if (link.getAttribute('href') === window.location.pathname) link.setAttribute('aria-current', 'page');
  });
  const setMenuOpen = (open: boolean) => {
    accountMenu.hidden = !open;
    accountMenuButton.setAttribute('aria-expanded', String(open));
  };
  accountMenuButton.addEventListener('click', () => setMenuOpen(accountMenu.hidden));
  accountMenu.addEventListener('click', () => setMenuOpen(false));
  document.addEventListener('click', (event) => {
    if (!accountMenu.hidden && (!(event.target instanceof Node) || !headerAccount.contains(event.target))) {
      setMenuOpen(false);
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !accountMenu.hidden) {
      setMenuOpen(false);
      accountMenuButton.focus();
    }
  });
}

type FontChoice = 'sans' | 'serif' | 'monospace' | 'system' | 'atkinson' | 'merriweather' | 'fraunces' | 'inter';

type ReaderPreferences = {
  theme: 'system' | 'dark' | 'light';
  uiFont: FontChoice;
  postFont: FontChoice;
  postFontSize?: number;
};

declare global {
  interface Window {
    coffeeAndCodePreferences?: {
      get: () => ReaderPreferences;
      apply: (prefs: { theme?: unknown; uiFont?: unknown; postFont?: unknown; postFontSize?: unknown }) => void;
    };
    coffeeAndCodeAuth?: {
      getDid: () => Promise<string | undefined>;
      getNotificationsReadAt: () => Promise<string | undefined>;
      markNotificationsRead: () => Promise<string>;
      getFeedSkeleton: (cursor?: string | null) => Promise<{ feed?: Array<{ post?: string; reason?: unknown }>; cursor?: string } | undefined>;
      blockUser: (did: string, alsoOnBluesky: boolean) => Promise<void>;
      unblockUser: (did: string) => Promise<void>;
      createComment: (record: { subject: { uri: string }; reply?: { parent: { uri: string } }; text: string; createdAt: string }) => Promise<void>;
      editComment: (uri: string, record: { subject: { uri: string }; reply?: { parent: { uri: string } }; text: string; createdAt: string }) => Promise<void>;
      deleteComment: (uri: string) => Promise<void>;
      toggleCommentLike: (commentUri: string, isLiked: boolean, likeRkey?: string) => Promise<string | undefined>;
      createForumPost: (forumUri: string, title: string, content: string, tags: string[], images: ForumImageInput[]) => Promise<void>;
      createForumReply: (root: ForumStrongRef, parent: ForumStrongRef, content: string, images: ForumImageInput[]) => Promise<void>;
      getForumVotes: (subjectUris: string[]) => Promise<Record<string, 'up' | 'down'>>;
      setForumVote: (subject: ForumStrongRef, direction: 'up' | 'down' | undefined) => Promise<void>;
      createForumModeration: (forumUri: string, subject: ForumStrongRef, action: string, moderators: string[]) => Promise<void>;
      getLists: () => Promise<UserListSummary[]>;
      createList: (input: ListInput) => Promise<string>;
      updateList: (listUri: string, input: ListInput) => Promise<void>;
      deleteList: (listUri: string) => Promise<void>;
      getListsWithMembership: (documentUri: string) => Promise<ListMembership[]>;
      setListItem: (listUri: string, documentUri: string, inList: boolean) => Promise<void>;
    };
  }
}

function showAuthError(message: string) {
  if (!authError) return;
  authError.hidden = false;
  authError.textContent = message;
}

function clearAuthError() {
  if (!authError) return;
  authError.hidden = true;
  authError.textContent = '';
}

function initializeOAuthClient(oauthClient: BrowserOAuthClient) {
  let initialized = clientInitializations.get(oauthClient);
  if (!initialized) {
    initialized = oauthClient.init();
    clientInitializations.set(oauthClient, initialized);
  }
  return initialized;
}

async function requestedScope(handle?: string) {
  await oauthReady;
  if (!handle) return memberScope;
  const query = new URLSearchParams({ handle });
  const authorResponse = await fetch(`/api/authors/check?${query}`, { cache: 'no-store' });
  if (!authorResponse.ok) throw new Error('Could not check whether this account is a Coffee & Code author. Please try again.');
  const authorResult = await authorResponse.json() as { isAuthor?: unknown };
  if (typeof authorResult.isAuthor !== 'boolean') throw new Error('Author check returned an invalid response.');
  return authorResult.isAuthor ? sharedScope : memberScope;
}

function renderAccount() {
  const loginLinks = document.querySelectorAll<HTMLElement>('[data-login-link]');
  const displayName = session ? 'Your account' : '';
  const returnTo = safeReturnPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
  loginLinks.forEach((link) => {
    link.hidden = Boolean(session);
    link.setAttribute('href', `/auth?returnTo=${encodeURIComponent(returnTo)}`);
  });
  if (headerAccount) {
    headerAccount.hidden = !session;
    const accountLabel = session ? `Account for ${displayName}` : 'Your account';
    headerAccount.setAttribute('aria-label', accountLabel);
    headerAccount.title = accountLabel;
    if (accountMenuButton) {
      accountMenuButton.setAttribute('aria-label', accountLabel);
      accountMenuButton.title = accountLabel;
    }
  }
  mobileAccountLinks.forEach((link) => {
    link.hidden = !session;
    // The dropdown menu entry shows the signed-in name; compact entries (tab bar)
    // keep their fixed label.
    if (!link.querySelector('i')) {
      link.textContent = session ? `Account (${displayName})` : 'Account';
    }
  });
  notificationLinks.forEach((link) => { link.hidden = !session; });
  if (session && oauthInitialized) {
    if (notificationBadgeDid !== session.did) setNotificationBadgeCount(0);
    if (!notificationsPage) void loadNotificationBadge(session.did);
  }
  if (!session) {
    notificationBadgeDid = undefined;
    notificationBadgeRequestDid = undefined;
    setNotificationBadgeCount(0);
  }
  if (notificationsPage && oauthInitialized) void loadNotificationsPage();
  if (session) {
    const activeDid = session.did;
    void loadReaderPreferences(activeDid);
    void loadUserBlocks(activeDid).then(() => renderBlockManager(activeDid)).catch((error) => {
      console.error('Could not load the signed-in user’s block list:', error);
      const status = accountPage?.querySelector<HTMLElement>('[data-blocks-status]');
      if (status) status.textContent = errorMessage(error);
    });
    renderBlockButtons(new Set(blockedRecords.map((record) => record.subject)));
  } else {
    blockedRecords = [];
    blockedRecordsDid = undefined;
    blockedRecordsPromise = undefined;
    document.querySelectorAll<HTMLButtonElement>('[data-block-user-did]').forEach((button) => {
      button.hidden = true;
      button.disabled = true;
    });
    applyBlockedUserFilter(new Set());
  }

  // /auth?state=add (or legacy ?add=1) keeps the sign-in form visible so another
  // account can be added; ?state=completed / ?state=signed-out keep the card
  // visible to show their panels instead.
  const authParams = new URLSearchParams(window.location.search);
  const authState = window.location.pathname === '/auth' ? authParams.get('state') : null;
  const addingAccount = authState === 'add' || authParams.get('add') === '1';
  const welcomeActive = authState === 'completed' || authState === 'signed-out';
  if (session && !addingAccount) {
    if (authOptions) authOptions.hidden = !welcomeActive;
    if (authAccount) authAccount.hidden = welcomeActive ? true : false;
    if (authName) authName.textContent = 'Your account';
  } else {
    if (authOptions) authOptions.hidden = false;
    if (authAccount) authAccount.hidden = true;
    if (authName) authName.textContent = '';
  }

  renderAccountSwitchers();

  // The publication creator carries its own OAuth session — run it whether or
  // not the main site session is signed in.
  void loadCreatePublication();

  if (accountPage) {
    if (signedOutAccount) signedOutAccount.hidden = Boolean(session);
    if (session) {
      const did = session.did;
      void loadAccountProfile(did);
      void loadAccountViewedPosts(did);
      void loadAccountSavedPosts(did);
      void loadAccountLists(did);
      void renderTagFollows(did);
      void loadEmailSettings(did);
      void loadEmailRouting(did);
      void loadPushSettings(did);
      void loadAuthorProfileEditor(did);
      void loadAuthorNavLinks(did);
      void loadDraftListPage(did);
      void loadDraftEditor(did);
    }

  }

  if (!session) {
    if (headerAccountAvatar) { headerAccountAvatar.hidden = true; headerAccountAvatar.removeAttribute('src'); }
    if (headerAccountPlaceholder) headerAccountPlaceholder.hidden = false;
    document.querySelectorAll<HTMLImageElement>('[data-tab-avatar]').forEach((img) => {
      img.hidden = true;
      img.removeAttribute('src');
    });
    document.querySelectorAll<HTMLElement>('[data-tab-avatar-placeholder]').forEach((el) => { el.hidden = false; });
    return;
  }

  const did = session.did;
  fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`)
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('Profile unavailable')))
    .then((profile: { avatar?: string; displayName?: string; handle?: string }) => {
      if (session?.did !== did) return;
      const avatar = profile.avatar ? accountAvatarUrl(profile.avatar) : undefined;
      rememberAccount(did, {
        ...(profile.handle ? { handle: profile.handle } : {}),
        ...(profile.displayName ? { displayName: profile.displayName } : {}),
        ...(avatar ? { avatar } : {}),
        profileFetchedAt: Date.now(),
      });
      renderAccountSwitchers();
      if (headerAccountAvatar && avatar) {
        headerAccountAvatar.src = avatar;
        headerAccountAvatar.alt = `${profile.displayName || profile.handle || 'Account'} profile picture`;
        headerAccountAvatar.hidden = false;
        if (headerAccountPlaceholder) headerAccountPlaceholder.hidden = true;
      }
      if (avatar) {
        document.querySelectorAll<HTMLImageElement>('[data-tab-avatar]').forEach((img) => {
          img.src = avatar;
          img.alt = '';
          img.hidden = false;
        });
        document.querySelectorAll<HTMLElement>('[data-tab-avatar-placeholder]').forEach((el) => { el.hidden = true; });
      }
    })
    .catch(() => {});
}

function validBlockDid(value: unknown): value is string {
  return typeof value === 'string' && /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(value);
}

async function loadUserBlocks(did: string): Promise<UserBlockRecord[]> {
  if (blockedRecordsDid === did && blockedRecordsPromise) return blockedRecordsPromise;
  blockedRecordsDid = did;
  blockedRecords = [];
  blockedRecordsPromise = (async () => {
    const records: UserBlockRecord[] = [];
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    do {
      const query = new URLSearchParams({ repo: did, collection: blockCollection, limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const response = await repoRequest(`com.atproto.repo.listRecords?${query}`);
      const page = await response.json() as {
        records?: Array<{ uri?: unknown; value?: { subject?: unknown; createdAt?: unknown } }>;
        cursor?: unknown;
      };
      for (const record of page.records || []) {
        if (typeof record.uri !== 'string' || typeof record.value?.subject !== 'string'
          || !validBlockDid(record.value.subject) || typeof record.value.createdAt !== 'string'
          || !Number.isFinite(Date.parse(record.value.createdAt))) continue;
        try {
          records.push({
            uri: record.uri,
            rkey: recordKeyFromUri(record.uri),
            subject: record.value.subject,
            createdAt: record.value.createdAt,
          });
        } catch { continue; }
      }
      if (typeof page.cursor !== 'string' || !page.cursor) break;
      if (seenCursors.has(page.cursor)) throw new Error('The account provider returned a repeated block-list cursor.');
      seenCursors.add(page.cursor);
      if (seenCursors.size > 1000) throw new Error('Your block list is too large to load.');
      cursor = page.cursor;
    } while (cursor);
    if (session?.did !== did) return [];
    blockedRecords = [...new Map(records.map((record) => [record.subject, record])).values()];
    applyBlockedUserFilter(new Set(blockedRecords.map((record) => record.subject)));
    return blockedRecords;
  })();
  return blockedRecordsPromise;
}

function applyBlockedUserFilter(blocked: Set<string>) {
  activeBlockedDids = blocked;
  renderBlockButtons(blocked);
  document.querySelectorAll<HTMLElement>('.forum-post-card[data-block-author-did], .forum-thread[data-block-author-did], .forum-reply[data-block-author-did], .user-forum-post[data-block-author-did]').forEach((element) => {
    updateBlockVisibility(element, blocked);
  });
}

function updateBlockVisibility(element: HTMLElement, blocked: Set<string>) {
  const isBlocked = blocked.has(element.dataset.blockAuthorDid || '');
  if (element.matches('.forum-reply')) {
    element.hidden = false;
    element.classList.toggle('is-blocked', isBlocked);
    return;
  }
  element.hidden = isBlocked;
}

function renderBlockButtons(blocked: Set<string>) {
  document.querySelectorAll<HTMLButtonElement>('[data-block-user-did]').forEach((button) => {
    const did = button.dataset.blockUserDid || '';
    const isOwnAccount = did === session?.did;
    const isBlocked = blocked.has(did);
    button.hidden = !session || isOwnAccount;
    button.disabled = isOwnAccount || isBlocked;
    button.textContent = isBlocked ? 'Blocked' : 'Block user';
  });
}

new MutationObserver((mutations) => {
  mutations.forEach((mutation) => mutation.addedNodes.forEach((node) => {
    if (!(node instanceof HTMLElement)) return;
    const selector = '.forum-post-card[data-block-author-did], .forum-thread[data-block-author-did], .forum-reply[data-block-author-did], .user-forum-post[data-block-author-did]';
    const candidates = [
      ...(node.matches(selector) ? [node] : []),
      ...node.querySelectorAll<HTMLElement>(selector),
    ];
    candidates.forEach((element) => {
      updateBlockVisibility(element, activeBlockedDids);
    });
  }));
}).observe(document.documentElement, { childList: true, subtree: true });

async function renderBlockManager(did: string) {
  if (!accountPage) return;
  const list = accountPage.querySelector<HTMLElement>('[data-blocks-list]');
  const status = accountPage.querySelector<HTMLElement>('[data-blocks-status]');
  if (!list || !status) return;
  status.textContent = 'Loading your blocked accounts…';
  try {
    const records = await loadUserBlocks(did);
    if (session?.did !== did) return;
    list.replaceChildren();
    records.forEach((record) => {
      const item = document.createElement('li');
      const profileLink = document.createElement('a');
      profileLink.href = `/user/${encodeURIComponent(record.subject)}`;
      profileLink.textContent = record.subject;
      const unblock = document.createElement('button');
      unblock.type = 'button';
      unblock.className = 'auth-signout';
      unblock.textContent = 'Unblock';
      unblock.addEventListener('click', async () => {
        unblock.disabled = true;
        status.textContent = `Unblocking ${record.subject}…`;
        try {
          await window.coffeeAndCodeAuth?.unblockUser(record.subject);
          await renderBlockManager(did);
        } catch (error) {
          status.textContent = errorMessage(error);
          unblock.disabled = false;
        }
      });
      item.append(profileLink, unblock);
      list.append(item);
    });
    status.textContent = records.length ? `${records.length} ${records.length === 1 ? 'account' : 'accounts'} blocked on Coffee & Code.` : 'You have not blocked any accounts.';
  } catch (error) {
    status.textContent = errorMessage(error);
  }
}

type TagFollowRecord = { uri: string; rkey: string; tag: string; createdAt: string };

const tagFollowCollection = 'cc.coffeencode.tag.follow';

async function listTagFollows(did: string): Promise<TagFollowRecord[]> {
  const records: TagFollowRecord[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const query = new URLSearchParams({ repo: did, collection: tagFollowCollection, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const response = await repoRequest(`com.atproto.repo.listRecords?${query}`);
    const page = await response.json() as {
      records?: Array<{ uri?: unknown; value?: { tag?: unknown; createdAt?: unknown } }>;
      cursor?: unknown;
    };
    for (const record of page.records || []) {
      if (typeof record.uri !== 'string' || typeof record.value?.tag !== 'string' || !record.value.tag.trim()
        || typeof record.value.createdAt !== 'string' || !Number.isFinite(Date.parse(record.value.createdAt))) continue;
      records.push({
        uri: record.uri,
        rkey: recordKeyFromUri(record.uri),
        tag: record.value.tag.trim(),
        createdAt: record.value.createdAt,
      });
    }
    if (typeof page.cursor !== 'string' || !page.cursor || seenCursors.has(page.cursor)) break;
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);
  // Keep the first record per tag so duplicate follows collapse.
  return [...new Map(records.map((record) => [record.tag.toLocaleLowerCase(), record])).values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function renderTagFollowPosts(did: string, records: TagFollowRecord[], postsList: HTMLElement) {
  postsList.replaceChildren();
  if (!records.length) return;
  const followedAt = new Map(records.map((record) => [record.tag.toLocaleLowerCase(), Date.parse(record.createdAt)]));
  const response = await fetch('/api/documents?limit=100', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load recent stories.');
  const payload = await response.json() as {
    documents?: Array<{ path?: unknown; title?: unknown; publishedAt?: unknown; tags?: unknown }>;
  };
  const matches = (payload.documents || []).filter((doc) => {
    if (typeof doc.path !== 'string' || typeof doc.publishedAt !== 'string') return false;
    const publishedAt = Date.parse(doc.publishedAt);
    if (!Number.isFinite(publishedAt)) return false;
    const tags = Array.isArray(doc.tags) ? doc.tags : [];
    return tags.some((tag) => {
      const at = followedAt.get(String(tag).toLocaleLowerCase());
      return at !== undefined && publishedAt >= at;
    });
  }).slice(0, 5);
  matches.forEach((doc) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = String(doc.path);
    link.textContent = typeof doc.title === 'string' && doc.title ? doc.title : 'Untitled';
    item.append(link);
    postsList.append(item);
  });
}

type GraphFollowRecord = { uri: string; subject: string; createdAt: string };
type SubscriptionRecord = { uri: string; publication: string };

const graphFollowCollection = 'app.bsky.graph.follow';
const subscriptionCollection = 'site.standard.graph.subscription';

async function listGraphFollows(did: string): Promise<GraphFollowRecord[]> {
  const records: GraphFollowRecord[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const query = new URLSearchParams({ repo: did, collection: graphFollowCollection, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const response = await repoRequest(`com.atproto.repo.listRecords?${query}`);
    const page = await response.json() as {
      records?: Array<{ uri?: unknown; value?: { subject?: unknown; createdAt?: unknown } }>;
      cursor?: unknown;
    };
    for (const record of page.records || []) {
      if (typeof record.uri !== 'string' || typeof record.value?.subject !== 'string' || !record.value.subject.startsWith('did:')) continue;
      records.push({
        uri: record.uri,
        subject: record.value.subject,
        createdAt: typeof record.value.createdAt === 'string' ? record.value.createdAt : '',
      });
    }
    if (typeof page.cursor !== 'string' || !page.cursor || seenCursors.has(page.cursor)) break;
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);
  return [...new Map(records.map((record) => [record.subject.toLowerCase(), record])).values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function listPublicationSubscriptions(did: string): Promise<SubscriptionRecord[]> {
  const records: SubscriptionRecord[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const query = new URLSearchParams({ repo: did, collection: subscriptionCollection, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const response = await repoRequest(`com.atproto.repo.listRecords?${query}`);
    const page = await response.json() as {
      records?: Array<{ uri?: unknown; value?: { publication?: unknown } }>;
      cursor?: unknown;
    };
    for (const record of page.records || []) {
      if (typeof record.uri !== 'string' || typeof record.value?.publication !== 'string') continue;
      records.push({ uri: record.uri, publication: record.value.publication });
    }
    if (typeof page.cursor !== 'string' || !page.cursor || seenCursors.has(page.cursor)) break;
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);
  return records;
}

type SiteAuthor = { did: string; handle: string; displayName: string; avatar?: string };

async function listSiteAuthors(): Promise<Map<string, SiteAuthor>> {
  const authors = new Map<string, SiteAuthor>();
  const response = await fetch('/api/documents?limit=100', { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load publication authors.');
  const payload = await response.json() as {
    documents?: Array<{ author?: { did?: unknown; handle?: unknown; displayName?: unknown; avatar?: unknown } }>;
  };
  for (const doc of payload.documents || []) {
    const author = doc.author;
    if (!author || typeof author.did !== 'string' || typeof author.handle !== 'string') continue;
    const key = author.did.toLowerCase();
    if (authors.has(key)) continue;
    authors.set(key, {
      did: author.did,
      handle: author.handle,
      displayName: typeof author.displayName === 'string' && author.displayName ? author.displayName : author.handle,
      avatar: typeof author.avatar === 'string' ? author.avatar : undefined,
    });
  }
  return authors;
}

async function renderTagFollows(did: string) {
  if (!accountPage) return;
  const list = accountPage.querySelector<HTMLElement>('[data-tag-follows-list]');
  const status = accountPage.querySelector<HTMLElement>('[data-tag-follows-status]');
  const postsList = accountPage.querySelector<HTMLElement>('[data-tag-follows-posts]');
  if (!list || !status) return;
  status.textContent = 'Loading who you follow…';
  try {
    const [tagRecords, followRecords, siteAuthors] = await Promise.all([
      listTagFollows(did),
      listGraphFollows(did).catch(() => [] as GraphFollowRecord[]),
      listSiteAuthors().catch(() => new Map<string, SiteAuthor>()),
    ]);
    if (session?.did !== did) return;
    const followedAuthors = followRecords
      .map((record) => ({ record, author: siteAuthors.get(record.subject.toLowerCase()) }))
      .filter((entry): entry is { record: GraphFollowRecord; author: SiteAuthor } => Boolean(entry.author));
    list.replaceChildren();

    const unfollowButton = (label: string) => {
      const unfollow = document.createElement('button');
      unfollow.type = 'button';
      unfollow.className = 'account-follows-list__unfollow';
      unfollow.setAttribute('aria-label', `Unfollow ${label}`);
      unfollow.title = `Unfollow ${label}`;
      unfollow.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
      return unfollow;
    };

    followedAuthors.forEach(({ record, author }) => {
      const item = document.createElement('li');
      item.className = 'account-follows-list__item';
      const authorLink = document.createElement('a');
      authorLink.href = `/author/${encodeURIComponent(author.handle)}`;
      authorLink.className = 'account-follows-list__author';
      const avatar = document.createElement('img');
      avatar.src = author.avatar || '/favicon.png';
      avatar.alt = '';
      avatar.loading = 'lazy';
      const name = document.createElement('span');
      name.innerHTML = `<i class="fa-solid fa-user-pen" aria-hidden="true"></i> ${author.displayName}`;
      const handle = document.createElement('small');
      handle.textContent = `@${author.handle}`;
      authorLink.append(avatar, name, handle);
      const unfollow = unfollowButton(author.displayName);
      unfollow.addEventListener('click', async () => {
        unfollow.disabled = true;
        status.textContent = `Unfollowing ${author.displayName}…`;
        try {
          await deleteFollowRecord(graphFollowCollection, record.uri, did);
          // The publication subscription is shared by all author follows, so
          // only remove it once no other followed site authors remain.
          const [remainingFollows, subscriptions] = await Promise.all([
            listGraphFollows(did).catch(() => [] as GraphFollowRecord[]),
            listPublicationSubscriptions(did).catch(() => [] as SubscriptionRecord[]),
          ]);
          const stillFollowingAuthor = remainingFollows.some((entry) => siteAuthors.has(entry.subject.toLowerCase()));
          if (!stillFollowingAuthor) {
            for (const subscription of subscriptions) {
              await deleteFollowRecord(subscriptionCollection, subscription.uri, did);
            }
          }
          await renderTagFollows(did);
        } catch (error) {
          status.textContent = errorMessage(error);
          unfollow.disabled = false;
        }
      });
      item.append(authorLink, unfollow);
      list.append(item);
    });

    tagRecords.forEach((record) => {
      const item = document.createElement('li');
      item.className = 'account-follows-list__item';
      const tagLink = document.createElement('a');
      tagLink.href = `/tags?tag=${encodeURIComponent(record.tag)}`;
      tagLink.innerHTML = `<i class="fa-solid fa-tag" aria-hidden="true"></i> ${record.tag}`;
      const unfollow = unfollowButton(record.tag);
      unfollow.addEventListener('click', async () => {
        unfollow.disabled = true;
        status.textContent = `Unfollowing ${record.tag}…`;
        try {
          await deleteFollowRecord(tagFollowCollection, record.uri, did);
          await renderTagFollows(did);
        } catch (error) {
          status.textContent = errorMessage(error);
          unfollow.disabled = false;
        }
      });
      item.append(tagLink, unfollow);
      list.append(item);
    });

    const total = followedAuthors.length + tagRecords.length;
    status.textContent = total
      ? `Following ${followedAuthors.length ? `${followedAuthors.length} ${followedAuthors.length === 1 ? 'author' : 'authors'}` : ''}${followedAuthors.length && tagRecords.length ? ' and ' : ''}${tagRecords.length ? `${tagRecords.length} ${tagRecords.length === 1 ? 'tag' : 'tags'}` : ''}.`
      : 'You are not following any authors or tags.';
    if (postsList) {
      void renderTagFollowPosts(did, tagRecords, postsList).catch((error) => {
        console.error('Could not load stories for followed tags:', error);
      });
    }
  } catch (error) {
    status.textContent = errorMessage(error);
  }
}

type EmailAddressEntry = { address: string; verified: boolean; account: boolean; tags?: string[]; authors?: string[] };
type EmailSettingsResponse = {
  enabled: boolean;
  frequency?: 'instant' | 'daily' | 'weekly';
  emails: EmailAddressEntry[];
  verificationSent?: boolean;
  alreadyVerified?: boolean;
};

// Collapsible per-address routing editor: checkboxes built from the account's
// followed tags and authors; leaving everything unchecked means the address
// receives every story.
function buildEmailFilters(
  entry: EmailAddressEntry,
  did: string,
  renderEmails: (settings: EmailSettingsResponse) => void,
  status: HTMLElement,
) {
  const filters = document.createElement('details');
  filters.className = 'account-email__filters';
  const filterSummary = document.createElement('summary');
  const activeFilters = (entry.tags?.length || 0) + (entry.authors?.length || 0);
  filterSummary.textContent = activeFilters ? `Filters (${activeFilters})` : 'Filters — all stories';
  const options = document.createElement('div');
  options.className = 'account-email__filter-options';
  const optionsStatus = document.createElement('p');
  optionsStatus.className = 'account-email__filters-status';
  const saveFilters = document.createElement('button');
  saveFilters.type = 'button';
  saveFilters.className = 'auth-signout';
  saveFilters.hidden = true;
  saveFilters.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Save filters';
  const filtersStatus = document.createElement('small');
  filters.append(filterSummary, options, optionsStatus, saveFilters, filtersStatus);

  const selectedTags = new Set((entry.tags || []).map((tag) => tag.toLowerCase()));
  const selectedAuthors = new Set((entry.authors || []).map((author) => author.toLowerCase()));
  let optionsLoaded = false;

  const option = (value: string, label: string, checked: boolean, hint?: string) => {
    const wrapper = document.createElement('label');
    wrapper.className = 'account-email__option';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.value = value;
    input.checked = checked;
    const text = document.createElement('span');
    text.textContent = label;
    wrapper.append(input, text);
    if (hint) wrapper.title = hint;
    return wrapper;
  };

  filters.addEventListener('toggle', async () => {
    if (!filters.open || optionsLoaded) return;
    optionsLoaded = true;
    optionsStatus.textContent = 'Loading your follows…';
    try {
      const [tagRecords, followRecords, siteAuthors] = await Promise.all([
        listTagFollows(did),
        listGraphFollows(did).catch(() => [] as GraphFollowRecord[]),
        listSiteAuthors().catch(() => new Map<string, SiteAuthor>()),
      ]);
      if (session?.did !== did) return;
      const followedAuthors = [...new Map(followRecords
        .map((record) => siteAuthors.get(record.subject.toLowerCase()))
        .filter((author): author is SiteAuthor => Boolean(author))
        .map((author) => [author.did.toLowerCase(), author])).values()]
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

      options.replaceChildren();
      const tagGroup = document.createElement('div');
      tagGroup.className = 'account-email__filter-group';
      tagGroup.append(Object.assign(document.createElement('p'), { className: 'account-email__filter-heading', textContent: 'Tags you follow' }));
      const tagOptions = document.createElement('div');
      tagOptions.className = 'account-email__options';
      const knownTags = new Set(tagRecords.map((record) => record.tag.toLowerCase()));
      tagRecords
        .slice()
        .sort((a, b) => a.tag.localeCompare(b.tag))
        .forEach((record) => tagOptions.append(option(record.tag, record.tag, selectedTags.has(record.tag.toLowerCase()))));
      // Keep any saved filters that are no longer followed visible and checked.
      selectedTags.forEach((tag) => {
        if (!knownTags.has(tag)) tagOptions.append(option(tag, tag, true, 'Saved filter you no longer follow'));
      });
      tagGroup.append(tagOptions);
      if (!tagOptions.children.length) {
        tagGroup.append(Object.assign(document.createElement('p'), {
          className: 'account-email__filters-status',
          textContent: 'You do not follow any tags yet.',
        }));
      }

      const authorGroup = document.createElement('div');
      authorGroup.className = 'account-email__filter-group';
      authorGroup.append(Object.assign(document.createElement('p'), { className: 'account-email__filter-heading', textContent: 'Authors you follow' }));
      const authorOptions = document.createElement('div');
      authorOptions.className = 'account-email__options';
      const knownAuthors = new Set(followedAuthors.map((author) => author.did.toLowerCase()));
      followedAuthors.forEach((author) => authorOptions.append(
        option(author.did, `${author.displayName} (@${author.handle})`, selectedAuthors.has(author.did.toLowerCase()) || selectedAuthors.has(author.handle.toLowerCase())),
      ));
      selectedAuthors.forEach((author) => {
        if (!knownAuthors.has(author)) authorOptions.append(option(author, author, true, 'Saved filter you no longer follow'));
      });
      authorGroup.append(authorOptions);
      if (!authorOptions.children.length) {
        authorGroup.append(Object.assign(document.createElement('p'), {
          className: 'account-email__filters-status',
          textContent: 'You do not follow any authors yet.',
        }));
      }

      options.append(tagGroup, authorGroup);
      optionsStatus.textContent = 'Leave everything unchecked to receive all stories at this address.';
      saveFilters.hidden = false;
    } catch (error) {
      optionsLoaded = false;
      optionsStatus.textContent = errorMessage(error);
    }
  });

  saveFilters.addEventListener('click', async () => {
    saveFilters.disabled = true;
    filtersStatus.textContent = 'Saving filters…';
    const checked = (group: number) => {
      const container = options.children[group];
      return container
        ? [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')].map((input) => input.value)
        : [];
    };
    try {
      const response = await fetch('/api/email/addresses', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, email: entry.address, tags: checked(0), authors: checked(1) }),
      });
      const result = await response.json() as EmailSettingsResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not save your filters.');
      if (session?.did !== did) return;
      renderEmails(result);
      status.textContent = `Filters updated for ${entry.address}.`;
    } catch (error) {
      filtersStatus.textContent = errorMessage(error);
      saveFilters.disabled = false;
    }
  });
  return filters;
}

type EmailRouteSource = { kind: 'tag' | 'author'; value: string; label: string; stale?: boolean };

// The /account/email routing matrix: followed tags and authors down the left,
// addresses across the top. Checking a cell routes that source to that
// address. An address in "All stories" mode has empty filters and receives
// everything; "Selected sources only" narrows it to its checked rows.
async function loadEmailRouting(did: string) {
  const container = accountPage?.querySelector<HTMLElement>('[data-email-routing]');
  const status = accountPage?.querySelector<HTMLElement>('[data-email-routing-status]');
  const saveButton = accountPage?.querySelector<HTMLButtonElement>('[data-email-routing-save]');
  if (!container || !status || !saveButton) return;

  let settings: EmailSettingsResponse;
  let sources: EmailRouteSource[];
  try {
    const [settingsResponse, tagRecords, followRecords, siteAuthors] = await Promise.all([
      fetch(`/api/email/settings?did=${encodeURIComponent(did)}`, { cache: 'no-store' }),
      listTagFollows(did),
      listGraphFollows(did).catch(() => [] as GraphFollowRecord[]),
      listSiteAuthors().catch(() => new Map<string, SiteAuthor>()),
    ]);
    if (!settingsResponse.ok) throw new Error(`Could not load your email settings (${settingsResponse.status}).`);
    settings = await settingsResponse.json() as EmailSettingsResponse;
    if (session?.did !== did) return;

    const tags = new Map<string, EmailRouteSource>();
    tagRecords.forEach((record) => tags.set(record.tag.toLowerCase(), { kind: 'tag', value: record.tag, label: `#${record.tag}` }));
    const authors = new Map<string, EmailRouteSource>();
    followRecords.forEach((record) => {
      const author = siteAuthors.get(record.subject.toLowerCase());
      if (!author) return;
      authors.set(author.did.toLowerCase(), {
        kind: 'author', value: author.did, label: `${author.displayName} (@${author.handle})`,
      });
    });
    // Keep sources saved in a filter but no longer followed so they can be
    // unchecked instead of silently disappearing.
    settings.emails.forEach((entry) => {
      (entry.tags || []).forEach((tag) => {
        if (!tags.has(tag.toLowerCase())) tags.set(tag.toLowerCase(), { kind: 'tag', value: tag, label: `#${tag}`, stale: true });
      });
      (entry.authors || []).forEach((author) => {
        const key = author.toLowerCase();
        if (!authors.has(key)) authors.set(key, { kind: 'author', value: author, label: author, stale: true });
      });
    });
    sources = [...tags.values(), ...authors.values()];
  } catch (error) {
    status.textContent = errorMessage(error);
    return;
  }

  if (!settings.emails.length) {
    status.textContent = 'Add an email address above, then choose where each kind of story goes.';
    return;
  }
  if (!sources.length) {
    status.textContent = 'You are not following any tags or authors yet, so every address gets every story. Follow some, then come back to route them.';
    return;
  }

  const selectedFor = (entry: EmailAddressEntry) => {
    const tags = new Set((entry.tags || []).map((tag) => tag.toLowerCase()));
    const authors = new Set((entry.authors || []).map((author) => author.toLowerCase()));
    return (source: EmailRouteSource) => (source.kind === 'tag' ? tags : authors).has(source.value.toLowerCase());
  };
  const receivesAll = (entry: EmailAddressEntry) => !(entry.tags?.length || entry.authors?.length);

  const table = document.createElement('table');
  table.className = 'email-routing__table';
  const head = document.createElement('thead');
  const headRow = document.createElement('tr');
  headRow.append(Object.assign(document.createElement('th'), { scope: 'col', textContent: 'Stories about…' }));
  const modeSelects: HTMLSelectElement[] = [];
  settings.emails.forEach((entry) => {
    const th = document.createElement('th');
    th.scope = 'col';
    const name = document.createElement('span');
    name.className = 'email-routing__address';
    name.textContent = entry.address;
    th.append(name);
    if (!entry.verified) {
      const badge = document.createElement('small');
      badge.className = 'email-routing__badge';
      badge.textContent = 'unconfirmed';
      th.append(badge);
    }
    const select = document.createElement('select');
    select.className = 'email-routing__mode';
    select.setAttribute('aria-label', `What ${entry.address} receives`);
    [['all', 'All stories'], ['custom', 'Only selected']].forEach(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      select.append(option);
    });
    select.value = receivesAll(entry) ? 'all' : 'custom';
    modeSelects.push(select);
    th.append(select);
    headRow.append(th);
  });
  head.append(headRow);
  table.append(head);

  const body = document.createElement('tbody');
  const tagSources = sources.filter((source) => source.kind === 'tag');
  const authorSources = sources.filter((source) => source.kind === 'author');
  const groupHeader = (label: string) => {
    const row = document.createElement('tr');
    row.className = 'email-routing__group';
    const cell = document.createElement('th');
    cell.colSpan = settings.emails.length + 1;
    cell.scope = 'rowgroup';
    cell.textContent = label;
    row.append(cell);
    body.append(row);
  };
  const sourceRow = (source: EmailRouteSource) => {
    const row = document.createElement('tr');
    const label = document.createElement('th');
    label.scope = 'row';
    label.textContent = source.label;
    if (source.stale) {
      label.title = 'Saved route for something you no longer follow';
      const stale = document.createElement('small');
      stale.className = 'email-routing__badge';
      stale.textContent = 'no longer followed';
      label.append(document.createTextNode(' '), stale);
    }
    row.append(label);
    settings.emails.forEach((entry, column) => {
      const cell = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.emailRoutingAddress = entry.address;
      input.dataset.emailRoutingKind = source.kind;
      input.dataset.emailRoutingValue = source.value;
      input.checked = receivesAll(entry) || selectedFor(entry)(source);
      input.disabled = receivesAll(entry);
      input.setAttribute('aria-label', `Send stories about ${source.label} to ${entry.address}`);
      cell.append(input);
      row.append(cell);
    });
    body.append(row);
  };
  if (tagSources.length) { groupHeader('Tags you follow'); tagSources.forEach(sourceRow); }
  if (authorSources.length) { groupHeader('Authors you follow'); authorSources.forEach(sourceRow); }
  table.append(body);
  container.replaceChildren(table);

  modeSelects.forEach((select, column) => {
    select.addEventListener('change', () => {
      const all = select.value === 'all';
      const entry = settings.emails[column];
      const selected = selectedFor(entry);
      table.querySelectorAll<HTMLInputElement>(`input[data-email-routing-address="${CSS.escape(entry.address)}"]`)
        .forEach((input) => {
          input.disabled = all;
          input.checked = all || selected({
            kind: input.dataset.emailRoutingKind === 'tag' ? 'tag' : 'author',
            value: input.dataset.emailRoutingValue || '',
            label: '',
          });
        });
      status.textContent = all
        ? `${entry.address} will receive every story.`
        : `${entry.address} will only receive the sources checked below. Save routing to apply.`;
    });
  });
  container.hidden = false;
  saveButton.hidden = false;
  status.textContent = 'Check where each tag and author should be delivered, then save. Columns on “All stories” receive everything regardless of the checks.';
  saveButton.onclick = async () => {
    saveButton.disabled = true;
    status.textContent = 'Saving your routing…';
    try {
      for (let column = 0; column < settings.emails.length; column += 1) {
        const entry = settings.emails[column];
        const all = modeSelects[column].value === 'all';
        const tags: string[] = [];
        const authors: string[] = [];
        if (!all) {
          table.querySelectorAll<HTMLInputElement>(`input[data-email-routing-address="${CSS.escape(entry.address)}"]:checked`)
            .forEach((input) => {
              if (input.dataset.emailRoutingKind === 'tag') tags.push(input.dataset.emailRoutingValue || '');
              else if (input.dataset.emailRoutingKind === 'author') authors.push(input.dataset.emailRoutingValue || '');
            });
        }
        const response = await fetch('/api/email/addresses', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ did, email: entry.address, tags, authors }),
        });
        const result = await response.json() as EmailSettingsResponse & { error?: string };
        if (!response.ok) throw new Error(result.error || `Could not save the route for ${entry.address}.`);
        if (session?.did !== did) return;
        settings = result;
      }
      status.textContent = 'Routing saved. Stories will be delivered where you selected.';
      saveButton.disabled = false;
      await loadEmailRouting(did);
    } catch (error) {
      status.textContent = errorMessage(error);
      saveButton.disabled = false;
    }
  };
}

// --- Browser push notifications (Web Push) -------------------------------------

type PushTopics = {
  comments: boolean;
  replies: boolean;
  likes: boolean;
  reads: boolean;
  newPosts: boolean;
};

const PUSH_TOPIC_KEYS: Array<keyof PushTopics> = ['comments', 'replies', 'likes', 'reads', 'newPosts'];

function vapidKeyToBytes(value: string) {
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadPushSettings(did: string) {
  if (!accountPage) return;
  const section = accountPage.querySelector<HTMLElement>('[data-push-settings]');
  const status = accountPage.querySelector<HTMLElement>('[data-push-status]');
  const toggle = accountPage.querySelector<HTMLInputElement>('[data-push-enabled]');
  const topicInputs = [...accountPage.querySelectorAll<HTMLInputElement>('[data-push-topic]')];
  if (!section || !status || !toggle) return;

  const setStatus = (message: string) => { status.textContent = message; };

  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    setStatus('This browser can’t receive push notifications.');
    return;
  }

  const readTopics = (): PushTopics => {
    const topics = { comments: true, replies: true, likes: true, reads: true, newPosts: true };
    for (const input of topicInputs) {
      const key = input.dataset.pushTopic as keyof PushTopics | undefined;
      if (key && PUSH_TOPIC_KEYS.includes(key)) topics[key] = input.checked;
    }
    return topics;
  };

  const applyTopics = (topics?: Partial<PushTopics>) => {
    for (const input of topicInputs) {
      const key = input.dataset.pushTopic as keyof PushTopics | undefined;
      if (key && PUSH_TOPIC_KEYS.includes(key)) input.checked = topics?.[key] !== false;
    }
  };

  let registration: ServiceWorkerRegistration;
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    setStatus('Notifications could not start in this browser.');
    return;
  }
  if (session?.did !== did) return;
  section.hidden = false;

  const syncTopics = async (endpoint: string) => {
    await fetch('/api/push/web/topics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint, topics: readTopics() }),
    });
  };

  const registerSubscription = async (subscription: PushSubscription) => {
    const keys = subscription.toJSON().keys;
    const response = await fetch('/api/push/web/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ did, endpoint: subscription.endpoint, keys, topics: readTopics() }),
    });
    if (!response.ok) throw new Error('Could not save this browser’s subscription.');
  };

  // Reflect the subscription this browser already holds, healing any drift
  // (KV record lost, or a different account now signed in).
  const existing = await registration.pushManager.getSubscription().catch(() => null);
  toggle.checked = Boolean(existing) && Notification.permission === 'granted';
  if (existing) {
    try {
      const infoResponse = await fetch(`/api/push/web/subscription?endpoint=${encodeURIComponent(existing.endpoint)}`, { cache: 'no-store' });
      const info = infoResponse.ok ? await infoResponse.json() as { subscribed?: boolean; did?: string; topics?: Partial<PushTopics> } : null;
      if (session?.did !== did) return;
      if (info?.subscribed && info.did === did) applyTopics(info.topics);
      else await registerSubscription(existing);
    } catch (error) {
      setStatus(errorMessage(error));
    }
  } else if (Notification.permission === 'denied') {
    setStatus('Notifications are blocked in this browser. Allow them in the browser’s site settings to turn them on.');
  }

  if (section.dataset.pushBound !== '1') {
    section.dataset.pushBound = '1';
    toggle.addEventListener('change', async () => {
      const activeDid = session?.did;
      if (!activeDid) { toggle.checked = false; return; }
      toggle.disabled = true;
      try {
        if (toggle.checked) {
          setStatus('Turning on notifications…');
          const keyResponse = await fetch('/api/push/web/key', { cache: 'no-store' });
          if (!keyResponse.ok) throw new Error('Browser notifications are not configured on this site.');
          const { publicKey } = await keyResponse.json() as { publicKey?: string };
          if (!publicKey) throw new Error('Browser notifications are not configured on this site.');
          const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
          if (permission !== 'granted') {
            throw new Error('Notifications were not allowed. Allow them in the browser’s site settings, then try again.');
          }
          let subscription = await registration.pushManager.getSubscription();
          if (!subscription) {
            subscription = await registration.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: vapidKeyToBytes(publicKey) as BufferSource,
            });
          }
          await registerSubscription(subscription);
          if (session?.did !== activeDid) return;
          setStatus('Notifications are on for this browser.');
        } else {
          setStatus('Turning off notifications…');
          const subscription = await registration.pushManager.getSubscription();
          if (subscription) {
            await fetch('/api/push/web/unregister', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ endpoint: subscription.endpoint }),
            }).catch(() => {});
            await subscription.unsubscribe().catch(() => {});
          }
          setStatus('Notifications are off for this browser.');
        }
      } catch (error) {
        toggle.checked = false;
        if (session?.did === activeDid) setStatus(errorMessage(error));
      } finally {
        toggle.disabled = false;
      }
    });
    topicInputs.forEach((input) => {
      input.addEventListener('change', async () => {
        const subscription = await registration.pushManager.getSubscription().catch(() => null);
        if (!subscription) return; // topics seed the form for when it is enabled
        try {
          await syncTopics(subscription.endpoint);
          setStatus('Notification preferences saved.');
        } catch (error) {
          setStatus(errorMessage(error));
        }
      });
    });
  }
  if (!status.textContent) {
    setStatus(toggle.checked
      ? 'Notifications are on for this browser.'
      : 'Notifications are off for this browser.');
  }
}

async function loadEmailSettings(did: string) {
  if (!accountPage) return;
  const section = accountPage.querySelector<HTMLElement>('[data-email-settings]');
  const status = accountPage.querySelector<HTMLElement>('[data-email-status]');
  const list = accountPage.querySelector<HTMLElement>('[data-email-list]');
  const form = accountPage.querySelector<HTMLFormElement>('[data-email-form]');
  const toggle = accountPage.querySelector<HTMLInputElement>('[data-email-enabled]');
  const accountButton = accountPage.querySelector<HTMLButtonElement>('[data-email-account-button]');
  const frequencyField = accountPage.querySelector<HTMLElement>('[data-email-frequency]');
  if (!section || !status || !list || !form || !toggle || !accountButton) return;

  const renderEmails = (settings: EmailSettingsResponse) => {
    toggle.checked = settings.enabled;
    frequencyField?.querySelectorAll<HTMLInputElement>('input[name="email-frequency"]').forEach((input) => {
      input.checked = input.value === (settings.frequency || 'instant');
    });
    list.replaceChildren();
    settings.emails.forEach((entry) => {
      const item = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = entry.address;
      const badge = document.createElement('small');
      badge.textContent = entry.verified
        ? (entry.account ? 'account email' : 'verified')
        : 'pending confirmation';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'auth-signout';
      remove.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i> Remove';
      const resend = !entry.verified ? document.createElement('button') : null;
      if (resend) {
        resend.type = 'button';
        resend.className = 'auth-signout';
        resend.innerHTML = '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Resend';
        resend.addEventListener('click', async () => {
          resend.disabled = true;
          status.textContent = `Resending the confirmation email to ${entry.address}…`;
          try {
            const response = await fetch('/api/email/addresses', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ did, email: entry.address }),
            });
            const result = await response.json() as EmailSettingsResponse & { error?: string };
            if (!response.ok) throw new Error(result.error || `Could not resend to ${entry.address}.`);
            if (session?.did !== did) return;
            renderEmails(result);
            status.textContent = result.verificationSent
              ? `Confirmation email sent to ${entry.address}. Open the link in it to verify the address.`
              : `The confirmation email could not be sent right now. Try again shortly.`;
          } catch (error) {
            status.textContent = errorMessage(error);
            resend.disabled = false;
          }
        });
      }
      remove.addEventListener('click', async () => {
        remove.disabled = true;
        status.textContent = `Removing ${entry.address}…`;
        try {
          const response = await fetch('/api/email/addresses', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ did, email: entry.address }),
          });
          const result = await response.json() as EmailSettingsResponse & { error?: string };
          if (!response.ok) throw new Error(result.error || `Could not remove ${entry.address}.`);
          if (session?.did !== did) return;
          renderEmails(result);
          status.textContent = `Removed ${entry.address}.`;
        } catch (error) {
          status.textContent = errorMessage(error);
          remove.disabled = false;
        }
      });
      const filters = buildEmailFilters(entry, did, renderEmails, status);
      item.append(label, badge, ...(resend ? [resend] : []), remove, filters);
      list.append(item);
    });
  };

  try {
    const response = await fetch(`/api/email/settings?did=${encodeURIComponent(did)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`Could not load your email settings (${response.status}).`);
    const settings = await response.json() as EmailSettingsResponse;
    if (session?.did !== did) return;
    renderEmails(settings);
    section.hidden = false;
    status.textContent = settings.emails.length
      ? ''
      : 'Add an email address to get new stories in your inbox.';
  } catch (error) {
    status.textContent = errorMessage(error);
    return;
  }

  // The account's own email comes from its PDS session (granted by the
  // transition:email scope), so a PDS-confirmed address needs no further
  // verification. An unconfirmed account email falls back to our own
  // confirmation email, like any manually added address. When the session
  // predates the scope the button simply stays hidden.
  void requireSession().fetchHandler('/xrpc/com.atproto.server.getSession')
    .then(async (response) => {
      if (!response.ok) return;
      const result = await response.json() as { email?: unknown; emailConfirmed?: unknown };
      if (session?.did !== did || typeof result.email !== 'string' || !result.email) return;
      const accountEmail = result.email;
      const confirmedOnPds = result.emailConfirmed === true;
      accountButton.hidden = false;
      accountButton.innerHTML = `<i class="fa-solid fa-at" aria-hidden="true"></i> ${confirmedOnPds
        ? `Use ${accountEmail}`
        : `Use ${accountEmail} (confirmation email required)`}`;
      accountButton.addEventListener('click', async () => {
        accountButton.disabled = true;
        status.textContent = `Adding ${accountEmail}…`;
        try {
          const addResponse = await fetch(confirmedOnPds ? '/api/email/account-email' : '/api/email/addresses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ did, email: accountEmail }),
          });
          const payload = await addResponse.json() as EmailSettingsResponse & { error?: string };
          if (!addResponse.ok) throw new Error(payload.error || 'Could not add your account email.');
          if (session?.did !== did) return;
          renderEmails(payload);
          status.textContent = confirmedOnPds
            ? `${accountEmail} added — it is already verified through your account.`
            : `Confirmation email sent to ${accountEmail}. Open the link in it to verify the address.`;
          if (confirmedOnPds) accountButton.hidden = true;
          else accountButton.disabled = false;
        } catch (error) {
          status.textContent = errorMessage(error);
          accountButton.disabled = false;
        }
      });
    })
    .catch(() => { /* Account email unavailable; manual addresses still work. */ });

  toggle.addEventListener('change', async () => {
    const enabled = toggle.checked;
    toggle.disabled = true;
    status.textContent = enabled ? 'Turning email notifications on…' : 'Turning email notifications off…';
    try {
      const response = await fetch('/api/email/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, enabled }),
      });
      const result = await response.json() as EmailSettingsResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not update your email settings.');
      if (session?.did !== did) return;
      renderEmails(result);
      status.textContent = enabled
        ? (result.emails.some((entry) => entry.verified)
          ? 'Email notifications are on. New stories will arrive in your inbox.'
          : 'Email notifications are on. Confirm or add an email address below to receive them.')
        : 'Email notifications are off.';
    } catch (error) {
      status.textContent = errorMessage(error);
      toggle.checked = !enabled;
    } finally {
      toggle.disabled = false;
    }
  });

  frequencyField?.querySelectorAll<HTMLInputElement>('input[name="email-frequency"]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (!input.checked) return;
      const frequency = input.value;
      input.disabled = true;
      status.textContent = 'Saving your delivery preference…';
      try {
        const response = await fetch('/api/email/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ did, frequency }),
        });
        const result = await response.json() as EmailSettingsResponse & { error?: string };
        if (!response.ok) throw new Error(result.error || 'Could not save your delivery preference.');
        if (session?.did !== did) return;
        renderEmails(result);
        status.textContent = frequency === 'instant'
          ? 'Emails will arrive as stories publish.'
          : `You'll get a ${frequency} brief in your inbox.`;
      } catch (error) {
        status.textContent = errorMessage(error);
      } finally {
        input.disabled = false;
      }
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = form.elements.namedItem('email') as HTMLInputElement;
    const address = input.value.trim();
    if (!address) return;
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    status.textContent = `Sending a confirmation email to ${address}…`;
    try {
      const response = await fetch('/api/email/addresses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ did, email: address }),
      });
      const result = await response.json() as EmailSettingsResponse & { error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not add that email address.');
      if (session?.did !== did) return;
      renderEmails(result);
      input.value = '';
      status.textContent = result.alreadyVerified
        ? `${address} is already verified.`
        : result.verificationSent
          ? `Confirmation email sent to ${address}. Open the link in it to verify the address.`
          : `${address} saved, but the confirmation email could not be sent. Try again shortly.`;
    } catch (error) {
      status.textContent = errorMessage(error);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

type BlueskyProfileSummary = { avatar?: string; displayName?: string; handle?: string; description?: string };

function renderAccountProfileCard(bluesky: BlueskyProfileSummary, custom: UserProfileFields) {
  if (!accountPage) return;
  const profileName = accountPage.querySelector<HTMLElement>('[data-profile-name]');
  const profileHandle = accountPage.querySelector<HTMLElement>('[data-profile-handle]');
  const profilePronouns = accountPage.querySelector<HTMLElement>('[data-profile-pronouns]');
  const profileBio = accountPage.querySelector<HTMLElement>('[data-profile-bio]');
  const profileAvatar = accountPage.querySelector<HTMLImageElement>('[data-profile-avatar]');
  const profilePlaceholder = accountPage.querySelector<HTMLElement>('[data-profile-placeholder]');
  const name = custom.displayName || bluesky.displayName || bluesky.handle || 'Your account';
  if (profileName) profileName.textContent = name;
  if (profileHandle) profileHandle.textContent = bluesky.handle ? `@${bluesky.handle}` : '';
  if (profilePronouns) {
    profilePronouns.textContent = custom.pronouns || '';
    profilePronouns.hidden = !custom.pronouns;
  }
  if (profileBio) profileBio.textContent = custom.description || bluesky.description || '';
  if (profileAvatar && bluesky.avatar) {
    profileAvatar.src = bluesky.avatar;
    profileAvatar.alt = `${name} profile picture`;
    profileAvatar.hidden = false;
    if (profilePlaceholder) profilePlaceholder.hidden = true;
  }
}

async function fetchUserProfileRecord(did: string): Promise<Record<string, unknown> | undefined> {
  const activeSession = requireSession();
  const query = new URLSearchParams({ repo: did, collection: USER_PROFILE_COLLECTION, rkey: USER_PROFILE_RKEY });
  const response = await activeSession.fetchHandler(`/xrpc/com.atproto.repo.getRecord?${query.toString()}`);
  if (response.ok) {
    const result = await response.json() as { value?: Record<string, unknown> };
    if (result.value && result.value.$type !== USER_PROFILE_COLLECTION) {
      throw new Error('Your Coffee & Code profile record has an unexpected record type.');
    }
    return result.value;
  }
  const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (isMissingRecordResponse(response.status, payload)) return undefined;
  if (response.status === 401 || response.status === 403) {
    throw new Error('Your account needs updated profile permissions. Sign out, then sign in again and approve the requested permissions.');
  }
  throw new Error([payload?.error, payload?.message].filter(Boolean).join(': ') || `Could not load your profile (${response.status}).`);
}

async function loadAccountProfile(did: string) {
  if (!accountPage) return;
  const form = accountPage.querySelector<HTMLFormElement>('[data-user-profile-form]');
  const editButton = accountPage.querySelector<HTMLButtonElement>('[data-edit-user-profile]');
  const cancelButton = accountPage.querySelector<HTMLButtonElement>('[data-cancel-user-profile]');
  const status = accountPage.querySelector<HTMLElement>('[data-user-profile-status]');
  const bluesky: BlueskyProfileSummary = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`)
    .then((response): Promise<BlueskyProfileSummary> | BlueskyProfileSummary => response.ok ? response.json() : {})
    .catch(() => ({} as BlueskyProfileSummary));
  if (session?.did !== did) return;
  renderAccountProfileCard(bluesky, {});

  let record: Record<string, unknown> | undefined;
  try {
    record = await fetchUserProfileRecord(did);
  } catch (error) {
    if (session?.did !== did) return;
    if (status) status.textContent = errorMessage(error);
    return;
  }
  if (session?.did !== did) return;
  accountUserProfileRecord = record;
  accountUserProfileDid = did;
  renderAccountProfileCard(bluesky, readUserProfileFields(record));
  if (!form || !editButton) return;

  const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement;
  const closeEditor = () => {
    form.hidden = true;
    editButton.hidden = false;
    editButton.focus();
  };
  editButton.disabled = false;
  editButton.onclick = () => {
    if (accountUserProfileDid !== session?.did) return;
    const current = readUserProfileFields(accountUserProfileRecord);
    field('displayName').value = current.displayName || bluesky.displayName || '';
    field('pronouns').value = current.pronouns || '';
    field('description').value = current.description || bluesky.description || '';
    if (status) status.textContent = '';
    form.hidden = false;
    editButton.hidden = true;
    field('displayName').focus();
  };
  if (cancelButton) cancelButton.onclick = () => {
    if (status) status.textContent = '';
    closeEditor();
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (accountUserProfileDid !== session?.did) return;
    const fields: UserProfileFields = {
      displayName: field('displayName').value,
      pronouns: field('pronouns').value,
      description: field('description').value,
    };
    const invalid = validateUserProfileFields(fields);
    if (invalid) {
      if (status) status.textContent = invalid;
      return;
    }
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    if (status) status.textContent = 'Saving your profile…';
    try {
      const next = buildUserProfileRecord(accountUserProfileRecord, fields);
      await repoRequest('com.atproto.repo.putRecord', {
        repo: did,
        collection: USER_PROFILE_COLLECTION,
        rkey: USER_PROFILE_RKEY,
        record: next,
      });
      if (session?.did !== did) return;
      accountUserProfileRecord = next;
      renderAccountProfileCard(bluesky, readUserProfileFields(next));
      if (status) status.textContent = 'Profile saved.';
      closeEditor();
    } catch (error) {
      if (status) status.textContent = errorMessage(error);
    } finally {
      if (submit) submit.disabled = false;
    }
  };
}

async function loadAuthorNavLinks(did: string) {
  if (!accountPage) return;
  const links = accountPage.querySelectorAll<HTMLElement>('[data-author-settings-link]');
  if (!links.length) return;
  try {
    const response = await fetch(`/api/authors/check?handle=${encodeURIComponent(did)}`, { cache: 'no-store' });
    if (!response.ok || session?.did !== did) return;
    const result = await response.json() as { isAuthor?: unknown };
    if (result.isAuthor === true) {
      links.forEach((link) => { link.hidden = false; });
    }
  } catch {
    // Leave the author links hidden when the check is unavailable.
  }
}

async function loadAuthorProfileEditor(did: string) {
  if (!accountPage) return;
  const section = accountPage.querySelector<HTMLElement>('[data-author-settings]');
  const editButton = accountPage.querySelector<HTMLButtonElement>('[data-edit-author-profile]');
  const form = accountPage.querySelector<HTMLFormElement>('[data-author-profile-form]');
  const status = accountPage.querySelector<HTMLElement>('[data-author-profile-status]');
  const syncButton = accountPage.querySelector<HTMLButtonElement>('[data-sync-bluesky-profile]');
  const previewName = accountPage.querySelector<HTMLElement>('[data-author-preview-name]');
  const previewHandle = accountPage.querySelector<HTMLElement>('[data-author-preview-handle]');
  const previewPronouns = accountPage.querySelector<HTMLElement>('[data-author-preview-pronouns]');
  const previewBio = accountPage.querySelector<HTMLElement>('[data-author-preview-bio]');
  const previewAvatar = accountPage.querySelector<HTMLImageElement>('[data-author-preview-avatar]');
  const previewAvatarPlaceholder = accountPage.querySelector<HTMLElement>('[data-author-preview-avatar-placeholder]');
  const previewBanner = accountPage.querySelector<HTMLImageElement>('[data-author-preview-banner]');
  const previewBannerPlaceholder = accountPage.querySelector<HTMLElement>('[data-author-preview-banner-placeholder]');
  if (!section || !editButton || !form || !syncButton || !previewName || !previewHandle || !previewPronouns || !previewBio
    || !previewAvatar || !previewAvatarPlaceholder || !previewBanner || !previewBannerPlaceholder) return;
  const authorGate = accountPage.querySelector<HTMLElement>('[data-author-gate]');

  let syncedBlueskyProfile: { avatar?: unknown; banner?: unknown } | undefined;
  let previewAvatarUrl: string | undefined;
  let previewBannerUrl: string | undefined;
  const releasePreviewUrl = (url?: string) => {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  };
  const setPreviewImage = (image: HTMLImageElement, placeholder: HTMLElement, url?: string) => {
    if (image === previewAvatar) {
      releasePreviewUrl(previewAvatarUrl);
      previewAvatarUrl = url?.startsWith('blob:') ? url : undefined;
    } else {
      releasePreviewUrl(previewBannerUrl);
      previewBannerUrl = url?.startsWith('blob:') ? url : undefined;
    }
    if (url) {
      image.src = url;
      image.hidden = false;
      placeholder.hidden = true;
    } else {
      image.removeAttribute('src');
      image.hidden = true;
      placeholder.hidden = false;
    }
  };
  const previewBlob = async (blob: unknown, image: HTMLImageElement, placeholder: HTMLElement) => {
    if (!blob || typeof blob !== 'object' || !('ref' in blob) || !blob.ref || typeof blob.ref !== 'object'
      || !('$link' in blob.ref) || typeof blob.ref.$link !== 'string') {
      setPreviewImage(image, placeholder);
      return;
    }
    const activeSession = session;
    if (!activeSession || activeSession.did !== did) return;
    const query = new URLSearchParams({ did, cid: blob.ref.$link });
    const response = await activeSession.fetchHandler(`/xrpc/com.atproto.sync.getBlob?${query}`);
    if (!response.ok) throw new Error(`Could not load a profile image (${response.status}).`);
    const url = URL.createObjectURL(await response.blob());
    setPreviewImage(image, placeholder, url);
  };
  const updatePreview = () => {
    const displayName = form.elements.namedItem('displayName') as HTMLInputElement;
    const pronouns = form.elements.namedItem('pronouns') as HTMLInputElement;
    const description = form.elements.namedItem('description') as HTMLTextAreaElement;
    previewName.textContent = displayName.value.trim() || 'Your name';
    previewAvatar.alt = `${displayName.value.trim() || 'Your profile'} avatar`;
    previewPronouns.textContent = pronouns.value.trim();
    previewPronouns.hidden = !pronouns.value.trim();
    previewBio.textContent = description.value.trim();
    previewBio.hidden = !description.value.trim();
  };
  const previewSelectedFile = (inputName: 'avatar' | 'banner', image: HTMLImageElement, placeholder: HTMLElement) => {
    const input = form.elements.namedItem(inputName) as HTMLInputElement;
    const file = input.files?.[0];
    if (file) setPreviewImage(image, placeholder, URL.createObjectURL(file));
  };

  try {
    const query = new URLSearchParams({ repo: did, collection: 'cc.coffeencode.author.profile', rkey: 'self' });
    const activeSession = requireSession();
    const response = await activeSession.fetchHandler(`/xrpc/com.atproto.repo.getRecord?${query.toString()}`);
    let value: Record<string, unknown> | undefined;
    if (response.ok) {
      const result = await response.json() as { value?: Record<string, unknown> };
      value = result.value;
    } else {
      const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
      const missingRecord = response.status === 404
        || (response.status === 400 && payload?.error === 'RecordNotFound');
      if (!missingRecord) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Your account needs updated author-profile permissions. Sign out, then sign in again and approve the requested permissions.');
        }
        const detail = [payload?.error, payload?.message].filter(Boolean).join(': ');
        throw new Error(detail || `Could not load your author profile (${response.status}).`);
      }
    }

    if (session?.did !== did) return;
    if (value && value.$type !== 'cc.coffeencode.author.profile') {
      throw new Error('Your author profile record has an unexpected record type.');
    }
    if (!value) {
      const postsResponse = await fetch(`/api/account/posts?author=${encodeURIComponent(did)}`, { cache: 'no-store' });
      if (!postsResponse.ok) throw new Error(`Could not check your published stories (${postsResponse.status}).`);
      const posts = await postsResponse.json() as Array<{ uri?: string }>;
      if (session?.did !== did) return;
      if (posts.length === 0) {
        if (authorGate) authorGate.hidden = false;
        return;
      }
      value = { $type: 'cc.coffeencode.author.profile' };
    }

    accountAuthorRecord = value;
    accountAuthorDid = did;
    const publicProfile: { handle?: string } = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`)
      .then(async (profileResponse) => profileResponse.ok
        ? await profileResponse.json() as { handle?: string }
        : {})
      .catch(() => ({}));
    previewHandle.textContent = publicProfile.handle ? `@${publicProfile.handle}` : `@${did}`;
    section.hidden = false;
    if (authorGate) authorGate.hidden = true;
    void loadPostMetadataEditor(did);
    accountPage.querySelectorAll<HTMLElement>('[data-author-settings-link]').forEach((link) => {
      link.hidden = false;
    });
    editButton.hidden = false;
    editButton.onclick = () => {
      if (!accountAuthorRecord || accountAuthorDid !== session?.did) return;
      form.reset();
      syncedBlueskyProfile = undefined;
      const displayName = form.elements.namedItem('displayName') as HTMLInputElement;
      const pronouns = form.elements.namedItem('pronouns') as HTMLInputElement;
      const description = form.elements.namedItem('description') as HTMLTextAreaElement;
      displayName.value = typeof accountAuthorRecord.displayName === 'string' ? accountAuthorRecord.displayName : '';
      pronouns.value = typeof accountAuthorRecord.pronouns === 'string' ? accountAuthorRecord.pronouns : '';
      description.value = typeof accountAuthorRecord.description === 'string' ? accountAuthorRecord.description : '';
      if (status) status.textContent = '';
      form.hidden = false;
      editButton.hidden = true;
      updatePreview();
      void previewBlob(accountAuthorRecord.avatar, previewAvatar, previewAvatarPlaceholder).catch((error) => {
        if (status) status.textContent = error instanceof Error ? error.message : 'Could not load the author photo preview.';
      });
      void previewBlob(accountAuthorRecord.banner, previewBanner, previewBannerPlaceholder).catch((error) => {
        if (status) status.textContent = error instanceof Error ? error.message : 'Could not load the author banner preview.';
      });
      const currentPins = Array.isArray(accountAuthorRecord.pinnedPosts)
        ? accountAuthorRecord.pinnedPosts.filter((uri): uri is string => typeof uri === 'string')
        : [];
      void loadAuthorPostPicker(did, form, currentPins);
    };
    form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[name="displayName"], [name="pronouns"], [name="description"]')
      .forEach((input) => input.addEventListener('input', updatePreview));
    form.querySelector<HTMLInputElement>('input[name="avatar"]')?.addEventListener('change', () => previewSelectedFile('avatar', previewAvatar, previewAvatarPlaceholder));
    form.querySelector<HTMLInputElement>('input[name="banner"]')?.addEventListener('change', () => previewSelectedFile('banner', previewBanner, previewBannerPlaceholder));
    syncButton.onclick = async () => {
      if (accountAuthorDid !== session?.did) return;
      syncButton.disabled = true;
      if (status) status.textContent = 'Loading your Bluesky profile…';
      try {
        const query = new URLSearchParams({ repo: did, collection: 'app.bsky.actor.profile', rkey: 'self' });
        const response = await repoRequest(`com.atproto.repo.getRecord?${query}`);
        const result = await response.json() as { value?: Record<string, unknown> };
        const profile = result.value;
        if (!profile || profile.$type !== 'app.bsky.actor.profile') {
          throw new Error('Your Bluesky profile record could not be found.');
        }
        const displayName = form.elements.namedItem('displayName') as HTMLInputElement;
        const pronouns = form.elements.namedItem('pronouns') as HTMLInputElement;
        const description = form.elements.namedItem('description') as HTMLTextAreaElement;
        displayName.value = typeof profile.displayName === 'string' ? profile.displayName : '';
        pronouns.value = typeof profile.pronouns === 'string' ? profile.pronouns : '';
        description.value = typeof profile.description === 'string' ? profile.description : '';
        (form.elements.namedItem('avatar') as HTMLInputElement).value = '';
        (form.elements.namedItem('banner') as HTMLInputElement).value = '';
        (form.elements.namedItem('removeAvatar') as HTMLInputElement).checked = false;
        (form.elements.namedItem('removeBanner') as HTMLInputElement).checked = false;
        syncedBlueskyProfile = { avatar: profile.avatar, banner: profile.banner };
        await Promise.all([
          previewBlob(profile.avatar, previewAvatar, previewAvatarPlaceholder),
          previewBlob(profile.banner, previewBanner, previewBannerPlaceholder),
        ]);
        updatePreview();
        if (status) status.textContent = 'Bluesky profile synced. Review the preview, then save your author profile.';
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : 'Could not sync your Bluesky profile.';
      } finally {
        syncButton.disabled = false;
      }
    };
    accountPage.querySelector<HTMLButtonElement>('[data-cancel-author-edit]')!.onclick = () => {
      form.reset();
      const displayName = form.elements.namedItem('displayName') as HTMLInputElement;
      const pronouns = form.elements.namedItem('pronouns') as HTMLInputElement;
      const description = form.elements.namedItem('description') as HTMLTextAreaElement;
      displayName.value = typeof accountAuthorRecord?.displayName === 'string' ? accountAuthorRecord.displayName : '';
      pronouns.value = typeof accountAuthorRecord?.pronouns === 'string' ? accountAuthorRecord.pronouns : '';
      description.value = typeof accountAuthorRecord?.description === 'string' ? accountAuthorRecord.description : '';
      form.hidden = true;
      editButton.hidden = false;
      syncedBlueskyProfile = undefined;
      updatePreview();
      void previewBlob(accountAuthorRecord?.avatar, previewAvatar, previewAvatarPlaceholder);
      void previewBlob(accountAuthorRecord?.banner, previewBanner, previewBannerPlaceholder);
      if (status) status.textContent = '';
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (accountAuthorDid !== session?.did || !accountAuthorRecord) return;
      const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (!submit) return;
      const data = new FormData(form);
      if (form.dataset.authorPostsLoaded !== 'true') {
        if (status) status.textContent = 'Wait for your published stories to load before saving.';
        return;
      }
      // Read only checked controls from the picker. These values came from the
      // author's published-post list, so stale/malformed pins in an older
      // profile record cannot block a save.
      const pins = Array.from(form.querySelectorAll<HTMLInputElement>('input[name="pinnedPost"]:checked'))
        .map((input) => input.value.trim())
        .filter(Boolean);
      const uniquePins = [...new Set(pins)];
      const next: Record<string, unknown> = { ...accountAuthorRecord, $type: 'cc.coffeencode.author.profile' };
      const optionalFields = {
        displayName: data.get('displayName')?.toString().trim(),
        pronouns: data.get('pronouns')?.toString().trim(),
        description: data.get('description')?.toString().trim(),
      };
      Object.entries(optionalFields).forEach(([key, value]) => {
        if (value) next[key] = value;
        else delete next[key];
      });
      next.pinnedPosts = uniquePins;

      const avatarInput = form.elements.namedItem('avatar') as HTMLInputElement;
      const bannerInput = form.elements.namedItem('banner') as HTMLInputElement;
      const removeAvatar = (form.elements.namedItem('removeAvatar') as HTMLInputElement).checked;
      const removeBanner = (form.elements.namedItem('removeBanner') as HTMLInputElement).checked;
      const avatarFile = avatarInput.files?.[0];
      const bannerFile = bannerInput.files?.[0];
      if ([avatarFile, bannerFile].some((file) => file && !file.type.startsWith('image/'))) {
        if (status) status.textContent = 'Choose image files for the photo and banner.';
        return;
      }

      submit.disabled = true;
      if (status) status.textContent = avatarFile || bannerFile ? 'Uploading images…' : 'Saving your author profile…';
      try {
        if (avatarFile) next.avatar = await uploadAuthorImage(avatarFile);
        else if (removeAvatar) delete next.avatar;
        else if (syncedBlueskyProfile) {
          if (syncedBlueskyProfile.avatar) next.avatar = syncedBlueskyProfile.avatar;
          else delete next.avatar;
        }
        if (bannerFile) next.banner = await uploadAuthorImage(bannerFile);
        else if (removeBanner) delete next.banner;
        else if (syncedBlueskyProfile) {
          if (syncedBlueskyProfile.banner) next.banner = syncedBlueskyProfile.banner;
          else delete next.banner;
        }
        if (status && (avatarFile || bannerFile)) status.textContent = 'Saving your author profile…';
        await repoRequest('com.atproto.repo.putRecord', {
          repo: did,
          collection: 'cc.coffeencode.author.profile',
          rkey: 'self',
          record: next,
        });
        accountAuthorRecord = next;
        if (status) status.textContent = 'Author profile saved.';
        form.hidden = true;
        editButton.hidden = false;
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : 'Could not save your author profile.';
      } finally {
        submit.disabled = false;
      }
    };
  } catch (error) {
    console.error('Could not load author profile editor:', error);
    if (status) {
      form.hidden = false;
      status.textContent = error instanceof Error ? error.message : 'Could not load your author profile.';
    }
  }
}

async function loadAuthorPostPicker(did: string, form: HTMLFormElement, selectedUris: string[]) {
  const picker = form.querySelector<HTMLElement>('[data-author-post-picker]');
  const loadingStatus = form.querySelector<HTMLElement>('[data-author-posts-status]');
  const search = form.querySelector<HTMLInputElement>('[data-author-posts-search]');
  if (!picker || !loadingStatus) return;
  form.dataset.authorPostsLoaded = 'false';
  loadingStatus.textContent = 'Loading your published stories…';
  picker.replaceChildren();
  try {
    const response = await fetch(`/api/account/posts?author=${encodeURIComponent(did)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load your published stories.');
    const posts = await response.json() as Array<{ uri: string; title?: string; publishedAt?: string }>;
    if (session?.did !== did) return;
    const selectedNow = new Set(selectedUris);
    const postsByUri = new Map(posts.filter((post) => typeof post.uri === 'string' && post.uri).map((post) => [post.uri, post]));

    if (!postsByUri.size) {
      loadingStatus.textContent = 'No published stories are available to pin yet.';
      form.dataset.authorPostsLoaded = 'true';
      return;
    }

    const buildOption = (uri: string, post: { title?: string; publishedAt?: string }) => {
      const label = document.createElement('label');
      label.className = 'account-author-post-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'pinnedPost';
      checkbox.value = uri;
      checkbox.checked = selectedNow.has(uri);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selectedNow.add(uri);
        else selectedNow.delete(uri);
      });
      const copy = document.createElement('span');
      copy.className = 'account-author-post-option__title';
      copy.textContent = post.title || 'Untitled story';
      if (post.publishedAt) {
        const meta = document.createElement('small');
        meta.className = 'account-author-post-option__meta';
        const date = new Date(post.publishedAt);
        meta.textContent = Number.isFinite(date.getTime()) ? date.toLocaleDateString() : '';
        copy.append(meta);
      }
      label.append(checkbox, copy);
      return label;
    };

    const list = document.createElement('div');
    list.className = 'account-author-post-picker';
    picker.replaceChildren(list);

    const render = () => {
      const query = (search?.value || '').trim().toLowerCase();
      const pinned: Array<[string, { title?: string; publishedAt?: string }]> = [];
      const matches: typeof pinned = [];
      postsByUri.forEach((post, uri) => {
        if (selectedNow.has(uri)) {
          pinned.push([uri, post]);
        } else if (!query || (post.title || '').toLowerCase().includes(query)) {
          matches.push([uri, post]);
        }
      });
      const shown = query ? matches.slice(0, 15) : matches.slice(0, 8);
      list.replaceChildren();
      pinned.forEach(([uri, post]) => list.append(buildOption(uri, post)));
      shown.forEach(([uri, post]) => list.append(buildOption(uri, post)));
      loadingStatus.textContent = query
        ? (matches.length
          ? `${matches.length} ${matches.length === 1 ? 'story' : 'stories'} match${matches.length === 1 ? 'es' : ''}${matches.length > shown.length ? ` — showing the first ${shown.length}.` : '.'}`
          : 'No stories match your search.')
        : `Showing ${shown.length} of ${postsByUri.size} stories. Search to find others.`;
    };
    if (search) {
      let debounce: number | undefined;
      search.addEventListener('input', () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(render, 150);
      });
    }
    render();
    form.dataset.authorPostsLoaded = 'true';
  } catch (error) {
    loadingStatus.textContent = error instanceof Error ? error.message : 'Could not load your published stories.';
  }
}

const POST_METADATA_COLLECTION = 'cc.coffeencode.post.metadata';

type PostMetadataValue = {
  sources?: string[];
  backlink?: string;
  createdAt?: string;
};

async function fetchPostMetadataRecord(did: string, rkey: string): Promise<PostMetadataValue | undefined> {
  const activeSession = requireSession();
  const query = new URLSearchParams({ repo: did, collection: POST_METADATA_COLLECTION, rkey });
  const response = await activeSession.fetchHandler(`/xrpc/com.atproto.repo.getRecord?${query.toString()}`);
  if (response.ok) {
    const result = await response.json() as { value?: Record<string, unknown> };
    if (result.value && result.value.$type !== POST_METADATA_COLLECTION) {
      throw new Error('This story has a metadata record with an unexpected record type.');
    }
    return result.value as PostMetadataValue | undefined;
  }
  const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (isMissingRecordResponse(response.status, payload)) return undefined;
  throw new Error([payload?.error, payload?.message].filter(Boolean).join(': ') || `Could not load post metadata (${response.status}).`);
}

async function loadPostMetadataEditor(did: string) {
  if (!accountPage) return;
  const section = accountPage.querySelector<HTMLElement>('[data-post-metadata]');
  const list = accountPage.querySelector<HTMLElement>('[data-post-metadata-list]');
  const status = accountPage.querySelector<HTMLElement>('[data-post-metadata-status]');
  const search = accountPage.querySelector<HTMLInputElement>('[data-post-metadata-search]');
  if (!section || !list || !status) return;
  status.textContent = 'Loading your stories…';
  try {
    const response = await fetch(`/api/account/posts?author=${encodeURIComponent(did)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load your published stories.');
    const posts = (await response.json() as Array<{ uri?: string; path?: string; title?: string; publishedAt?: string }>)
      // Metadata records live in the same repository as the document, so only
      // stories stored in this account's repo can be edited here.
      .filter((post): post is { uri: string; path?: string; title?: string; publishedAt?: string } =>
        typeof post.uri === 'string' && post.uri.startsWith(`at://${did}/`))
      .sort((a, b) => (Date.parse(b.publishedAt || '') || 0) - (Date.parse(a.publishedAt || '') || 0));
    if (session?.did !== did) return;
    if (!posts.length) {
      status.textContent = 'Stories published in your repository will appear here.';
      return;
    }
    const itemCache = new Map<string, HTMLElement>();
    const render = () => {
      const query = (search?.value || '').trim().toLowerCase();
      const matches = query
        ? posts.filter((post) => (post.title || '').toLowerCase().includes(query)
          || (post.path || '').toLowerCase().includes(query))
        : posts;
      const shown = matches.slice(0, query ? 12 : 8);
      const fragment = document.createDocumentFragment();
      for (const post of shown) {
        let item = itemCache.get(post.uri);
        if (!item) {
          item = buildPostMetadataItem(did, post);
          itemCache.set(post.uri, item);
        }
        fragment.append(item);
      }
      list.replaceChildren(fragment);
      status.textContent = query
        ? (matches.length
          ? `${matches.length} ${matches.length === 1 ? 'story' : 'stories'} match${matches.length === 1 ? 'es' : ''}${matches.length > shown.length ? ` — showing the first ${shown.length}.` : '.'}`
          : `No stories match your search.`)
        : `Showing your ${shown.length} most recent stories. Search to find others.`;
    };
    if (search) {
      let debounce: number | undefined;
      search.addEventListener('input', () => {
        window.clearTimeout(debounce);
        debounce = window.setTimeout(render, 150);
      });
    }
    render();
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not load your published stories.';
  }
}

function buildPostMetadataItem(did: string, post: { uri: string; path?: string; title?: string; publishedAt?: string }) {
  const rkey = post.uri.split('/').pop() || '';
  const item = document.createElement('li');
  item.className = 'account-post-metadata__item';

  const row = document.createElement('div');
  row.className = 'account-post-metadata__row';
  const title = document.createElement('span');
  title.className = 'account-post-metadata__title';
  if (post.path) {
    const link = document.createElement('a');
    link.href = post.path;
    link.textContent = post.title || 'Untitled story';
    title.append(link);
  } else {
    title.textContent = post.title || 'Untitled story';
  }
  const badges = document.createElement('span');
  badges.className = 'account-post-metadata__badges';
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'account-post-metadata__edit';
  editButton.textContent = 'Edit metadata';
  row.append(title, badges, editButton);

  const form = document.createElement('form');
  form.className = 'account-post-metadata__form';
  form.hidden = true;
  const sourcesLabel = document.createElement('label');
  sourcesLabel.textContent = 'Sources (one URL per line)';
  const sourcesInput = document.createElement('textarea');
  sourcesInput.name = 'sources';
  sourcesInput.rows = 3;
  sourcesInput.placeholder = 'https://example.com/article';
  sourcesLabel.append(sourcesInput);
  const backlinkLabel = document.createElement('label');
  backlinkLabel.textContent = 'Source document (URL or at:// URI, optional)';
  const backlinkInput = document.createElement('input');
  backlinkInput.name = 'backlink';
  backlinkInput.placeholder = 'https://docs.google.com/… or at://did:plc:…';
  backlinkLabel.append(backlinkInput);
  const actions = document.createElement('div');
  actions.className = 'account-post-metadata__form-actions';
  const saveButton = document.createElement('button');
  saveButton.type = 'submit';
  saveButton.className = 'account-post-metadata__save';
  saveButton.textContent = 'Save metadata';
  const cancelButton = document.createElement('button');
  cancelButton.type = 'button';
  cancelButton.className = 'account-post-metadata__cancel';
  cancelButton.textContent = 'Cancel';
  actions.append(saveButton, cancelButton);
  const formStatus = document.createElement('p');
  formStatus.className = 'account-post-metadata__form-status';
  formStatus.setAttribute('role', 'status');
  form.append(sourcesLabel, backlinkLabel, actions, formStatus);
  item.append(row, form);

  let loaded = false;
  let existing: PostMetadataValue | undefined;
  const updateBadges = () => {
    badges.replaceChildren();
    const count = Array.isArray(existing?.sources) ? existing!.sources.length : 0;
    const parts: string[] = [];
    if (count) parts.push(`${count} ${count === 1 ? 'source' : 'sources'}`);
    if (existing?.backlink) parts.push('linked document');
    if (parts.length) {
      const badge = document.createElement('span');
      badge.className = 'account-post-metadata__badge';
      badge.textContent = parts.join(' · ');
      badges.append(badge);
    }
  };

  editButton.onclick = async () => {
    if (form.hidden && !loaded) {
      editButton.disabled = true;
      formStatus.textContent = 'Loading metadata…';
      form.hidden = false;
      try {
        existing = await fetchPostMetadataRecord(did, rkey);
        if (session?.did !== did) return;
        loaded = true;
        sourcesInput.value = Array.isArray(existing?.sources) ? existing!.sources.join('\n') : '';
        backlinkInput.value = typeof existing?.backlink === 'string' ? existing.backlink : '';
        formStatus.textContent = '';
        updateBadges();
      } catch (error) {
        formStatus.textContent = error instanceof Error ? error.message : 'Could not load post metadata.';
      } finally {
        editButton.disabled = false;
      }
      return;
    }
    form.hidden = !form.hidden;
  };
  cancelButton.onclick = () => {
    form.hidden = true;
    formStatus.textContent = '';
  };
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (session?.did !== did) return;
    const sources = [...new Set(sourcesInput.value.split('\n').map((line) => line.trim()).filter(Boolean))];
    const invalidSource = sources.find((source) => {
      try {
        const url = new URL(source);
        return url.protocol !== 'https:' && url.protocol !== 'http:';
      } catch {
        return true;
      }
    });
    if (invalidSource) {
      formStatus.textContent = `"${invalidSource}" is not a valid http(s) URL.`;
      return;
    }
    const backlink = backlinkInput.value.trim();
    const isAtUri = /^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/[a-zA-Z0-9.]+\/[a-zA-Z0-9._~:-]+$/.test(backlink);
    const isHttpUrl = (() => {
      try {
        const url = new URL(backlink);
        return url.protocol === 'https:' || url.protocol === 'http:';
      } catch {
        return false;
      }
    })();
    if (backlink && !isAtUri && !isHttpUrl) {
      formStatus.textContent = 'The source document must be a valid URL or at:// URI.';
      return;
    }

    saveButton.disabled = true;
    formStatus.textContent = 'Saving metadata…';
    try {
      if (!sources.length && !backlink) {
        if (loaded && existing) {
          await repoRequest('com.atproto.repo.deleteRecord', { repo: did, collection: POST_METADATA_COLLECTION, rkey });
        }
        existing = undefined;
        formStatus.textContent = 'Metadata removed.';
      } else {
        const record: Record<string, unknown> = {
          $type: POST_METADATA_COLLECTION,
          createdAt: typeof existing?.createdAt === 'string' ? existing.createdAt : new Date().toISOString(),
        };
        if (sources.length) record.sources = sources;
        if (backlink) record.backlink = backlink;
        await repoRequest('com.atproto.repo.putRecord', {
          repo: did,
          collection: POST_METADATA_COLLECTION,
          rkey,
          record,
        });
        existing = record as PostMetadataValue;
        formStatus.textContent = 'Metadata saved. It will appear on the story page shortly.';
      }
      loaded = true;
      updateBadges();
    } catch (error) {
      formStatus.textContent = error instanceof Error ? error.message : 'Could not save post metadata.';
    } finally {
      saveButton.disabled = false;
    }
  };
  updateBadges();
  return item;
}

async function uploadAuthorImage(file: File): Promise<unknown> {
  const activeSession = requireSession();
  const response = await activeSession.fetchHandler('/xrpc/com.atproto.repo.uploadBlob', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  if (response.ok) {
    const result = await response.json() as { blob?: unknown };
    if (!result.blob) throw new Error('The PDS did not return an uploaded image.');
    return result.blob;
  }
  const payload = await response.clone().json().catch(() => null) as { error?: string; message?: string } | null;
  if (response.status === 401 || response.status === 403) {
    throw new Error('Your account has not granted image upload permission. Sign out and back in to approve the updated permissions.');
  }
  throw new Error([payload?.error, payload?.message].filter(Boolean).join(': ') || `Image upload failed (${response.status}).`);
}

// Videos upload to the author's PDS first (same uploadBlob permission as
// images); the worker then copies the blob into the R2 bucket. When the PDS
// rejects the file — usually its blob size limit — the bytes go straight to
// the storage endpoint instead. Either path returns the public
// storage.coffeencode.cc/video/ URL embedded in the draft.
// 100 MB — the worker's request-body limit for the storage proxy.
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
async function uploadAuthorVideo(file: File): Promise<{ url: string; mimeType: string }> {
  if (file.size > VIDEO_MAX_BYTES) {
    throw new Error('Video exceeds the 100 MB limit. Choose a smaller file.');
  }
  const activeSession = requireSession();
  try {
    const response = await activeSession.fetchHandler('/xrpc/com.atproto.repo.uploadBlob', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
      body: file,
    });
    if (response.ok) {
      const result = await response.json() as { blob?: { ref?: { $link?: unknown } } };
      const cid = result.blob?.ref?.$link;
      if (typeof cid === 'string') {
        const copy = await fetch('/api/video', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ did: activeSession.did, cid }),
        });
        const payload = await copy.json().catch(() => null) as { url?: unknown; error?: string } | null;
        if (copy.ok && typeof payload?.url === 'string') {
          return { url: payload.url, mimeType: file.type || 'video/mp4' };
        }
      }
    }
    // The PDS refused the blob (size/type) — fall through to the direct upload.
  } catch { /* Network or session error — try the direct upload anyway. */ }

  const copy = await fetch(`/api/video?did=${encodeURIComponent(activeSession.did)}`, {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
    body: file,
  });
  const payload = await copy.json().catch(() => null) as { url?: unknown; error?: string } | null;
  if (!copy.ok || typeof payload?.url !== 'string') {
    throw new Error(payload?.error || `Video upload failed (${copy.status}).`);
  }
  return { url: payload.url, mimeType: file.type || 'video/mp4' };
}

type AccountPostSummary = {
  uri: string;
  path: string;
  title?: string;
  description?: string;
  publishedAt?: string;
  cover?: string;
  author?: { did?: string; handle?: string; displayName?: string; avatar?: string };
};

// Bluesky-style card: avatar, author line, title, excerpt, and a cover thumb.
function storyCard(post: AccountPostSummary | undefined, fallbackHref: string, emptyTitle: string, metaText?: string) {
  const item = document.createElement('li');
  item.className = 'story-card';
  const avatar = document.createElement('span');
  avatar.className = 'story-card__avatar';
  if (post?.author?.avatar) {
    const img = document.createElement('img');
    img.src = post.author.avatar;
    img.alt = '';
    img.loading = 'lazy';
    avatar.append(img);
  } else {
    avatar.innerHTML = '<i class="fa-solid fa-user" aria-hidden="true"></i>';
  }
  item.append(avatar);

  const main = document.createElement('div');
  main.className = 'story-card__main';
  const byline = document.createElement('div');
  byline.className = 'story-card__byline';
  const authorHandle = post?.author?.handle;
  const authorName = post?.author?.displayName || authorHandle;
  if (authorName) {
    const authorLink = document.createElement('a');
    authorLink.className = 'story-card__author';
    authorLink.href = `/author/${encodeURIComponent(authorHandle || authorName)}`;
    authorLink.textContent = authorName;
    byline.append(authorLink);
    if (authorHandle) {
      const handle = document.createElement('span');
      handle.className = 'story-card__handle';
      handle.textContent = `@${authorHandle}`;
      byline.append(handle);
    }
    byline.append(document.createTextNode('·'));
  }
  if (post?.publishedAt && Number.isFinite(Date.parse(post.publishedAt))) {
    const time = document.createElement('time');
    time.dateTime = post.publishedAt;
    time.textContent = new Date(post.publishedAt).toLocaleDateString();
    byline.append(time);
  }
  main.append(byline);

  const link = document.createElement('a');
  link.className = 'story-card__story';
  link.href = post?.path || fallbackHref;
  const heading = document.createElement('h3');
  heading.textContent = post?.title || emptyTitle;
  link.append(heading);
  const excerpt = (post?.description || '').trim();
  if (excerpt) {
    const summary = document.createElement('p');
    summary.textContent = excerpt.length > 180 ? `${excerpt.slice(0, 177).trimEnd()}…` : excerpt;
    link.append(summary);
  }
  main.append(link);
  if (metaText) {
    const meta = document.createElement('small');
    meta.className = 'story-card__meta';
    meta.textContent = metaText;
    main.append(meta);
  }
  item.append(main);
  if (post?.cover) {
    const cover = document.createElement('img');
    cover.className = 'story-card__cover';
    cover.src = post.cover;
    cover.alt = '';
    cover.loading = 'lazy';
    item.append(cover);
  }
  return item;
}

async function loadAccountViewedPosts(did: string) {
  if (!accountPage) return;
  const list = accountPage.querySelector<HTMLUListElement>('[data-viewed-posts]');
  const status = accountPage.querySelector<HTMLElement>('[data-viewed-status]');
  if (!list || !status) return;
  try {
    const query = new URLSearchParams({ repo: did, collection: 'cc.coffeencode.interact.view', limit: '100' });
    const [recordsResponse, postsResponse] = await Promise.all([
      repoRequest(`com.atproto.repo.listRecords?${query.toString()}`),
      fetch('/api/account/posts', { cache: 'no-store' }),
    ]);
    if (!postsResponse.ok) throw new Error('Could not load published posts.');
    const recordsPayload = await recordsResponse.json() as { records?: Array<{ value?: { document?: string; createdAt?: string } }> };
    const posts = await postsResponse.json() as AccountPostSummary[];
    const postByUri = new Map(posts.map((post) => [post.uri, post]));
    const views = (recordsPayload.records || [])
      .filter((record) => typeof record.value?.document === 'string' && record.value.document.startsWith('at://'))
      .sort((a, b) => (Date.parse(b.value?.createdAt || '') || 0) - (Date.parse(a.value?.createdAt || '') || 0));
    const seen = new Set<string>();
    const viewed = views.filter((record) => {
      const uri = record.value?.document || '';
      if (seen.has(uri)) return false;
      seen.add(uri);
      return true;
    }).slice(0, 50);
    if (!viewed.length) {
      status.textContent = 'Posts you view while signed in will appear here.';
      return;
    }

    const fragment = document.createDocumentFragment();
    for (const record of viewed) {
      const uri = record.value?.document || '';
      const post = postByUri.get(uri);
      const match = uri.match(/^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/);
      const href = post?.path || (match ? `/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}` : '/');
      const meta = record.value?.createdAt && Number.isFinite(Date.parse(record.value.createdAt))
        ? `Viewed ${new Date(record.value.createdAt).toLocaleDateString()}`
        : 'Viewed recently';
      fragment.append(storyCard(post, href, 'Viewed story', meta));
    }
    list.replaceChildren(fragment);
    status.hidden = true;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not load your viewed posts.';
  }
}

async function loadAccountSavedPosts(did: string) {
  if (!accountPage) return;
  const list = accountPage.querySelector<HTMLUListElement>('[data-saved-posts]');
  const status = accountPage.querySelector<HTMLElement>('[data-saved-status]');
  const count = accountPage.querySelector<HTMLElement>('[data-saved-count]');
  if (!list || !status) return;
  const renderCount = () => {
    if (count) count.textContent = list.children.length ? `${list.children.length} saved` : '';
  };
  try {
    const query = new URLSearchParams({ repo: did, collection: 'cc.coffeencode.save', limit: '100' });
    const [recordsResponse, postsResponse] = await Promise.all([
      repoRequest(`com.atproto.repo.listRecords?${query.toString()}`),
      fetch('/api/account/posts', { cache: 'no-store' }),
    ]);
    if (!postsResponse.ok) throw new Error('Could not load published posts.');
    const recordsPayload = await recordsResponse.json() as {
      records?: Array<{ uri?: string; value?: { target?: { document?: string }; createdAt?: string } }>;
    };
    const posts = await postsResponse.json() as AccountPostSummary[];
    const postByUri = new Map(posts.map((post) => [post.uri, post]));
    const saved = (recordsPayload.records || [])
      .map((record) => {
        const match = record.uri?.match(/^at:\/\/(did:[^/]+)\/cc\.coffeencode\.save\/([a-zA-Z0-9._~:-]+)$/);
        const uri = record.value?.target?.document;
        return match?.[1] === did && typeof uri === 'string' && uri.startsWith('at://')
          ? { rkey: match[2], uri, createdAt: record.value?.createdAt }
          : undefined;
      })
      .filter((record): record is { rkey: string; uri: string; createdAt: string | undefined } => Boolean(record))
      .sort((a, b) => (Date.parse(b.createdAt || '') || 0) - (Date.parse(a.createdAt || '') || 0));
    const unique = new Map<string, typeof saved[number]>();
    saved.forEach((record) => { if (!unique.has(record.uri)) unique.set(record.uri, record); });
    if (!unique.size) {
      status.textContent = 'Stories you save will appear here.';
      return;
    }

    const fragment = document.createDocumentFragment();
    unique.forEach(({ rkey, uri, createdAt }) => {
      const post = postByUri.get(uri);
      const match = uri.match(/^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/);
      const href = post?.path || (match ? `/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}` : '/');
      const meta = createdAt && Number.isFinite(Date.parse(createdAt))
        ? `Saved ${new Date(createdAt).toLocaleDateString()}`
        : undefined;
      const item = storyCard(post, href, 'Saved story', meta);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'account-page__remove-save';
      const removeIcon = document.createElement('i');
      removeIcon.className = 'fa-solid fa-trash-can';
      removeIcon.setAttribute('aria-hidden', 'true');
      remove.append(removeIcon, document.createTextNode(' Remove'));
      const savedTitle = post?.title || 'Saved story';
      remove.setAttribute('aria-label', `Remove ${savedTitle} from your reading list`);
      remove.addEventListener('click', async () => {
        if (session?.did !== did) return;
        remove.disabled = true;
        try {
          await repoRequest('com.atproto.repo.deleteRecord', { repo: did, collection: 'cc.coffeencode.save', rkey });
          item.remove();
          renderCount();
          status.hidden = false;
          status.textContent = list.children.length
            ? `Removed “${savedTitle}” from your reading list.`
            : 'Stories you save will appear here.';
        } catch (error) {
          status.hidden = false;
          status.textContent = errorMessage(error);
          remove.disabled = false;
        }
      });
      item.querySelector('.story-card__byline')?.append(remove);
      fragment.append(item);
    });
    list.replaceChildren(fragment);
    renderCount();
    status.hidden = true;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not load your reading list.';
  }
}

try {
  const clientOrigin = new URL(oauthMetadata.client_id!).origin;
  if (window.location.origin !== clientOrigin) {
    throw new Error(`AT Protocol sign-in is configured for ${clientOrigin}.`);
  }
  client = new BrowserOAuthClient({
    clientMetadata: oauthMetadata,
    handleResolver,
    onSessionDeleted: (did) => {
      forgetAccount(did);
      if (session?.did !== did) {
        renderAccountSwitchers();
        return;
      }
      session = undefined;
      renderAccount();
    },
  });
} catch (error) {
  initializationError = error;
}

renderAccount();

if (initializationError && authForm) {
  showAuthError(`Sign-in could not initialize: ${errorMessage(initializationError)}`);
}

const oauthReady = (async () => {
  if (client) {
    try {
      const initialized = await initializeOAuthClient(client);
      if (initialized) {
        session = initialized.session;
        setLastAuthMethod('oauth');
        rememberAccount(session.did);
        if ('state' in initialized) callbackState = initialized.state;
      }
    } catch (error) {
      initializationError = error;
      if (authForm) showAuthError(`Sign-in could not initialize: ${errorMessage(error)}`);
    }
  }

  // Restore a stored app-password session — when it was the last method used it
  // takes precedence over a still-valid OAuth session, otherwise it only fills
  // in when OAuth found nothing.
  const storedPasswordSession = loadStoredPasswordSession();
  if (storedPasswordSession && (!session || lastAuthMethod() === 'password')) {
    const restored = createPasswordSession(storedPasswordSession);
    try {
      const check = await restored.fetchHandler('/xrpc/com.atproto.server.getSession');
      if (!check.ok) throw new Error('Stored session rejected');
      session = restored;
      setLastAuthMethod('password');
      rememberAccount(storedPasswordSession.did, { ...(storedPasswordSession.handle ? { handle: storedPasswordSession.handle } : {}) });
    } catch {
      clearPasswordSession();
      forgetAccount(storedPasswordSession.did);
      setLastAuthMethod(session ? 'oauth' : undefined);
    }
  }

  oauthInitialized = true;
  renderAccount();
  void showAuthWelcome();
  if (callbackState !== undefined && window.location.pathname === '/auth') {
    // Land on a welcome state first — it confirms who signed in before
    // continuing on to wherever they were headed.
    const doneUrl = new URL('/auth', window.location.origin);
    doneUrl.searchParams.set('state', 'completed');
    const known = session ? loadKnownAccounts().find((a) => a.did === session.did) : undefined;
    if (known?.handle) doneUrl.searchParams.set('handle', known.handle);
    doneUrl.searchParams.set('returnTo', safeReturnPath(callbackState));
    window.location.replace(`${doneUrl.pathname}${doneUrl.search}`);
  }
})();

// /auth carries a few "panel" states: ?state=completed shows a welcome panel
// after OAuth, ?state=signed-out confirms sign-out. Either way the card swaps
// its whole contents for that panel.
async function showAuthWelcome() {
  const params = new URLSearchParams(window.location.search);
  if (window.location.pathname !== '/auth' || !authOptions) return;
  const state = params.get('state');

  const takeOverCard = (panel: HTMLElement) => {
    authWelcomeShown = true;
    authOptions.hidden = false;
    authOptions.querySelectorAll<HTMLElement>(':scope > *').forEach((el) => { el.hidden = el !== panel; });
    panel.hidden = false;
  };

  if (state === 'signed-out') {
    if (!signedOutBlock) return;
    takeOverCard(signedOutBlock);
    if (signedOutContinue) {
      signedOutContinue.href = `/auth?returnTo=${encodeURIComponent(safeReturnPath(params.get('returnTo')))}`;
    }
    return;
  }

  if (state !== 'completed' || !session || !welcomeBlock) return;

  takeOverCard(welcomeBlock);
  if (welcomeContinue) welcomeContinue.href = safeReturnPath(params.get('returnTo'));

  const did = session.did;
  const fallback = params.get('handle') || did;
  if (welcomeName) welcomeName.textContent = fallback;
  if (welcomeHandle) welcomeHandle.textContent = fallback.startsWith('did:') ? did : fallback;

  // Identity cascade: author profile first, then the Coffee & Code reader
  // profile, then the public Bluesky profile. Each layer only fills fields the
  // earlier ones didn't set.
  let name: string | undefined;
  let handle: string | undefined;
  let pronouns: string | undefined;
  let avatarUrl: string | undefined;

  const blobAvatarUrl = async (blob: unknown) => {
    const link = (blob as { ref?: { $link?: unknown } } | undefined)?.ref?.$link;
    if (typeof link !== 'string' || !link) return undefined;
    const activeSession = session;
    if (!activeSession) return undefined;
    const query = new URLSearchParams({ did, cid: link });
    const response = await activeSession.fetchHandler(`/xrpc/com.atproto.sync.getBlob?${query}`);
    if (!response.ok) return undefined;
    return URL.createObjectURL(await response.blob());
  };

  try {
    const query = new URLSearchParams({ repo: did, collection: 'cc.coffeencode.author.profile', rkey: 'self' });
    const activeSession = session;
    const response = await activeSession.fetchHandler(`/xrpc/com.atproto.repo.getRecord?${query}`);
    if (response.ok) {
      const result = await response.json() as { value?: Record<string, unknown> };
      const value = result.value;
      if (value && value.$type === 'cc.coffeencode.author.profile') {
        if (typeof value.displayName === 'string' && value.displayName) name = value.displayName;
        if (typeof value.pronouns === 'string' && value.pronouns) pronouns = value.pronouns;
        avatarUrl = await blobAvatarUrl(value.avatar).catch(() => undefined);
      }
    }
  } catch {}

  try {
    const readerProfile = await fetchUserProfileRecord(did);
    if (readerProfile) {
      if (!name && typeof readerProfile.displayName === 'string' && readerProfile.displayName) name = readerProfile.displayName;
      if (!pronouns && typeof readerProfile.pronouns === 'string' && readerProfile.pronouns) pronouns = readerProfile.pronouns;
    }
  } catch {}

  try {
    const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
    if (response.ok) {
      const profile = await response.json() as {
        avatar?: string; displayName?: string; handle?: string; pronouns?: string;
      };
      if (profile.handle) handle = profile.handle;
      name = name || profile.displayName || profile.handle;
      pronouns = pronouns || profile.pronouns;
      if (!avatarUrl && profile.avatar) avatarUrl = accountAvatarUrl(profile.avatar);
      rememberAccount(did, {
        ...(profile.handle ? { handle: profile.handle } : {}),
        ...(profile.displayName ? { displayName: profile.displayName } : {}),
        ...(profile.avatar ? { avatar: accountAvatarUrl(profile.avatar) } : {}),
        profileFetchedAt: Date.now(),
      });
    }
  } catch {}

  if (session?.did !== did) return;
  const displayName = name || handle || fallback;
  if (welcomeName) welcomeName.textContent = displayName;
  if (welcomeHandle) welcomeHandle.textContent = handle || (fallback.startsWith('did:') ? did : fallback);
  if (pronouns && welcomePronouns && welcomePronounsValue) {
    welcomePronounsValue.textContent = pronouns;
    welcomePronouns.hidden = false;
  }
  if (avatarUrl && welcomeAvatar) {
    welcomeAvatar.src = avatarUrl;
    welcomeAvatar.alt = `${displayName} profile picture`;
    welcomeAvatar.hidden = false;
    if (welcomePlaceholder) welcomePlaceholder.hidden = true;
  }
}

createCoffeeAccountButton?.addEventListener('click', async () => {
  clearAuthError();
  if (!client) {
    showAuthError(`Sign-in could not initialize: ${errorMessage(initializationError)}`);
    return;
  }

  if (!signupInviteCode) {
    createCoffeeAccountButton.disabled = true;
    createCoffeeAccountLabel.textContent = 'Getting an invite code…';
    try {
      const response = await fetch('/api/invite-code', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not get a signup invite code. Please try again shortly.');
      const result = await response.json() as { code?: unknown };
      if (typeof result.code !== 'string' || !result.code) throw new Error('Invite service returned an invalid code.');
      signupInviteCode = result.code;
      if (inviteCodeElement) inviteCodeElement.textContent = signupInviteCode;
      if (invitePanel) invitePanel.hidden = false;
      if (inviteStatus) inviteStatus.textContent = 'Copy this invite code. The Coffee & Code account page will ask you to paste it during sign-up.';
      createCoffeeAccountLabel.textContent = 'Continue to account creation';
      createCoffeeAccountButton.disabled = false;
      return;
    } catch (error) {
      showAuthError(errorMessage(error));
      createCoffeeAccountLabel.textContent = 'Create a Coffee & Code account';
      createCoffeeAccountButton.disabled = false;
      return;
    }
  }

  createCoffeeAccountButton.disabled = true;
  createCoffeeAccountLabel.textContent = 'Connecting…';
  try {
    const scope = await requestedScope('account.coffeencode.cc');
    const activeClient = client;
    if (!activeClient) throw initializationError || new Error('OAuth client is unavailable.');
    const returnPath = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
    await activeClient.signInRedirect('https://account.coffeencode.cc', { state: returnPath, prompt: 'create', scope });
  } catch (error) {
    showAuthError(errorMessage(error));
    createCoffeeAccountButton.disabled = false;
    createCoffeeAccountLabel.textContent = 'Continue to account creation';
  }
});

copyInviteButton?.addEventListener('click', async () => {
  if (!signupInviteCode) return;
  try {
    await navigator.clipboard.writeText(signupInviteCode);
    copyInviteButton.textContent = 'Copied';
  } catch {
    const range = document.createRange();
    if (inviteCodeElement) {
      range.selectNodeContents(inviteCodeElement);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
    copyInviteButton.textContent = 'Select and copy the code';
  }
});

async function listOwnForumVotes(activeSession: AuthSession) {
  const votes: Array<{ rkey: string; subjectUri: string; direction: 'up' | 'down'; createdAt: string }> = [];
  const uriPrefix = `at://${activeSession.did}/cc.coffeencode.forum.vote/`;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const query = new URLSearchParams({
      repo: activeSession.did,
      collection: 'cc.coffeencode.forum.vote',
      limit: '100',
    });
    if (cursor) query.set('cursor', cursor);
    const response = await activeSession.fetchHandler(`/xrpc/com.atproto.repo.listRecords?${query.toString()}`);
    if (!response.ok) throw new Error(`Could not load your forum votes (${response.status}).`);
    const page = await response.json() as {
      records?: Array<{ uri?: unknown; value?: { subject?: { uri?: unknown }; direction?: unknown; createdAt?: unknown } }>;
      cursor?: string;
    };
    for (const record of page.records || []) {
      const rkey = typeof record.uri === 'string' && record.uri.startsWith(uriPrefix)
        ? record.uri.slice(uriPrefix.length)
        : '';
      const direction = record.value?.direction;
      const createdAt = record.value?.createdAt;
      const subjectUri = record.value?.subject?.uri;
      if (/^[a-zA-Z0-9._~:-]+$/.test(rkey) && typeof subjectUri === 'string'
        && /^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/[a-zA-Z0-9._:-]+\/[a-zA-Z0-9._~:-]+$/.test(subjectUri)
        && (direction === 'up' || direction === 'down')
        && typeof createdAt === 'string' && Number.isFinite(Date.parse(createdAt))) {
        votes.push({ rkey, subjectUri, direction, createdAt });
      }
    }
    cursor = page.cursor;
    if (cursor && seenCursors.has(cursor)) throw new Error('The account provider returned a repeated forum vote cursor.');
    if (cursor) seenCursors.add(cursor);
    if (seenCursors.size > 1000) throw new Error('Your forum vote history is too large to load.');
  } while (cursor);
  return votes.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

const listCollection = 'cc.coffeencode.list';
const listItemCollection = 'cc.coffeencode.list.item';
const legacyListItemCollection = 'cc.coffeencode.cclist.item';
const listUriPattern = /^at:\/\/(did:[a-z0-9]+:[a-zA-Z0-9._:%-]+)\/cc\.coffeencode\.list\/([a-zA-Z0-9._~:-]+)$/;

function ownListRkey(listUri: string, did: string) {
  const match = listUri.match(listUriPattern);
  if (!match || match[1] !== did) throw new Error('You can only change your own lists.');
  return match[2];
}

async function listOwnLists(did: string): Promise<UserListSummary[]> {
  const lists: UserListSummary[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const query = new URLSearchParams({ repo: did, collection: listCollection, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const response = await repoRequest(`com.atproto.repo.listRecords?${query}`);
    const page = await response.json() as {
      records?: Array<{ uri?: unknown; value?: { title?: unknown; about?: unknown; icon?: unknown; createdAt?: unknown } }>;
      cursor?: unknown;
    };
    for (const record of page.records || []) {
      const value = record.value;
      if (typeof record.uri !== 'string' || !listUriPattern.test(record.uri)) continue;
      const title = typeof value?.title === 'string' ? value.title.trim() : '';
      const createdAt = value?.createdAt;
      if (!title || title.length > 600 || typeof createdAt !== 'string'
        || !Number.isFinite(Date.parse(createdAt))) continue;
      const icon = typeof value?.icon === 'string' ? value.icon.trim() : '';
      const about = typeof value?.about === 'string' ? value.about.trim() : '';
      lists.push({
        uri: record.uri,
        rkey: record.uri.split('/').at(-1) || '',
        title,
        ...(about ? { about } : {}),
        ...(icon && (icon.length <= 8 || /^https:\/\//i.test(icon)) ? { icon } : {}),
        createdAt,
      });
    }
    if (typeof page.cursor !== 'string' || !page.cursor || seenCursors.has(page.cursor)) break;
    seenCursors.add(page.cursor);
    if (seenCursors.size > 100) break;
    cursor = page.cursor;
  } while (cursor);
  return lists.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

type OwnListItem = { uri: string; rkey: string; collection: string; list: string; document: string };

async function listOwnListItems(did: string): Promise<OwnListItem[]> {
  const items: OwnListItem[] = [];
  // Older sessions wrote items to cc.coffeencode.cclist.item; keep reading those
  // records so existing lists keep working. New items are always written to
  // cc.coffeencode.list.item.
  for (const collection of [listItemCollection, legacyListItemCollection]) {
    let cursor: string | undefined;
    const seenCursors = new Set<string>();
    try {
    do {
      const query = new URLSearchParams({ repo: did, collection, limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const response = await repoRequest(`com.atproto.repo.listRecords?${query}`);
      const page = await response.json() as {
        records?: Array<{ uri?: unknown; value?: { list?: unknown; document?: unknown } }>;
        cursor?: unknown;
      };
      for (const record of page.records || []) {
        if (typeof record.uri !== 'string' || !record.uri.startsWith(`at://${did}/`)
          || typeof record.value?.list !== 'string' || !listUriPattern.test(record.value.list)
          || typeof record.value?.document !== 'string' || !record.value.document.startsWith('at://')) continue;
        items.push({
          uri: record.uri,
          rkey: record.uri.split('/').at(-1) || '',
          collection,
          list: record.value.list,
          document: record.value.document,
        });
      }
      if (typeof page.cursor !== 'string' || !page.cursor || seenCursors.has(page.cursor)) break;
      seenCursors.add(page.cursor);
      if (seenCursors.size > 100) break;
      cursor = page.cursor;
    } while (cursor);
    } catch (error) {
      // Missing scope or an empty legacy collection should not hide the rest.
      if (collection !== legacyListItemCollection) throw error;
    }
  }
  return items;
}

async function listItemKey(listUri: string, documentUri: string) {
  return recordKey(`${listUri} ${documentUri}`, 'item');
}

const preferencesSection = document.querySelector<HTMLElement>('[data-preferences]');
const preferencesStatus = preferencesSection?.querySelector<HTMLElement>('[data-preferences-status]');
const preferencesFontSize = preferencesSection?.querySelector<HTMLInputElement>('[data-pref-font-size]');
const preferencesFontSizeOutput = preferencesSection?.querySelector<HTMLOutputElement>('[data-pref-font-size-output]');
let readerPreferencesDid: string | undefined;
let preferencesSaveTimer: number | undefined;
let preferencesSaveQueue: Promise<void> = Promise.resolve();

function setPreferencesStatus(message: string) {
  if (preferencesStatus) preferencesStatus.textContent = message;
}

function syncPreferencesForm() {
  if (!preferencesSection) return;
  const prefs = window.coffeeAndCodePreferences?.get();
  if (!prefs) return;
  preferencesSection.querySelectorAll<HTMLInputElement>('input[name="pref-theme"]').forEach((input) => {
    input.checked = input.value === prefs.theme;
  });
  preferencesSection.querySelectorAll<HTMLInputElement>('input[name="pref-ui-font"]').forEach((input) => {
    input.checked = input.value === prefs.uiFont;
  });
  preferencesSection.querySelectorAll<HTMLInputElement>('input[name="pref-font"]').forEach((input) => {
    input.checked = input.value === prefs.postFont;
  });
  const size = prefs.postFontSize ?? 19;
  if (preferencesFontSize) preferencesFontSize.value = String(size);
  if (preferencesFontSizeOutput) preferencesFontSizeOutput.textContent = `${size}px`;
}

function readPreferencesForm(): { theme?: unknown; uiFont?: unknown; postFont?: unknown; postFontSize?: unknown } {
  return {
    theme: preferencesSection?.querySelector<HTMLInputElement>('input[name="pref-theme"]:checked')?.value,
    uiFont: preferencesSection?.querySelector<HTMLInputElement>('input[name="pref-ui-font"]:checked')?.value,
    postFont: preferencesSection?.querySelector<HTMLInputElement>('input[name="pref-font"]:checked')?.value,
    postFontSize: preferencesFontSize ? Number(preferencesFontSize.value) : undefined,
  };
}

function schedulePreferencesSave(did: string) {
  window.clearTimeout(preferencesSaveTimer);
  preferencesSaveTimer = window.setTimeout(() => {
    preferencesSaveQueue = preferencesSaveQueue.then(async () => {
      if (session?.did !== did) return;
      const active = window.coffeeAndCodePreferences?.get();
      if (!active) return;
      setPreferencesStatus('Saving your appearance…');
      const record: Record<string, unknown> = {
        $type: PREFERENCES_COLLECTION,
        theme: active.theme,
        uiFont: active.uiFont,
        postFont: active.postFont,
        updatedAt: new Date().toISOString(),
      };
      if (active.postFontSize !== undefined) record.postFontSize = active.postFontSize;
      try {
        await repoRequest('com.atproto.repo.putRecord', {
          repo: did,
          collection: PREFERENCES_COLLECTION,
          rkey: PREFERENCES_RKEY,
          record,
        });
        if (session?.did !== did) return;
        setPreferencesStatus('Appearance saved.');
      } catch (error) {
        setPreferencesStatus(errorMessage(error));
      }
    });
  }, 500);
}

if (preferencesSection) {
  preferencesSection.querySelectorAll<HTMLInputElement>('input[name="pref-theme"], input[name="pref-ui-font"], input[name="pref-font"]').forEach((input) => {
    input.addEventListener('change', () => {
      const did = session?.did;
      window.coffeeAndCodePreferences?.apply(readPreferencesForm());
      if (did) schedulePreferencesSave(did);
    });
  });
  preferencesFontSize?.addEventListener('input', () => {
    if (preferencesFontSizeOutput) preferencesFontSizeOutput.textContent = `${preferencesFontSize.value}px`;
    const did = session?.did;
    window.coffeeAndCodePreferences?.apply(readPreferencesForm());
    if (did) schedulePreferencesSave(did);
  });
}
syncPreferencesForm();

async function loadReaderPreferences(did: string) {
  if (readerPreferencesDid === did) return;
  try {
    const query = new URLSearchParams({ repo: did, collection: PREFERENCES_COLLECTION, rkey: PREFERENCES_RKEY });
    const response = await requireSession().fetchHandler(`/xrpc/com.atproto.repo.getRecord?${query.toString()}`);
    let value: Record<string, unknown> | undefined;
    if (response.ok) {
      const result = await response.json() as { value?: Record<string, unknown> };
      if (result.value && result.value.$type !== PREFERENCES_COLLECTION) {
        throw new Error('Your preferences record has an unexpected record type.');
      }
      value = result.value;
    } else {
      const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
      if (!isMissingRecordResponse(response.status, payload)) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Your account needs updated appearance permissions. Sign out, then sign in again and approve the requested permissions.');
        }
        throw new Error([payload?.error, payload?.message].filter(Boolean).join(': ') || `Could not load your appearance preferences (${response.status}).`);
      }
    }
    if (session?.did !== did) return;
    readerPreferencesDid = did;
    window.coffeeAndCodePreferences?.apply(value || {});
    syncPreferencesForm();
  } catch (error) {
    setPreferencesStatus(errorMessage(error));
  }
}

window.coffeeAndCodeAuth = {
  getDid: async () => {
    await oauthReady;
    return session?.did;
  },
  getNotificationsReadAt: async () => {
    await oauthReady;
    const marker = await readNotificationsMarker();
    return marker.lastRead;
  },
  markNotificationsRead: async () => {
    await oauthReady;
    const activeSession = requireSession();
    const marker = await readNotificationsMarker();
    const lastRead = new Date().toISOString();
    const record = { $type: 'cc.coffeencode.notifications.read', lastRead };
    if (marker.exists) {
      await repoRequest('com.atproto.repo.putRecord', {
        repo: activeSession.did,
        collection: 'cc.coffeencode.notifications.read',
        rkey: 'self',
        record,
      });
    } else {
      await repoRequest('com.atproto.repo.createRecord', {
        repo: activeSession.did,
        collection: 'cc.coffeencode.notifications.read',
        rkey: 'self',
        record,
      });
    }
    return lastRead;
  },
  getFeedSkeleton: async (cursor) => {
    await oauthReady;
    if (!session) return undefined;
    const query = new URLSearchParams({
      feed: 'at://did:plc:z7hzwpuv5ytin56wecfxa4mx/app.bsky.feed.generator/following',
      limit: '20',
    });
    if (cursor) query.set('cursor', cursor);
    const response = await session.fetchHandler(`/xrpc/app.bsky.feed.getFeedSkeleton?${query.toString()}`, {
      headers: {
        Accept: 'application/json',
        'atproto-proxy': 'did:web:feed.coffeencode.cc#bsky_fg',
      },
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new Error('Your sign-in needs feed access. Sign out and sign in again to approve the updated access, then reload this page.');
      }
      throw new Error('Your personalized feed could not be loaded. Please try again shortly.');
    }
    return await response.json();
  },
  blockUser: async (did: string, alsoOnBluesky: boolean) => {
    await oauthReady;
    await blockUser(did, alsoOnBluesky);
  },
  unblockUser: async (did: string) => {
    await oauthReady;
    await unblockUser(did);
  },
  createComment: async (record: { subject: { uri: string }; reply?: { parent: { uri: string } }; text: string; createdAt: string }) => {
    await oauthReady;
    const activeSession = requireSession();
    await repoRequest('com.atproto.repo.createRecord', {
      repo: activeSession.did,
      collection: 'cc.coffeencode.comment',
      record: { $type: 'cc.coffeencode.comment', ...record },
    });
  },
  editComment: async (uri: string, record: { subject: { uri: string }; reply?: { parent: { uri: string } }; text: string; createdAt: string }) => {
    await oauthReady;
    const activeSession = requireSession();
    const match = uri.match(/^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/);
    if (!match || match[1] !== activeSession.did || match[2] !== 'cc.coffeencode.comment') {
      throw new Error('You can only edit your own comments.');
    }
    await repoRequest('com.atproto.repo.putRecord', {
      repo: activeSession.did,
      collection: match[2],
      rkey: match[3],
      record: { $type: 'cc.coffeencode.comment', ...record },
    });
  },
  deleteComment: async (uri: string) => {
    await oauthReady;
    const activeSession = requireSession();
    const match = uri.match(/^at:\/\/(did:[^/]+)\/([^/]+)\/([^/]+)$/);
    if (!match || match[1] !== activeSession.did || match[2] !== 'cc.coffeencode.comment') {
      throw new Error('You can only delete your own comments.');
    }
    await repoRequest('com.atproto.repo.deleteRecord', { repo: activeSession.did, collection: match[2], rkey: match[3] });
  },
  toggleCommentLike: async (commentUri: string, isLiked: boolean, likeRkey?: string) => {
    await oauthReady;
    const activeSession = requireSession();
    const collection = 'cc.coffeencode.comment.like';
    if (!/^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/cc\.coffeencode\.comment\/[a-zA-Z0-9._~:-]+$/.test(commentUri)) {
      throw new Error('This comment link is invalid.');
    }
    if (isLiked) {
      if (!likeRkey || !/^[a-zA-Z0-9._~:-]+$/.test(likeRkey)) {
        throw new Error('Could not find your comment-like record. Refresh the comments and try again.');
      }
      await repoRequest('com.atproto.repo.deleteRecord', { repo: activeSession.did, collection, rkey: likeRkey });
      return undefined;
    }
    const rkey = await recordKey(commentUri, 'comment');
    const response = await repoRequest('com.atproto.repo.createRecord', {
      repo: activeSession.did,
      collection,
      rkey,
      record: { $type: collection, subject: { uri: commentUri }, createdAt: new Date().toISOString() },
    });
    const result = await response.json() as { uri?: string };
    const match = result.uri?.match(/^at:\/\/[^/]+\/cc\.coffeencode\.comment\.like\/([a-zA-Z0-9._~:-]+)$/);
    if (match?.[1] !== rkey) throw new Error('Your like was created, but its record key could not be confirmed. Refresh the comments before changing it.');
    return rkey;
  },
  createForumPost: async (forumUri: string, title: string, content: string, tags: string[], images: ForumImageInput[]) => {
    await oauthReady;
    const activeSession = requireSession();
    const uploadedImages = await uploadForumImages(images, activeSession);
    await repoRequest('com.atproto.repo.createRecord', {
      repo: activeSession.did,
      collection: 'cc.coffeencode.forum.post',
      record: {
        $type: 'cc.coffeencode.forum.post',
        forum: forumUri,
        title: title.trim(),
        content,
        ...(tags.length ? { tags } : {}),
        ...(uploadedImages.length ? { images: uploadedImages } : {}),
        createdAt: new Date().toISOString(),
      },
    });
  },
  createForumReply: async (root: ForumStrongRef, parent: ForumStrongRef, content: string, images: ForumImageInput[]) => {
    await oauthReady;
    const activeSession = requireSession();
    const uploadedImages = await uploadForumImages(images, activeSession);
    await repoRequest('com.atproto.repo.createRecord', {
      repo: activeSession.did,
      collection: 'cc.coffeencode.forum.reply',
      record: {
        $type: 'cc.coffeencode.forum.reply',
        root,
        parent,
        content,
        ...(uploadedImages.length ? { images: uploadedImages } : {}),
        createdAt: new Date().toISOString(),
      },
    });
  },
  getForumVotes: async (subjectUris: string[]) => {
    await oauthReady;
    const activeSession = requireSession();
    const subjects = new Set(subjectUris);
    const current: Record<string, 'up' | 'down'> = {};
    for (const vote of await listOwnForumVotes(activeSession)) {
      if (subjects.has(vote.subjectUri)) current[vote.subjectUri] = vote.direction;
    }
    return current;
  },
  setForumVote: async (subject: ForumStrongRef, direction: 'up' | 'down' | undefined) => {
    await oauthReady;
    const activeSession = requireSession();
    const votes = (await listOwnForumVotes(activeSession)).filter((vote) => vote.subjectUri === subject.uri);
    const latest = votes[votes.length - 1];
    for (const vote of votes) {
      if (!direction || vote.rkey !== latest?.rkey) {
        await repoRequest('com.atproto.repo.deleteRecord', {
          repo: activeSession.did,
          collection: 'cc.coffeencode.forum.vote',
          rkey: vote.rkey,
        });
      }
    }
    if (!direction) return;
    const record = {
      $type: 'cc.coffeencode.forum.vote',
      subject,
      direction,
      createdAt: new Date().toISOString(),
    };
    if (latest) {
      await repoRequest('com.atproto.repo.putRecord', {
        repo: activeSession.did,
        collection: 'cc.coffeencode.forum.vote',
        rkey: latest.rkey,
        record,
      });
    } else {
      await repoRequest('com.atproto.repo.createRecord', {
        repo: activeSession.did,
        collection: 'cc.coffeencode.forum.vote',
        record,
      });
    }
  },
  createForumModeration: async (forumUri: string, subject: ForumStrongRef, action: string, moderators: string[]) => {
    await oauthReady;
    const activeSession = requireSession();
    if (!moderators.some((did) => did.toLowerCase() === activeSession.did.toLowerCase())) {
      throw new Error('Your account is not a moderator of this forum.');
    }
    await repoRequest('com.atproto.repo.createRecord', {
      repo: activeSession.did,
      collection: 'cc.coffeencode.forum.moderation',
      record: {
        $type: 'cc.coffeencode.forum.moderation',
        forum: forumUri,
        subject,
        action,
        createdAt: new Date().toISOString(),
      },
    });
  },
  getLists: async () => {
    await oauthReady;
    const activeSession = requireSession();
    return listOwnLists(activeSession.did);
  },
  createList: async (input: ListInput) => {
    await oauthReady;
    const activeSession = requireSession();
    const title = input.title.trim();
    if (!title || title.length > 600) throw new Error('A list title is required (120 characters or fewer).');
    const about = input.about?.trim() || '';
    const icon = input.icon?.trim() || '';
    const response = await repoRequest('com.atproto.repo.createRecord', {
      repo: activeSession.did,
      collection: listCollection,
      rkey: createTid(),
      record: {
        $type: listCollection,
        title,
        ...(about ? { about } : {}),
        ...(icon ? { icon } : {}),
        createdAt: new Date().toISOString(),
      },
    });
    const result = await response.json() as { uri?: string };
    if (typeof result.uri !== 'string') throw new Error('The account provider did not return the new list URI.');
    return result.uri;
  },
  updateList: async (listUri: string, input: ListInput) => {
    await oauthReady;
    const activeSession = requireSession();
    const rkey = ownListRkey(listUri, activeSession.did);
    const title = input.title.trim();
    if (!title || title.length > 600) throw new Error('A list title is required (120 characters or fewer).');
    const about = input.about?.trim() || '';
    const icon = input.icon?.trim() || '';
    // Preserve createdAt and any fields other tools may have written.
    const getQuery = new URLSearchParams({ repo: activeSession.did, collection: listCollection, rkey });
    const existing = await repoRequest(`com.atproto.repo.getRecord?${getQuery}`)
      .then((response) => response.json() as Promise<{ value?: Record<string, unknown> }>)
      .then((data) => data.value || {})
      .catch(() => ({} as Record<string, unknown>));
    const createdAt = typeof existing.createdAt === 'string' ? existing.createdAt : new Date().toISOString();
    const record: Record<string, unknown> = {
      ...existing,
      $type: listCollection,
      title,
      createdAt,
      updatedAt: new Date().toISOString(),
    };
    if (about) record.about = about; else delete record.about;
    if (icon) record.icon = icon; else delete record.icon;
    await repoRequest('com.atproto.repo.putRecord', {
      repo: activeSession.did,
      collection: listCollection,
      rkey,
      record,
    });
  },
  deleteList: async (listUri: string) => {
    await oauthReady;
    const activeSession = requireSession();
    const rkey = ownListRkey(listUri, activeSession.did);
    const items = (await listOwnListItems(activeSession.did)).filter((item) => item.list === listUri);
    for (const item of items) {
      await repoRequest('com.atproto.repo.deleteRecord', {
        repo: activeSession.did,
        collection: item.collection,
        rkey: item.rkey,
      });
    }
    await repoRequest('com.atproto.repo.deleteRecord', {
      repo: activeSession.did,
      collection: listCollection,
      rkey,
    });
  },
  getListsWithMembership: async (documentUri: string) => {
    await oauthReady;
    const activeSession = requireSession();
    const [lists, items] = await Promise.all([
      listOwnLists(activeSession.did),
      listOwnListItems(activeSession.did),
    ]);
    const membership = new Set(items.filter((item) => item.document === documentUri).map((item) => item.list));
    return lists.map((list) => ({ ...list, inList: membership.has(list.uri) }));
  },
  setListItem: async (listUri: string, documentUri: string, inList: boolean) => {
    await oauthReady;
    const activeSession = requireSession();
    ownListRkey(listUri, activeSession.did);
    if (!documentUri.startsWith('at://') || !documentUri.includes('/site.standard.document/')) {
      throw new Error('Only stories can be added to a list.');
    }
    const rkey = await listItemKey(listUri, documentUri);
    if (inList) {
      // Remove any matching item in both the current and legacy collections.
      await Promise.all([listItemCollection, legacyListItemCollection].map((collection) =>
        repoRequest('com.atproto.repo.deleteRecord', {
          repo: activeSession.did,
          collection,
          rkey,
        }).catch(() => undefined)));
      return;
    }
    await repoRequest('com.atproto.repo.createRecord', {
      repo: activeSession.did,
      collection: listItemCollection,
      rkey,
      record: {
        $type: listItemCollection,
        list: listUri,
        document: documentUri,
        createdAt: new Date().toISOString(),
      },
    });
  },
};
window.dispatchEvent(new Event('coffee-and-code-auth-ready'));

const blockDialog = document.querySelector<HTMLDialogElement>('[data-block-dialog]');
const blockDialogTitle = blockDialog?.querySelector<HTMLElement>('[data-block-dialog-title]');
const blockDialogStatus = blockDialog?.querySelector<HTMLElement>('[data-block-dialog-status]');
const blockOnBluesky = blockDialog?.querySelector<HTMLInputElement>('[data-block-on-bluesky]');
const confirmBlockButton = blockDialog?.querySelector<HTMLButtonElement>('[data-confirm-block]');

document.addEventListener('click', async (event) => {
  const button = event.target instanceof Element
    ? event.target.closest<HTMLButtonElement>('[data-block-user-did]')
    : null;
  if (!button) return;
  event.preventDefault();
  await oauthReady;
  if (!session) {
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/auth?returnTo=${encodeURIComponent(safeReturnPath(currentPath))}`);
    return;
  }
  if (!blockDialog || !validBlockDid(button.dataset.blockUserDid)) return;
  blockDialog.dataset.blockDid = button.dataset.blockUserDid;
  if (blockDialogTitle) blockDialogTitle.textContent = `Block ${button.dataset.blockUserName || button.dataset.blockUserDid}?`;
  if (blockDialogStatus) blockDialogStatus.textContent = '';
  if (blockOnBluesky) blockOnBluesky.checked = false;
  blockDialog.showModal();
});

blockDialog?.querySelector('[data-cancel-block]')?.addEventListener('click', () => blockDialog.close());
confirmBlockButton?.addEventListener('click', async () => {
  const did = blockDialog?.dataset.blockDid;
  if (!did || !blockDialogStatus) return;
  confirmBlockButton.disabled = true;
  if (blockDialogStatus) blockDialogStatus.textContent = 'Saving your block…';
  try {
    await window.coffeeAndCodeAuth?.blockUser(did, Boolean(blockOnBluesky?.checked));
    if (blockDialogStatus) blockDialogStatus.textContent = 'Account blocked.';
    blockDialog?.close();
    if (accountPage) await renderBlockManager(session?.did || '');
  } catch (error) {
    blockDialogStatus.textContent = errorMessage(error);
  } finally {
    confirmBlockButton.disabled = false;
  }
});

async function uploadForumImages(images: ForumImageInput[], activeSession: AuthSession) {
  if (images.length > 10) throw new Error('A forum post can contain at most 10 images.');
  const allowedTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const uploaded = [];
  for (const { file, alt } of images) {
    if (!allowedTypes.has(file.type) || file.size > 2_000_000) {
      throw new Error('Forum images must be PNG, JPEG, WebP, or GIF files no larger than 2 MB.');
    }
    if (!alt.trim() || alt.trim().length > 1000) {
      throw new Error('Add alt text of no more than 1,000 characters for each image.');
    }
    const response = await activeSession.fetchHandler('/xrpc/com.atproto.repo.uploadBlob', {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => undefined) as { error?: string; message?: string } | undefined;
      const detail = [payload?.error, payload?.message].filter(Boolean).join(': ');
      throw new Error(detail || `Image upload failed (${response.status}).`);
    }
    const payload = await response.json() as { blob?: unknown };
    if (!payload.blob || typeof payload.blob !== 'object') {
      throw new Error('The account provider did not return the uploaded image blob.');
    }
    uploaded.push({
      $type: 'cc.coffeencode.forum.defs#image',
      image: payload.blob,
      alt: alt.trim(),
    });
  }
  return uploaded;
}

// Named providers (Bluesky, Eurosky, Blacksky, Coffee & Code) skip the handle
// step entirely — OAuth on the PDS asks for the account. Only the free-form
// "Use a handle" row reveals the handle form.
providerButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    clearAuthError();
    const provider = button.dataset.provider ?? '';
    if (!provider) {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      const opening = !expanded;
      providerButtons.forEach((b) => b.setAttribute('aria-expanded', String(b === button && opening)));
      if (authForm) authForm.hidden = !opening;
      if (!opening) return;
      if (handleLabel) handleLabel.textContent = 'Your handle';
      if (handleInput) {
        handleInput.placeholder = 'you.bsky.social';
        handleInput.focus();
      }
      if (handleHint) {
        handleHint.hidden = false;
        handleHint.textContent = 'Enter the full handle for any AT Protocol account. You’ll finish signing in on your provider’s site.';
      }
      return;
    }

    providerButtons.forEach((b) => {
      b.setAttribute('aria-expanded', 'false');
      b.disabled = true;
    });
    button.setAttribute('aria-expanded', 'true');
    if (!client) {
      showAuthError(`Sign-in could not initialize: ${errorMessage(initializationError)}`);
      providerButtons.forEach((b) => { b.disabled = false; });
      return;
    }
    await startOAuthSignIn(`https://${provider}`, button, true);
    providerButtons.forEach((b) => { b.disabled = false; });
    button.setAttribute('aria-expanded', 'false');
  });
});

// "Add account" links land on /auth?state=add — retitle the card and reveal
// the free-form handle form (providers still work for adding accounts too).
const authPageParams = new URLSearchParams(window.location.search);
if (window.location.pathname === '/auth' && authPageParams.get('state') === 'waiting') {
  // Landing back on ?state=waiting (e.g. browser Back) shouldn't leave the
  // card stuck on the waiting screen — nothing is actually in flight.
  setAuthUrlState(undefined);
}
if (window.location.pathname === '/auth' && (authPageParams.get('state') === 'add' || authPageParams.has('add'))) {
  const heading = authOptions?.querySelector<HTMLElement>('.auth-card__heading');
  if (heading) heading.textContent = 'Add an account';
  providerButtons.find((b) => !b.dataset.provider)?.click();
}

// Resolving the PDS and building the authorization URL can take a few seconds
// before the redirect actually fires — swap the card for a waiting state and
// mark the URL so the pause reads as intentional.
function setAuthUrlState(state: string | undefined) {
  const url = new URL(window.location.href);
  if (state) url.searchParams.set('state', state);
  else url.searchParams.delete('state');
  window.history.replaceState(null, '', url);
}

let authWaitingPreviousUrl: string | undefined;
function showAuthWaiting(detail: string) {
  if (!authWaiting) return;
  if (authWaitingDetail) authWaitingDetail.textContent = detail;
  authWaiting.hidden = false;
  authOptions?.classList.add('auth-card--waiting');
  if (authWaitingPreviousUrl === undefined) {
    authWaitingPreviousUrl = window.location.href;
    setAuthUrlState('waiting');
  }
}

function hideAuthWaiting() {
  if (!authWaiting) return;
  authWaiting.hidden = true;
  authOptions?.classList.remove('auth-card--waiting');
  if (authWaitingPreviousUrl !== undefined) {
    window.history.replaceState(null, '', authWaitingPreviousUrl);
    authWaitingPreviousUrl = undefined;
  }
}

authWaitingCancel?.addEventListener('click', hideAuthWaiting);

async function startOAuthSignIn(target: string, submit?: HTMLElement | null, isService = false) {
  if (submit) {
    submit.setAttribute('aria-busy', 'true');
  }
  const targetLabel = target.replace(/^https?:\/\//, '').replace(/^@/, '');
  showAuthWaiting(`Contacting ${targetLabel} — you'll finish signing in on your provider's site.`);
  try {
    // A bare service URL has no handle to check author status against.
    const scope = isService ? memberScope : await requestedScope(target);
    const activeClient = client;
    if (!activeClient) throw initializationError || new Error('OAuth client is unavailable.');
    const returnPath = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
    await activeClient.signInRedirect(target, { state: returnPath, scope });
  } catch (error) {
    hideAuthWaiting();
    showAuthError(errorMessage(error));
    if (submit) submit.removeAttribute('aria-busy');
  }
}

if (authForm) {
  // Picking a suggestion from the handle typeahead is confirmation enough —
  // jump straight into the OAuth redirect for that account.
  handleInput?.addEventListener('handle-selected', () => authForm.requestSubmit());
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAuthError();
    if (!client) {
      showAuthError(`Sign-in could not initialize: ${errorMessage(initializationError)}`);
      return;
    }

    const handle = new FormData(authForm).get('handle')?.toString().trim();
    if (!handle) return;
    const submit = authForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Connecting…';
    }
    await startOAuthSignIn(handle);
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Continue';
    }
  });
}

if (appPasswordForm) {
  appPasswordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearAuthError();
    const data = new FormData(appPasswordForm);
    const identifier = data.get('identifier')?.toString().trim();
    const password = data.get('password')?.toString() || '';
    if (!identifier || !password) return;

    const submit = appPasswordForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Signing in…';
    }
    try {
      await signInWithAppPassword(identifier, password);
      const returnPath = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
      window.location.assign(window.location.pathname === '/auth' ? returnPath : `${window.location.pathname}${window.location.search}${window.location.hash}`);
    } catch (error) {
      showAuthError(errorMessage(error));
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Sign in';
      }
    }
  });
}

signoutButton?.addEventListener('click', async () => {
  await oauthReady;
  if (!session) return;
  const signedOutDid = session.did;
  signoutButton.disabled = true;
  try {
    await session.signOut();
    forgetAccount(signedOutDid);
    setLastAuthMethod(undefined);
    const returnTo = safeReturnPath(`${window.location.pathname}${window.location.search}${window.location.hash}`);
    window.location.assign(`/auth?state=signed-out&returnTo=${encodeURIComponent(returnTo)}`);
  } catch (error) {
    showAuthError(`Could not sign out: ${errorMessage(error)}`);
    signoutButton.disabled = false;
  }
});

function requireSession() {
  if (!session) throw new Error('Sign in with your AT Protocol account to react.');
  return session;
}

async function repoRequest(path: string, body?: unknown) {
  const activeSession = requireSession();
  const response = await activeSession.fetchHandler(`/xrpc/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.ok) return response;
  const payload = await response.clone().json().catch(() => null) as { error?: string; message?: string } | null;
  if (response.status === 401 || response.status === 403) {
    throw new Error('Your account has not granted this permission yet. Sign out, then sign in again and approve the updated permissions.');
  }
  const detail = [payload?.error, payload?.message].filter(Boolean).join(': ');
  throw new Error(detail || `AT Protocol request failed (${response.status}).`);
}

async function readNotificationsMarker() {
  const activeSession = requireSession();
  const query = new URLSearchParams({
    repo: activeSession.did,
    collection: 'cc.coffeencode.notifications.read',
    rkey: 'self',
  });
  const response = await activeSession.fetchHandler(`/xrpc/com.atproto.repo.getRecord?${query.toString()}`);
  if (response.status === 404) return { exists: false, lastRead: undefined as string | undefined };
  if (response.status === 400) {
    const payload = await response.clone().json().catch(() => null) as { error?: string } | null;
    // PDS implementations commonly encode a missing record as the XRPC
    // RecordNotFound error with HTTP 400 instead of returning HTTP 404.
    if (payload?.error === 'RecordNotFound') return { exists: false, lastRead: undefined as string | undefined };
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('Your account needs notification read access. Sign out and sign in again to approve the updated permissions.');
    }
    throw new Error(`Could not load your notification read status (${response.status}).`);
  }
  const data = await response.json() as { value?: { lastRead?: unknown } };
  const lastRead = data.value?.lastRead;
  return {
    exists: true,
    lastRead: typeof lastRead === 'string' && Number.isFinite(Date.parse(lastRead)) ? lastRead : undefined,
  };
}

type NotificationItem = {
  uri: string;
  type: 'comment' | 'comment.reply' | 'comment.like' | 'post.like' | 'post.view' | 'followed.post';
  actorDid: string;
  actorName?: string;
  actorHandle?: string;
  actorAvatar?: string;
  subjectUri: string;
  documentUri: string;
  documentTitle: string;
  documentPath: string;
  createdAt?: string;
  text?: string;
  targetText?: string;
  matchedTags?: string[];
};

let notificationItems: NotificationItem[] = [];
let notificationLastRead: string | undefined;

async function markPageNotificationsRead() {
  const readStatus = notificationsPage?.querySelector<HTMLElement>('[data-notifications-read-status]');
  try {
    const lastRead = await window.coffeeAndCodeAuth?.markNotificationsRead();
    if (!lastRead) throw new Error('Could not save your notification read status.');
    notificationLastRead = lastRead;
    renderNotifications();
  } catch (error) {
    if (readStatus) readStatus.textContent = errorMessage(error);
  }
}

function unreadNotificationCount(items: NotificationItem[], lastRead?: string) {
  const cutoff = lastRead ? Date.parse(lastRead) : Number.NEGATIVE_INFINITY;
  return items.filter((item) => {
    const timestamp = typeof item.createdAt === 'string' ? Date.parse(item.createdAt) : Number.NaN;
    return !Number.isFinite(timestamp) || timestamp > cutoff;
  }).length;
}

function setNotificationBadgeCount(count: number) {
  notificationBadges.forEach((badge) => {
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.hidden = count < 1;
    const link = badge.closest<HTMLElement>('[data-notifications-link]');
    if (link) {
      const label = count > 0 ? `Notifications, ${count} unread` : 'Notifications';
      link.setAttribute('aria-label', label);
      link.setAttribute('title', label);
    }
  });
}

async function loadNotificationBadge(did: string) {
  if (notificationBadgeDid === did || notificationBadgeRequestDid === did) return;
  notificationBadgeRequestDid = did;
  try {
    const marker = await readNotificationsMarker();
    const query = new URLSearchParams({ did, count: '1' });
    if (marker.lastRead) query.set('lastRead', marker.lastRead);
    const response = await fetch(`/api/notifications?${query}`, {
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Could not load notification count (${response.status}).`);
    const data = await response.json() as { unreadCount?: unknown };
    if (typeof data.unreadCount !== 'number' || !Number.isInteger(data.unreadCount) || data.unreadCount < 0) {
      throw new Error('The notification count response was invalid.');
    }
    if (session?.did !== did || notificationBadgeRequestDid !== did) return;
    notificationBadgeDid = did;
    setNotificationBadgeCount(data.unreadCount);
  } catch (error) {
    console.error('Could not load unread notification count:', error);
  } finally {
    if (notificationBadgeRequestDid === did) notificationBadgeRequestDid = undefined;
  }
}

function renderNotifications() {
  if (!notificationsPage) return;
  const unreadList = notificationsPage.querySelector<HTMLUListElement>('[data-notifications-unread]');
  const readList = notificationsPage.querySelector<HTMLUListElement>('[data-notifications-read]');
  const unreadCount = notificationsPage.querySelector<HTMLElement>('[data-notifications-unread-count]');
  const readCount = notificationsPage.querySelector<HTMLElement>('[data-notifications-read-count]');
  const unreadEmpty = notificationsPage.querySelector<HTMLElement>('[data-notifications-unread-empty]');
  const readEmpty = notificationsPage.querySelector<HTMLElement>('[data-notifications-read-empty]');
  if (!unreadList || !readList || !unreadCount || !readCount || !unreadEmpty || !readEmpty) return;

  const cutoff = notificationLastRead ? Date.parse(notificationLastRead) : Number.NEGATIVE_INFINITY;
  const hasValidTime = (item: NotificationItem) => typeof item.createdAt === 'string' && Number.isFinite(Date.parse(item.createdAt));
  const unread = notificationItems.filter((item) => !hasValidTime(item) || Date.parse(item.createdAt!) > cutoff);
  const read = notificationItems.filter((item) => hasValidTime(item) && Date.parse(item.createdAt!) <= cutoff);

  const fillList = (list: HTMLUListElement, items: NotificationItem[]) => {
    const fragment = document.createDocumentFragment();
    items.forEach((item) => {
      const row = document.createElement('li');
      row.className = 'notification-item';
      const icon = document.createElement('span');
      icon.className = `notification-item__icon${item.type.includes('like') ? ' notification-item__icon--like' : ''}`;
      icon.setAttribute('aria-hidden', 'true');
      const iconGlyph = document.createElement('i');
      iconGlyph.className = item.type.includes('like')
        ? 'fa-solid fa-heart'
        : item.type === 'post.view'
          ? 'fa-regular fa-eye'
          : item.type === 'followed.post'
            ? 'fa-regular fa-newspaper'
            : 'fa-regular fa-comment';
      icon.appendChild(iconGlyph);
      row.appendChild(icon);

      if (item.actorAvatar) {
        const avatar = document.createElement('img');
        avatar.className = 'notification-item__avatar';
        avatar.src = item.actorAvatar;
        avatar.alt = '';
        avatar.width = 40;
        avatar.height = 40;
        avatar.loading = 'lazy';
        row.appendChild(avatar);
      } else {
        const placeholder = document.createElement('span');
        placeholder.className = 'notification-item__avatar notification-item__avatar--placeholder';
        placeholder.setAttribute('aria-hidden', 'true');
        placeholder.innerHTML = '<i class="fa-solid fa-user"></i>';
        row.appendChild(placeholder);
      }

      const content = document.createElement('div');
      content.className = 'notification-item__content';
      const summary = document.createElement('p');
      summary.className = 'notification-item__summary';
      const actor = document.createElement('a');
      actor.href = `/user/${encodeURIComponent(item.actorDid)}`;
      actor.className = 'notification-item__actor';
      actor.textContent = item.actorName || item.actorHandle || item.actorDid;
      summary.appendChild(actor);
      const story = document.createElement('a');
      story.className = 'notification-item__story';
      story.href = item.documentPath.startsWith('/') && !item.documentPath.startsWith('//') ? item.documentPath : '/';
      story.textContent = item.documentTitle || 'a story';
      const action = item.type === 'comment.like'
        ? ' likes your reply'
        : item.type === 'post.like'
          ? ' likes your post'
          : item.type === 'post.view'
            ? ' viewed your story'
            : item.type === 'followed.post'
              ? ' published a new post: '
            : item.type === 'comment.reply'
              ? ' Replied to you'
              : item.type === 'comment'
                ? ' Replied to '
                : ' commented on ';
      summary.appendChild(document.createTextNode(action));
      if (['comment', 'post.like', 'post.view', 'followed.post'].includes(item.type)) summary.appendChild(story);
      if (item.type === 'followed.post' && item.matchedTags?.length) {
          summary.appendChild(document.createTextNode(` tagged ${item.matchedTags.map((tag) => `#${tag}`).join(', ')}`));
      }
      content.appendChild(summary);
      const quoteText = item.type === 'comment.like' ? item.targetText : item.text;
      if (quoteText) {
        const quote = document.createElement('blockquote');
        quote.className = 'notification-item__text';
        quote.textContent = `“${quoteText}”`;
        content.appendChild(quote);
      }
      if (item.createdAt) {
        const time = document.createElement('time');
        time.dateTime = item.createdAt;
        time.textContent = relativeNotificationTime(item.createdAt);
        content.appendChild(time);
      }
      row.appendChild(content);
      fragment.appendChild(row);
    });
    list.replaceChildren(fragment);
  };

  fillList(unreadList, unread);
  fillList(readList, read);
  unreadCount.textContent = String(unread.length);
  readCount.textContent = String(read.length);
  unreadEmpty.hidden = unread.length > 0;
  readEmpty.hidden = read.length > 0;
  const readStatus = notificationsPage.querySelector<HTMLElement>('[data-notifications-read-status]');
  if (readStatus) readStatus.textContent = notificationLastRead
    ? `Last read ${new Date(notificationLastRead).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}.`
    : 'These notifications have not been marked read yet.';
  setNotificationBadgeCount(unread.length);
}

async function loadNotificationsPage(refresh = true) {
  if (!notificationsPage || !notificationsStatus || !notificationsInbox) return;
  window.clearTimeout(notificationsAutoReadTimer);
  notificationsAutoReadTimer = undefined;
  notificationsInbox.hidden = true;
  notificationsStatus.hidden = false;
  notificationsStatus.textContent = 'Loading notifications…';
  if (!session) {
    window.location.assign(`/auth?returnTo=${encodeURIComponent('/notifications')}`);
    return;
  }
  try {
    const did = session.did;
    const [response, marker] = await Promise.all([
      fetch(`/api/notifications?limit=30&did=${encodeURIComponent(did)}${refresh ? '&refresh=1' : ''}`, {
        cache: 'no-store',
      }),
      readNotificationsMarker(),
    ]);
    if (session?.did !== did) return;
    if (!response.ok) throw new Error('Notifications are temporarily unavailable. Please try again shortly.');
    const data = await response.json() as { notifications?: NotificationItem[] };
    notificationItems = Array.isArray(data.notifications) ? data.notifications : [];
    notificationLastRead = marker.lastRead;
    notificationBadgeDid = did;
    renderNotifications();
    notificationsStatus.hidden = true;
    notificationsInbox.hidden = false;
    if (unreadNotificationCount(notificationItems, notificationLastRead) > 0) {
      notificationsAutoReadTimer = window.setTimeout(() => {
        notificationsAutoReadTimer = undefined;
        if (session?.did === did) void markPageNotificationsRead();
      }, 5000);
    }
  } catch (error) {
    notificationsStatus.textContent = errorMessage(error);
  }
}

notificationsRefresh?.addEventListener('click', async () => {
  if (!notificationsRefresh) return;
  notificationsRefresh.disabled = true;
  notificationsRefresh.textContent = 'Refreshing…';
  try {
    await loadNotificationsPage(true);
  } finally {
    notificationsRefresh.disabled = false;
    notificationsRefresh.textContent = 'Refresh';
  }
});

function relativeNotificationTime(value: string) {
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000));
  if (elapsedSeconds < 60) return 'now';
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m`;
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)}h`;
  if (elapsedSeconds < 604800) return `${Math.floor(elapsedSeconds / 86400)}d`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function recordKey(document: string, prefix = 'post') {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(document));
  return `${prefix}-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function getOwnRecords(document: string, did: string) {
  const response = await fetch(`/api/reactions?subject=${encodeURIComponent(document)}&did=${encodeURIComponent(did)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load your reaction state.');
  return await response.json() as { liked: boolean; disliked: boolean; recommended: boolean; saved: boolean };
}

type OwnRepoRecord = { uri: string; value: Record<string, unknown> };

async function findOwnRepoRecord(collection: string, field: string, target: string, did: string): Promise<OwnRepoRecord | undefined> {
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const query = new URLSearchParams({ repo: did, collection, limit: '100' });
    if (cursor) query.set('cursor', cursor);
    const response = await repoRequest(`com.atproto.repo.listRecords?${query}`);
    const payload = await response.json() as {
      records?: Array<{ uri?: unknown; value?: unknown }>;
      cursor?: unknown;
    };
    const found = (payload.records || []).find((record) => typeof record.uri === 'string'
      && typeof record.value === 'object'
      && record.value !== null
      && !Array.isArray(record.value)
      && (record.value as Record<string, unknown>)[field] === target);
    if (found && typeof found.uri === 'string' && typeof found.value === 'object'
      && found.value !== null && !Array.isArray(found.value)) {
      return { uri: found.uri, value: found.value as Record<string, unknown> };
    }
    if (typeof payload.cursor !== 'string' || !payload.cursor || seenCursors.has(payload.cursor)) return undefined;
    cursor = payload.cursor;
    seenCursors.add(cursor);
  } while (cursor);
  return undefined;
}

function recordKeyFromUri(uri: string) {
  const match = uri.match(/^at:\/\/[^/]+\/[^/]+\/([a-zA-Z0-9._~:-]+)$/);
  if (!match) throw new Error('The account provider returned an invalid repository record URI.');
  return match[1];
}

function createTid() {
  const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
  const timestampMicros = BigInt(Date.now()) * 1000n;
  const clockId = BigInt(crypto.getRandomValues(new Uint16Array(1))[0] & 0x03ff);
  let value = (timestampMicros << 10n) | clockId;
  let tid = '';
  for (let index = 0; index < 13; index += 1) {
    tid = alphabet[Number(value & 31n)] + tid;
    value >>= 5n;
  }
  return tid;
}

async function blockUser(did: string, alsoOnBluesky: boolean) {
  const activeSession = requireSession();
  if (!validBlockDid(did) || did === activeSession.did) throw new Error('Choose a valid account to block.');
  const current = await loadUserBlocks(activeSession.did);
  if (session?.did !== activeSession.did) throw new Error('Your signed-in account changed. Please try again.');
  const existing = current.find((record) => record.subject === did);
  if (!existing) {
    const collection = blockCollection;
    const rkey = createTid();
    const createdAt = new Date().toISOString();
    await repoRequest('com.atproto.repo.createRecord', {
      repo: activeSession.did,
      collection,
      rkey,
      record: { $type: collection, subject: did, createdAt },
    });
    blockedRecords = [...current, {
      uri: `at://${activeSession.did}/${collection}/${rkey}`,
      rkey,
      subject: did,
      createdAt,
    }];
  } else {
    blockedRecords = current;
  }
  blockedRecordsDid = activeSession.did;
  blockedRecordsPromise = Promise.resolve(blockedRecords);
  applyBlockedUserFilter(new Set(blockedRecords.map((record) => record.subject)));
  void renderBlockManager(activeSession.did);
  if (alsoOnBluesky) {
    try {
      const existing = await findOwnRepoRecord('app.bsky.graph.block', 'subject', did, activeSession.did);
      if (!existing) {
        const collection = 'app.bsky.graph.block';
        await repoRequest('com.atproto.repo.createRecord', {
          repo: activeSession.did,
          collection,
          rkey: createTid(),
          record: { $type: collection, subject: did, createdAt: new Date().toISOString() },
        });
      }
    } catch (error) {
      throw new Error(`This account is blocked on Coffee & Code, but its Bluesky block could not be saved: ${errorMessage(error)}`);
    }
  }
}

async function unblockUser(did: string) {
  const activeSession = requireSession();
  if (!validBlockDid(did) || did === activeSession.did) throw new Error('Choose a valid account to unblock.');
  const record = (await loadUserBlocks(activeSession.did)).find((item) => item.subject === did);
  if (!record) return;
  await repoRequest('com.atproto.repo.deleteRecord', {
    repo: activeSession.did,
    collection: blockCollection,
    rkey: record.rkey,
  });
  blockedRecords = blockedRecords.filter((item) => item.subject !== did);
  blockedRecordsPromise = Promise.resolve(blockedRecords);
  applyBlockedUserFilter(new Set(blockedRecords.map((item) => item.subject)));
}

async function createFollowRecord(collection: string, record: Record<string, unknown>, did: string) {
  const response = await repoRequest('com.atproto.repo.createRecord', { repo: did, collection, record });
  const result = await response.json() as { uri?: unknown };
  if (typeof result.uri !== 'string') throw new Error('The account provider did not return the new follow record URI.');
  return result.uri;
}

async function deleteFollowRecord(collection: string, uri: string, did: string) {
  await repoRequest('com.atproto.repo.deleteRecord', { repo: did, collection, rkey: recordKeyFromUri(uri) });
}

document.querySelectorAll<HTMLElement>('[data-tag-follow]').forEach((container) => {
  const button = container.querySelector<HTMLButtonElement>('[data-tag-follow-button]');
  const status = container.querySelector<HTMLElement>('[data-tag-follow-status]');
  const tag = container.dataset.tag?.trim().toLocaleLowerCase();
  const collection = 'cc.coffeencode.tag.follow';
  if (!button || !tag) return;

  let followRecord: OwnRepoRecord | undefined;
  button.disabled = true;
  const renderFollowState = () => {
    const followed = Boolean(followRecord);
    button.textContent = followed ? 'Following tag' : 'Follow tag';
    button.setAttribute('aria-pressed', String(followed));
  };
  const loadFollowState = async () => {
    await oauthReady;
    if (!session) {
      if (status) status.textContent = 'Sign in to follow this tag.';
      return;
    }
    const activeDid = session.did;
    const nextFollow = await findOwnRepoRecord(collection, 'tag', tag, activeDid);
    if (session?.did !== activeDid) return;
    followRecord = nextFollow;
    renderFollowState();
    if (status) status.textContent = '';
  };

  void loadFollowState().catch((error) => {
    console.error('Could not load tag follow state:', error);
    if (status) status.textContent = error instanceof Error ? error.message : 'Could not load follow status.';
  }).finally(() => {
    button.disabled = false;
  });

  button.addEventListener('click', async () => {
    await oauthReady;
    if (!session) {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/auth?returnTo=${encodeURIComponent(safeReturnPath(currentPath))}`);
      return;
    }
    const activeDid = session.did;
    button.disabled = true;
    if (status) status.textContent = 'Updating your follows…';
    try {
      if (followRecord) {
        await deleteFollowRecord(collection, followRecord.uri, activeDid);
      } else {
        await createFollowRecord(collection, {
          $type: collection,
          tag,
          createdAt: new Date().toISOString(),
        }, activeDid);
      }
      await loadFollowState();
      if (status) status.textContent = followRecord ? 'Following this tag.' : 'Unfollowed this tag.';
    } catch (error) {
      if (status) status.textContent = errorMessage(error);
    } finally {
      button.disabled = false;
    }
  });
});

const unfollowDialog = document.querySelector<HTMLDialogElement>('[data-unfollow-dialog]');
const unfollowDialogTitle = unfollowDialog?.querySelector<HTMLElement>('[data-unfollow-dialog-title]');
const unfollowDialogStatus = unfollowDialog?.querySelector<HTMLElement>('[data-unfollow-dialog-status]');
const unfollowOnBluesky = unfollowDialog?.querySelector<HTMLInputElement>('[data-unfollow-on-bluesky]');
const confirmUnfollowButton = unfollowDialog?.querySelector<HTMLButtonElement>('[data-confirm-unfollow]');
const cancelUnfollowButton = unfollowDialog?.querySelector<HTMLButtonElement>('[data-cancel-unfollow]');

// Resolves 'both' (also unfollow on Bluesky), 'site' (Coffee & Code only), or
// null when the user cancels. Without the dialog in the DOM, keep the old
// behavior and unfollow on both.
function promptAuthorUnfollow(name: string): Promise<'both' | 'site' | null> {
  if (!unfollowDialog) return Promise.resolve('both');
  return new Promise((resolve) => {
    let settled = false;
    const done = (choice: 'both' | 'site' | null) => {
      if (settled) return;
      settled = true;
      confirmUnfollowButton?.removeEventListener('click', onConfirm);
      cancelUnfollowButton?.removeEventListener('click', onCancel);
      unfollowDialog.removeEventListener('cancel', onEscape);
      resolve(choice);
    };
    const onConfirm = () => {
      const alsoOnBluesky = Boolean(unfollowOnBluesky?.checked);
      unfollowDialog.close();
      done(alsoOnBluesky ? 'both' : 'site');
    };
    const onCancel = () => { unfollowDialog.close(); done(null); };
    const onEscape = () => { done(null); };
    if (unfollowDialogTitle) unfollowDialogTitle.textContent = `Unfollow ${name}?`;
    if (unfollowDialogStatus) unfollowDialogStatus.textContent = '';
    if (unfollowOnBluesky) unfollowOnBluesky.checked = true;
    confirmUnfollowButton?.addEventListener('click', onConfirm);
    cancelUnfollowButton?.addEventListener('click', onCancel);
    unfollowDialog.addEventListener('cancel', onEscape);
    unfollowDialog.showModal();
  });
}

// Germ DM buttons — the profile owner's com.germnetwork.declaration record
// says who may message them ("everyone" or only accounts they follow). For
// "usersIFollow" we check the owner's Bluesky graph for a follow of the
// signed-in viewer, then complete the messageMeUrl with [subject]+[viewer]
// DIDs in the fragment per the Germ spec (plus the "web" platform hint).
document.querySelectorAll<HTMLAnchorElement>('[data-germ-dm]').forEach((link) => {
  const subjectDid = link.dataset.germDid || '';
  if (!subjectDid) return;
  void (async () => {
    try {
      const response = await fetch(`/api/germ/declaration?did=${encodeURIComponent(subjectDid)}`, { cache: 'no-store' });
      if (!response.ok) return;
      const info = await response.json() as { available?: unknown; showButtonTo?: unknown; messageMeUrl?: unknown };
      if (!info.available || typeof info.messageMeUrl !== 'string' || typeof info.showButtonTo !== 'string') return;

      await oauthReady;
      const viewerDid = session?.did;
      if (viewerDid === subjectDid) return; // No DM button on your own profile.
      if (info.showButtonTo === 'none') return;
      if (info.showButtonTo === 'usersIFollow') {
        // Only people the profile owner follows may DM them. The public
        // Bluesky appview exposes the relationship check; signed-out viewers
        // can't prove a follow, so the button stays hidden.
        if (!viewerDid || viewerDid === subjectDid) return;
        let follows = false;
        try {
          const rel = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.graph.getRelationships?actor=${encodeURIComponent(subjectDid)}&others=${encodeURIComponent(viewerDid)}`);
          if (!rel.ok) return;
          const payload = await rel.json() as { relationships?: Array<{ did?: unknown; following?: unknown }> };
          const entry = Array.isArray(payload.relationships)
            ? payload.relationships.find((item) => item.did === viewerDid) || payload.relationships[0]
            : undefined;
          follows = Boolean(entry?.following);
        } catch {
          return;
        }
        if (!follows) return;
      }

      const url = new URL(info.messageMeUrl);
      if (!/^https?:$/.test(url.protocol)) return;
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/web`;
      url.hash = viewerDid ? `${subjectDid}+${viewerDid}` : subjectDid;
      link.href = url.toString();
      link.hidden = false;
    } catch { /* No declaration record or unreachable PDS — no button. */ }
  })();
});

document.querySelectorAll<HTMLElement>('[data-author-follow]').forEach((container) => {
  const button = container.querySelector<HTMLButtonElement>('[data-author-follow-button]');
  const status = container.querySelector<HTMLElement>('[data-author-follow-status]');
  const did = container.dataset.authorDid;
  const authorName = container.dataset.authorName || 'this author';
  const publication = container.dataset.publicationUri;
  const followCollection = 'app.bsky.graph.follow';
  const subscriptionCollection = 'site.standard.graph.subscription';
  if (!button || !did || !publication) return;

  let followRecord: OwnRepoRecord | undefined;
  let subscriptionRecord: OwnRepoRecord | undefined;
  let followStateReady = false;
  button.disabled = true;
  const renderFollowState = () => {
    const followed = Boolean(followRecord && subscriptionRecord);
    button.textContent = followed ? 'Following' : 'Follow';
    button.setAttribute('aria-pressed', String(followed));
  };
  const loadFollowState = async () => {
    await oauthReady;
    if (!session) {
      followStateReady = true;
      if (status) status.textContent = 'Sign in to follow this author on Bluesky and Coffee & Code.';
      return;
    }
    const activeDid = session.did;
    const [nextFollow, nextSubscription] = await Promise.all([
      findOwnRepoRecord(followCollection, 'subject', did, activeDid),
      findOwnRepoRecord(subscriptionCollection, 'publication', publication, activeDid),
    ]);
    if (session?.did !== activeDid) return;
    followRecord = nextFollow;
    subscriptionRecord = nextSubscription;
    followStateReady = true;
    renderFollowState();
    if (status) status.textContent = '';
  };

  void loadFollowState().catch((error) => {
    console.error('Could not load author follow state:', error);
    if (status) status.textContent = error instanceof Error ? error.message : 'Could not load follow status.';
  }).finally(() => {
    button.disabled = false;
  });

  button.addEventListener('click', async () => {
    await oauthReady;
    if (!session) {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/auth?returnTo=${encodeURIComponent(safeReturnPath(currentPath))}`);
      return;
    }
    if (!followStateReady) {
      button.disabled = true;
      if (status) status.textContent = 'Checking your current follow status…';
      try {
        await loadFollowState();
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : 'Could not check your follow status.';
        return;
      } finally {
        button.disabled = false;
      }
    }
    const activeDid = session.did;
    button.disabled = true;
    if (status) status.textContent = 'Updating your follows…';
    const shouldFollow = !(followRecord && subscriptionRecord);
    let unfollowedOnBluesky = false;
    const compensations: Array<() => Promise<void>> = [];
    try {
      if (shouldFollow) {
        if (!followRecord) {
          const uri = await createFollowRecord(followCollection, {
            $type: followCollection,
            subject: did,
            createdAt: new Date().toISOString(),
          }, activeDid);
          compensations.push(() => deleteFollowRecord(followCollection, uri, activeDid));
        }
        if (!subscriptionRecord) {
          const uri = await createFollowRecord(subscriptionCollection, {
            $type: subscriptionCollection,
            publication,
          }, activeDid);
          compensations.push(() => deleteFollowRecord(subscriptionCollection, uri, activeDid));
        }
      } else {
        const unfollowScope = await promptAuthorUnfollow(authorName);
        if (!unfollowScope) {
          if (status) status.textContent = '';
          return;
        }
        const oldSubscription = subscriptionRecord!;
        await deleteFollowRecord(subscriptionCollection, oldSubscription.uri, activeDid);
        compensations.push(async () => {
          await createFollowRecord(subscriptionCollection, {
            ...oldSubscription.value,
            $type: subscriptionCollection,
          }, activeDid);
        });
        if (unfollowScope === 'both' && followRecord) {
          const oldFollow = followRecord;
          await deleteFollowRecord(followCollection, oldFollow.uri, activeDid);
          compensations.push(async () => {
            await createFollowRecord(followCollection, {
              ...oldFollow.value,
              $type: followCollection,
            }, activeDid);
          });
        }
        unfollowedOnBluesky = unfollowScope === 'both';
      }

      await loadFollowState();
      if (status) status.textContent = shouldFollow
        ? 'Following on Bluesky and Coffee & Code.'
        : unfollowedOnBluesky
          ? 'Unfollowed on Bluesky and Coffee & Code.'
          : 'Unfollowed on Coffee & Code; still following on Bluesky.';
    } catch (error) {
      const rollbackErrors: unknown[] = [];
      for (const compensate of compensations.reverse()) {
        try {
          await compensate();
        } catch (rollbackError) {
          rollbackErrors.push(rollbackError);
        }
      }
      try {
        await loadFollowState();
      } catch (refreshError) {
        followStateReady = false;
        rollbackErrors.push(refreshError);
      }
      const message = error instanceof Error ? error.message : 'Could not update your follow.';
      if (status) {
        status.textContent = rollbackErrors.length
          ? `${message} The follow records may be out of sync; refresh and check your account.`
          : message;
      }
    } finally {
      button.disabled = false;
    }
  });
});

// Standalone publication subscribe: writes only a site.standard.graph.subscription
// record, without the Bluesky follow the author follow button bundles in.
document.querySelectorAll<HTMLElement>('[data-publication-subscribe]').forEach((container) => {
  const button = container.querySelector<HTMLButtonElement>('[data-publication-subscribe-button]');
  const status = container.querySelector<HTMLElement>('[data-publication-subscribe-status]');
  const publication = container.dataset.publicationUri;
  if (!button || !publication) return;

  let subscriptionRecord: OwnRepoRecord | undefined;
  let subscribeStateReady = false;
  button.disabled = true;
  const renderSubscribeState = () => {
    const subscribed = Boolean(subscriptionRecord);
    button.textContent = subscribed ? 'Subscribed' : 'Subscribe';
    button.setAttribute('aria-pressed', String(subscribed));
  };
  const loadSubscribeState = async () => {
    await oauthReady;
    if (!session) {
      subscribeStateReady = true;
      if (status) status.textContent = 'Sign in to subscribe to this publication.';
      return;
    }
    const activeDid = session.did;
    const next = await findOwnRepoRecord(subscriptionCollection, 'publication', publication, activeDid);
    if (session?.did !== activeDid) return;
    subscriptionRecord = next;
    subscribeStateReady = true;
    renderSubscribeState();
    if (status) status.textContent = '';
  };

  void loadSubscribeState().catch((error) => {
    console.error('Could not load publication subscription state:', error);
    if (status) status.textContent = error instanceof Error ? error.message : 'Could not load subscription status.';
  }).finally(() => {
    button.disabled = false;
  });

  button.addEventListener('click', async () => {
    await oauthReady;
    if (!session) {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/auth?returnTo=${encodeURIComponent(safeReturnPath(currentPath))}`);
      return;
    }
    if (!subscribeStateReady) {
      button.disabled = true;
      if (status) status.textContent = 'Checking your subscription status…';
      try {
        await loadSubscribeState();
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : 'Could not check your subscription status.';
        return;
      } finally {
        button.disabled = false;
      }
    }
    const activeDid = session.did;
    button.disabled = true;
    const shouldSubscribe = !subscriptionRecord;
    if (status) status.textContent = shouldSubscribe ? 'Subscribing…' : 'Unsubscribing…';
    try {
      if (shouldSubscribe) {
        await createFollowRecord(subscriptionCollection, {
          $type: subscriptionCollection,
          publication,
        }, activeDid);
      } else if (subscriptionRecord) {
        await deleteFollowRecord(subscriptionCollection, subscriptionRecord.uri, activeDid);
      }
      await loadSubscribeState();
      if (status) status.textContent = shouldSubscribe
        ? 'Subscribed to this publication.'
        : 'Unsubscribed from this publication.';
    } catch (error) {
      try {
        await loadSubscribeState();
      } catch { /* Keep the stale state; the error message below explains. */ }
      if (status) status.textContent = error instanceof Error ? error.message : 'Could not update your subscription.';
    } finally {
      button.disabled = false;
    }
  });
});

document.querySelectorAll<HTMLElement>('[data-view-subject]').forEach((container) => {
  const documentUri = container.dataset.viewSubject;
  if (!documentUri) return;

  void (async () => {
    await oauthReady;
    if (!session) return;
    await repoRequest('com.atproto.repo.createRecord', {
      repo: session.did,
      collection: 'cc.coffeencode.interact.view',
      record: {
        $type: 'cc.coffeencode.interact.view',
        document: documentUri,
        createdAt: new Date().toISOString(),
      },
    });

    window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/reactions?subject=${encodeURIComponent(documentUri)}&_=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) return;
        const counts = await response.json() as { views: number };
        const viewCount = container.querySelector<HTMLElement>('[data-at-view-count]');
        if (viewCount) viewCount.textContent = Number(counts.views || 0).toLocaleString();
      } catch {
        // The normal count loader will retry on the next page view.
      }
    }, 2000);
  })().catch((error) => {
    const status = container.querySelector<HTMLElement>('.article-reactions__status');
    if (status) status.textContent = errorMessage(error);
  });
});

document.querySelectorAll<HTMLElement>('[data-reaction-subject]').forEach((container) => {
  const documentUri = container.dataset.reactionSubject;
  const status = container.querySelector<HTMLElement>('.article-reactions__status');
  if (!documentUri) return;

  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-reaction]'));
  const collections = {
    like: 'cc.coffeencode.interact.like',
    dislike: 'cc.coffeencode.interact.dislike',
  } as const;
  let reactionActionVersion = 0;

  const setReactionActive = (target: HTMLButtonElement | null | undefined, active: boolean) => {
    if (!target) return;
    target.setAttribute('aria-pressed', String(active));
    const icon = target.querySelector('i');
    if (icon) {
      icon.classList.toggle('fa-solid', active);
      icon.classList.toggle('fa-regular', !active);
    }
  };

  const refreshReactionState = async () => {
    await oauthReady;
    if (!session) return;
    const version = reactionActionVersion;
    const state = await getOwnRecords(documentUri, session.did);
    if (version !== reactionActionVersion) return;
    setReactionActive(container.querySelector<HTMLButtonElement>('[data-reaction="like"]'), state.liked);
    setReactionActive(container.querySelector<HTMLButtonElement>('[data-reaction="dislike"]'), state.disliked);
  };

  const readReactionCount = (reaction: 'like' | 'dislike') => {
    const count = container.querySelector<HTMLElement>(`[data-reaction-count="${reaction}"]`);
    const value = count?.textContent?.replace(/,/g, '').trim() || '';
    return /^\d+$/.test(value) ? Number(value) : undefined;
  };
  const writeReactionCount = (reaction: 'like' | 'dislike', value: number) => {
    const count = container.querySelector<HTMLElement>(`[data-reaction-count="${reaction}"]`);
    if (count) count.textContent = Math.max(0, value).toLocaleString();
  };
  const refreshReactionCounts = async (before: { like?: number; dislike?: number }, delta: { like: number; dislike: number }, version: number) => {
    const delays = [1200, 1800, 2600, 4000, 6000];
    for (const delay of delays) {
      await new Promise((resolve) => window.setTimeout(resolve, delay));
      if (version !== reactionActionVersion) return;
      try {
        const response = await fetch(`/api/reactions?subject=${encodeURIComponent(documentUri)}&_=${Date.now()}`, { cache: 'no-store' });
        if (!response.ok) continue;
        const counts = await response.json() as { likes?: number; dislikes?: number };
        const observed = { like: Number(counts.likes), dislike: Number(counts.dislikes) };
        const baselines = { like: before.like, dislike: before.dislike };
        const deltas = { like: delta.like, dislike: delta.dislike };
        const indexed = (['like', 'dislike'] as const).every((reaction) => {
          const baseline = baselines[reaction];
          const change = deltas[reaction];
          const value = observed[reaction];
          if (!Number.isFinite(value)) return false;
          if (baseline === undefined || change === 0) return true;
          return change > 0 ? value >= baseline + change : value < baseline;
        });
        if (!indexed) continue;
        writeReactionCount('like', observed.like);
        writeReactionCount('dislike', observed.dislike);
        return;
      } catch { /* Keep the optimistic count if the index is temporarily unavailable. */ }
    }
  };

  void refreshReactionState().catch((error) => {
    if (status) status.textContent = errorMessage(error);
  });

  buttons.forEach((button) => button.addEventListener('click', async () => {
    await oauthReady;
    if (!session) {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/auth?returnTo=${encodeURIComponent(safeReturnPath(currentPath))}`);
      return;
    }

    const kind = button.dataset.reaction as keyof typeof collections;
    if (!(kind in collections)) return;
    const opposite = kind === 'like' ? 'dislike' : 'like';
    const activeSession = session;
    const actionVersion = ++reactionActionVersion;

    const oppositeButton = container.querySelector<HTMLButtonElement>(`[data-reaction="${opposite}"]`);
    const wasSelected = button.getAttribute('aria-pressed') === 'true';
    const oppositeSelected = !wasSelected && oppositeButton?.getAttribute('aria-pressed') === 'true';
    const nowSelected = !wasSelected;
    const beforeCounts = { like: readReactionCount('like'), dislike: readReactionCount('dislike') };
    const delta = { like: 0, dislike: 0 };
    delta[kind] = nowSelected ? 1 : -1;
    if (oppositeSelected) delta[opposite] = -1;

    // Optimistic update: show the reaction and count immediately so the
    // interface feels instant. The record is written in the background and
    // the change is silently reverted if that write fails.
    setReactionActive(button, nowSelected);
    if (oppositeSelected) setReactionActive(oppositeButton, false);
    if (beforeCounts.like !== undefined) writeReactionCount('like', beforeCounts.like + delta.like);
    if (beforeCounts.dislike !== undefined) writeReactionCount('dislike', beforeCounts.dislike + delta.dislike);
    if (status) {
      status.textContent = nowSelected
        ? kind === 'like' ? 'You liked this post.' : 'You disliked this post.'
        : `Your ${kind} was removed.`;
    }

    void (async () => {
      const rkey = await recordKey(documentUri);
      const createdAt = new Date().toISOString();
      if (!nowSelected) {
        await repoRequest('com.atproto.repo.deleteRecord', {
          repo: activeSession.did,
          collection: collections[kind],
          rkey,
        });
        return;
      }
      await repoRequest('com.atproto.repo.putRecord', {
        repo: activeSession.did,
        collection: collections[kind],
        rkey,
        record: { $type: collections[kind], document: documentUri, createdAt },
      });
      if (oppositeSelected) {
        await repoRequest('com.atproto.repo.deleteRecord', {
          repo: activeSession.did,
          collection: collections[opposite],
          rkey,
        });
      }
      if (kind === 'like') {
        try {
          const recommendationCollection = 'site.standard.graph.recommend';
          const current = await getOwnRecords(documentUri, activeSession.did);
          if (!current.recommended) {
            await repoRequest('com.atproto.repo.putRecord', {
              repo: activeSession.did,
              collection: recommendationCollection,
              rkey,
              record: {
                $type: recommendationCollection,
                document: documentUri,
                createdAt,
              },
            });
          }
        } catch (error) {
          // Recommendations are optional. The like itself has already been
          // saved, so this must not make the like appear to have failed.
          console.warn('Could not create an optional post recommendation:', error);
        }
      }
    })().then(() => {
      if (actionVersion !== reactionActionVersion) return;
      void refreshReactionCounts(beforeCounts, delta, actionVersion);
    }).catch(() => {
      // The write failed: silently restore the previous button and counts.
      if (actionVersion !== reactionActionVersion) return;
      setReactionActive(button, wasSelected);
      if (oppositeSelected) setReactionActive(oppositeButton, true);
      if (beforeCounts.like !== undefined) writeReactionCount('like', beforeCounts.like);
      if (beforeCounts.dislike !== undefined) writeReactionCount('dislike', beforeCounts.dislike);
      if (status) status.textContent = '';
    });
  }));
});

document.querySelectorAll<HTMLButtonElement>('[data-reaction-subject] [data-save-post]').forEach((button) => {
  const container = button.closest<HTMLElement>('[data-reaction-subject]');
  const documentUri = container?.dataset.reactionSubject;
  const status = container?.querySelector<HTMLElement>('.article-reactions__status');
  if (!container || !documentUri) return;
  const updateCount = (count: number) => {
    const countNode = button.querySelector<HTMLElement>('[data-save-count]');
    if (countNode) countNode.textContent = Math.max(0, count).toLocaleString();
  };
  const readCount = () => {
    const value = button.querySelector<HTMLElement>('[data-save-count]')?.textContent?.replace(/,/g, '').trim() || '';
    return /^\d+$/.test(value) ? Number(value) : undefined;
  };

  void (async () => {
    await oauthReady;
    if (!session) return;
    const state = await getOwnRecords(documentUri, session.did);
    button.setAttribute('aria-pressed', String(state.saved));
    button.querySelector('i')?.classList.replace('fa-regular', state.saved ? 'fa-solid' : 'fa-regular');
    const label = button.childNodes[1];
    if (label) label.textContent = state.saved ? ' Saved ' : ' Save ';
  })().catch((error) => { if (status) status.textContent = errorMessage(error); });

  const renderSaved = (saved: boolean) => {
    button.setAttribute('aria-pressed', String(saved));
    button.querySelector('i')?.classList.replace(saved ? 'fa-regular' : 'fa-solid', saved ? 'fa-solid' : 'fa-regular');
    const label = button.childNodes[1];
    if (label) label.textContent = saved ? ' Saved ' : ' Save ';
  };

  let saveActionVersion = 0;
  button.addEventListener('click', async () => {
    await oauthReady;
    if (!session) {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/auth?returnTo=${encodeURIComponent(safeReturnPath(currentPath))}`);
      return;
    }
    const activeSession = session;
    const actionVersion = ++saveActionVersion;
    const wasSaved = button.getAttribute('aria-pressed') === 'true';
    const saved = !wasSaved;
    const beforeCount = readCount();

    // Optimistic update: show the saved state and bump the count right away,
    // then create or remove the record in the background. On failure, the
    // change is silently reverted.
    renderSaved(saved);
    if (beforeCount !== undefined) updateCount(beforeCount + (saved ? 1 : -1));
    if (status) status.textContent = saved ? 'Story saved to your account.' : 'Story removed from your saved posts.';

    void (async () => {
      const rkey = await recordKey(documentUri);
      if (wasSaved) {
        await repoRequest('com.atproto.repo.deleteRecord', { repo: activeSession.did, collection: 'cc.coffeencode.save', rkey });
      } else {
        await repoRequest('com.atproto.repo.putRecord', {
          repo: activeSession.did,
          collection: 'cc.coffeencode.save',
          rkey,
          record: { $type: 'cc.coffeencode.save', target: { document: documentUri }, createdAt: new Date().toISOString() },
        });
      }
    })().then(() => {
      if (actionVersion !== saveActionVersion || beforeCount === undefined) return;
      void (async () => {
        for (const delay of [1200, 1800, 2600, 4000, 6000]) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          if (actionVersion !== saveActionVersion) return;
          try {
            const response = await fetch(`/api/reactions?subject=${encodeURIComponent(documentUri)}&_=${Date.now()}`, { cache: 'no-store' });
            if (!response.ok) continue;
            const counts = await response.json() as { saves?: number };
            if (Number.isFinite(counts.saves) && (saved ? Number(counts.saves) >= beforeCount + 1 : Number(counts.saves) < beforeCount)) {
              updateCount(Number(counts.saves));
              break;
            }
          } catch { /* Keep the optimistic count if the index is temporarily unavailable. */ }
        }
      })();
    }).catch(() => {
      // The write failed: silently restore the previous icon, label, and count.
      if (actionVersion !== saveActionVersion) return;
      renderSaved(wasSaved);
      if (beforeCount !== undefined) updateCount(beforeCount);
      if (status) status.textContent = '';
    });
  });
});

function listIconNode(icon: string | undefined) {
  const span = document.createElement('span');
  span.className = 'list-icon';
  span.setAttribute('aria-hidden', 'true');
  if (icon && /^https:\/\//i.test(icon)) {
    const img = document.createElement('img');
    img.src = icon;
    img.alt = '';
    img.width = 40;
    img.height = 40;
    img.loading = 'lazy';
    span.append(img);
  } else if (icon) {
    span.classList.add('list-icon--emoji');
    span.textContent = icon;
  } else {
    const glyph = document.createElement('i');
    glyph.className = 'fa-solid fa-list';
    span.append(glyph);
  }
  return span;
}

async function loadAccountLists(did: string) {
  if (!accountPage) return;
  const section = accountPage.querySelector<HTMLElement>('[data-account-lists]');
  const list = accountPage.querySelector<HTMLUListElement>('[data-lists-list]');
  const status = accountPage.querySelector<HTMLElement>('[data-lists-status]');
  const count = accountPage.querySelector<HTMLElement>('[data-lists-count]');
  const form = accountPage.querySelector<HTMLFormElement>('[data-list-form]');
  const formStatus = accountPage.querySelector<HTMLElement>('[data-list-form-status]');
  const formTitle = accountPage.querySelector<HTMLElement>('[data-list-form-title]');
  const submitButton = accountPage.querySelector<HTMLButtonElement>('[data-list-submit]');
  const cancelButton = accountPage.querySelector<HTMLButtonElement>('[data-list-cancel]');
  if (!section || !list || !status) return;

  let editingUri: string | undefined;
  const setFormMode = (editing: UserListSummary | undefined) => {
    editingUri = editing?.uri;
    if (formTitle) formTitle.textContent = editing ? `Edit “${editing.title}”` : 'Create a list';
    if (submitButton) submitButton.textContent = editing ? 'Save changes' : 'Create list';
    if (cancelButton) cancelButton.hidden = !editing;
    if (!editing) form?.reset();
    if (formStatus) formStatus.textContent = '';
  };
  cancelButton?.addEventListener('click', () => setFormMode(undefined));

  const renderLists = async () => {
    if (session?.did !== did) return;
    status.hidden = false;
    status.textContent = 'Loading your lists…';
    try {
      const lists = await listOwnLists(did);
      if (session?.did !== did) return;
      list.replaceChildren();
      lists.forEach((entry) => {
        const item = document.createElement('li');
        item.className = 'account-page__saved-item account-list-item';
        item.append(listIconNode(entry.icon));
        const body = document.createElement('div');
        body.className = 'account-list-item__body';
        const link = document.createElement('a');
        link.href = `/user/${encodeURIComponent(did)}/list/${encodeURIComponent(entry.rkey)}`;
        link.textContent = entry.title;
        body.append(link);
        if (entry.about) {
          const about = document.createElement('small');
          about.textContent = entry.about;
          body.append(about);
        }
        const created = document.createElement('small');
        created.textContent = `Created ${new Date(entry.createdAt).toLocaleDateString()}`;
        body.append(created);
        item.append(body);

        const actions = document.createElement('div');
        actions.className = 'account-list-item__actions';
        const edit = document.createElement('button');
        edit.type = 'button';
        edit.className = 'account-page__remove-save';
        edit.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i> Edit';
        edit.setAttribute('aria-label', `Edit the list ${entry.title}`);
        edit.addEventListener('click', () => {
          if (!form) return;
          const titleInput = form.elements.namedItem('title');
          const aboutInput = form.elements.namedItem('about');
          const iconInput = form.elements.namedItem('icon');
          if (titleInput instanceof HTMLInputElement) titleInput.value = entry.title;
          if (aboutInput instanceof HTMLTextAreaElement) aboutInput.value = entry.about || '';
          if (iconInput instanceof HTMLInputElement) iconInput.value = entry.icon || '';
          setFormMode(entry);
          form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          if (titleInput instanceof HTMLInputElement) titleInput.focus();
        });
        const share = document.createElement('button');
        share.type = 'button';
        share.className = 'account-page__remove-save';
        share.innerHTML = '<i class="fa-solid fa-link" aria-hidden="true"></i> Copy link';
        share.setAttribute('aria-label', `Copy share link for ${entry.title}`);
        share.addEventListener('click', async () => {
          const url = new URL(link.href, window.location.origin).toString();
          try {
            await navigator.clipboard.writeText(url);
            status.hidden = false;
            status.textContent = `Share link for “${entry.title}” copied to your clipboard.`;
          } catch {
            window.prompt('Copy this list link:', url);
          }
        });
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'account-page__remove-save';
        remove.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> Delete';
        remove.setAttribute('aria-label', `Delete the list ${entry.title}`);
        remove.addEventListener('click', async () => {
          if (session?.did !== did || !window.coffeeAndCodeAuth) return;
          remove.disabled = true;
          status.hidden = false;
          status.textContent = `Deleting “${entry.title}”…`;
          try {
            await window.coffeeAndCodeAuth.deleteList(entry.uri);
            item.remove();
            if (count) count.textContent = list.children.length ? `${list.children.length} ${list.children.length === 1 ? 'list' : 'lists'}` : '';
            status.textContent = list.children.length
              ? `Deleted “${entry.title}”.`
              : 'You have no lists yet. Create one below.';
          } catch (error) {
            status.textContent = errorMessage(error);
            remove.disabled = false;
          }
        });
        actions.append(edit, share, remove);
        item.append(actions);
        list.append(item);
      });
      if (count) count.textContent = lists.length ? `${lists.length} ${lists.length === 1 ? 'list' : 'lists'}` : '';
      status.textContent = lists.length
        ? ''
        : 'You have no lists yet. Create one below.';
      status.hidden = Boolean(lists.length);
    } catch (error) {
      status.hidden = false;
      status.textContent = errorMessage(error);
    }
  };

  await renderLists();

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (session?.did !== did || !window.coffeeAndCodeAuth) return;
    const data = new FormData(form);
    const title = String(data.get('title') || '');
    const about = String(data.get('about') || '');
    const icon = String(data.get('icon') || '');
    const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) submit.disabled = true;
    const editing = editingUri;
    if (formStatus) formStatus.textContent = editing ? 'Saving your changes…' : 'Creating your list…';
    try {
      if (editing) {
        await window.coffeeAndCodeAuth.updateList(editing, { title, about, icon });
        setFormMode(undefined);
        if (formStatus) formStatus.textContent = 'List updated.';
      } else {
        const uri = await window.coffeeAndCodeAuth.createList({ title, about, icon });
        const rkey = uri.split('/').at(-1) || '';
        form.reset();
        if (formStatus) {
          const link = `/user/${encodeURIComponent(did)}/list/${encodeURIComponent(rkey)}`;
          formStatus.innerHTML = '';
          const text = document.createElement('span');
          text.textContent = 'List created. ';
          const anchor = document.createElement('a');
          anchor.href = link;
          anchor.textContent = 'Open the public page';
          formStatus.append(text, anchor);
        }
      }
      await renderLists();
    } catch (error) {
      if (formStatus) formStatus.textContent = errorMessage(error);
    } finally {
      if (submit) submit.disabled = false;
    }
  });
}

// Story pages: "Add to list" opens a dialog of the reader's own lists.
document.querySelectorAll<HTMLButtonElement>('[data-reaction-subject] [data-add-to-list]').forEach((button) => {
  const container = button.closest<HTMLElement>('[data-reaction-subject]');
  const documentUri = container?.dataset.reactionSubject;
  const status = container?.querySelector<HTMLElement>('.article-reactions__status');
  const dialog = document.querySelector<HTMLDialogElement>('[data-list-dialog]');
  const dialogStatus = dialog?.querySelector<HTMLElement>('[data-list-dialog-status]');
  const dialogLists = dialog?.querySelector<HTMLUListElement>('[data-list-dialog-lists]');
  const dialogEmpty = dialog?.querySelector<HTMLElement>('[data-list-dialog-empty]');
  if (!container || !documentUri || !dialog || !dialogStatus || !dialogLists || !dialogEmpty) return;

  dialog.querySelector<HTMLButtonElement>('[data-list-dialog-close]')?.addEventListener('click', () => dialog.close());

  button.addEventListener('click', async () => {
    await oauthReady;
    if (!session || !window.coffeeAndCodeAuth) {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/auth?returnTo=${encodeURIComponent(safeReturnPath(currentPath))}`);
      return;
    }
    const did = session.did;
    dialogStatus.hidden = false;
    dialogStatus.textContent = 'Loading your lists…';
    dialogLists.replaceChildren();
    dialogEmpty.hidden = true;
    dialog.showModal();
    try {
      const lists = await window.coffeeAndCodeAuth.getListsWithMembership(documentUri);
      if (session?.did !== did) return;
      dialogLists.replaceChildren();
      lists.forEach((entry) => {
        const item = document.createElement('li');
        const label = document.createElement('label');
        label.className = 'list-dialog__list';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = entry.inList;
        const name = document.createElement('span');
        name.append(listIconNode(entry.icon), document.createTextNode(entry.title));
        label.append(checkbox, name);
        item.append(label);
        dialogLists.append(item);
        checkbox.addEventListener('change', async () => {
          checkbox.disabled = true;
          dialogStatus.hidden = false;
          dialogStatus.textContent = checkbox.checked
            ? `Adding to “${entry.title}”…`
            : `Removing from “${entry.title}”…`;
          try {
            await window.coffeeAndCodeAuth!.setListItem(entry.uri, documentUri, !checkbox.checked);
            dialogStatus.textContent = checkbox.checked
              ? `Added to “${entry.title}”.`
              : `Removed from “${entry.title}”.`;
            if (status) {
              status.textContent = checkbox.checked
                ? `Story added to your list “${entry.title}”.`
                : `Story removed from your list “${entry.title}”.`;
            }
          } catch (error) {
            checkbox.checked = !checkbox.checked;
            dialogStatus.textContent = errorMessage(error);
          } finally {
            checkbox.disabled = false;
          }
        });
      });
      dialogEmpty.hidden = Boolean(lists.length);
      dialogStatus.hidden = true;
      dialogStatus.textContent = '';
    } catch (error) {
      dialogStatus.hidden = false;
      dialogStatus.textContent = errorMessage(error);
    }
  });
});

// Public list pages: enable owner controls (remove items, share link).
document.querySelectorAll<HTMLElement>('[data-list-page]').forEach((page) => {
  const ownerDid = page.dataset.listOwnerDid || '';
  const listUri = page.dataset.listUri || '';
  const status = page.querySelector<HTMLElement>('[data-list-status]');
  const share = page.querySelector<HTMLButtonElement>('[data-list-share]');
  const manage = page.querySelector<HTMLElement>('[data-list-manage]');
  const itemsList = page.querySelector<HTMLUListElement>('[data-list-items]');
  const empty = page.querySelector<HTMLElement>('[data-list-empty]');

  share?.addEventListener('click', async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      if (status) status.textContent = 'List link copied to your clipboard.';
    } catch {
      window.prompt('Copy this list link:', url);
    }
  });

  void (async () => {
    await oauthReady;
    if (!session || session.did !== ownerDid || !listUriPattern.test(listUri)) return;
    manage?.removeAttribute('hidden');
    page.querySelectorAll<HTMLButtonElement>('[data-list-remove-item]').forEach((remove) => {
      remove.hidden = false;
      remove.addEventListener('click', async () => {
        if (session?.did !== ownerDid) return;
        const rkey = remove.dataset.itemRkey || '';
        const title = remove.dataset.itemTitle || 'story';
        const itemCollection = remove.dataset.itemCollection === legacyListItemCollection
          ? legacyListItemCollection
          : listItemCollection;
        if (!/^[a-zA-Z0-9._~:-]+$/.test(rkey)) return;
        remove.disabled = true;
        if (status) status.textContent = `Removing “${title}”…`;
        try {
          await repoRequest('com.atproto.repo.deleteRecord', {
            repo: ownerDid,
            collection: itemCollection,
            rkey,
          });
          remove.closest('li')?.remove();
          if (status) status.textContent = `Removed “${title}” from this list.`;
          if (itemsList && !itemsList.children.length) {
            itemsList.hidden = true;
            if (empty) empty.hidden = false;
          }
        } catch (error) {
          if (status) status.textContent = errorMessage(error);
          remove.disabled = false;
        }
      });
    });
  })();
});

// Article share buttons: native Web Share API (when available) and copy link.
document.querySelectorAll<HTMLElement>('.article-share').forEach((shareSection) => {
  const status = shareSection.closest('.article-engagement')?.querySelector<HTMLElement>('.article-reactions__status');
  const title = shareSection.dataset.shareTitle || document.title;
  const url = shareSection.dataset.shareUrl || window.location.href;

  const nativeShare = shareSection.querySelector<HTMLButtonElement>('[data-share-native]');
  if (nativeShare && typeof navigator.share === 'function') {
    nativeShare.hidden = false;
    nativeShare.addEventListener('click', async () => {
      try {
        await navigator.share({ title, url });
        if (status) status.textContent = 'Thanks for sharing this story.';
      } catch (error) {
        if ((error as DOMException)?.name === 'AbortError') return;
        if (status) status.textContent = errorMessage(error);
      }
    });
  }

  shareSection.querySelector<HTMLButtonElement>('[data-share-copy]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      if (status) status.textContent = 'Story link copied to your clipboard.';
    } catch {
      window.prompt('Copy this story link:', url);
    }
  });
});

// ---------------------------------------------------------------------------
// Author drafts — cc.coffeencode.author.draft records whose `document` field
// holds a pub.leaflet.document built from pub.leaflet.blocks.* blocks.
// ---------------------------------------------------------------------------

const DRAFT_COLLECTION = 'cc.coffeencode.author.draft';
const DICTIONARY_COLLECTION = 'cc.coffeencode.author.dictionary';
const DICTIONARY_RKEY = 'self';
const DRAFT_SYNC_INTERVAL_MS = 15000;
const LEAFLET_FACET = 'pub.leaflet.richtext.facet';

type DraftFacetFeature = Record<string, unknown> & { $type: string };
type DraftFacet = { index: { byteStart: number; byteEnd: number }; features: DraftFacetFeature[] };
type DraftBlockType = 'text' | 'header' | 'blockquote' | 'code' | 'unorderedList' | 'orderedList'
  | 'horizontalRule' | 'image' | 'video' | 'button' | 'website' | 'bskyPost' | 'math' | 'embed';
type DraftBlock = {
  id: string;
  type: DraftBlockType;
  alignment?: string;
  level?: number;
  language?: string;
  image?: unknown;
  imageObjectUrl?: string;
  video?: string;
  videoObjectUrl?: string;
  mimeType?: string;
  alt?: string;
  aspectRatio?: { width: number; height: number };
  height?: number;
  url?: string;
  label?: string;
  title?: string;
  description?: string;
  tex?: string;
  postRef?: { uri: string; cid: string };
};

function draftEscapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Serialize a contenteditable element into plaintext + pub.leaflet.richtext.facet facets.
function serializeEditable(root: HTMLElement): { plaintext: string; facets: DraftFacet[] } {
  const encoder = new TextEncoder();
  let plaintext = '';
  const facets: DraftFacet[] = [];
  const byteLength = () => encoder.encode(plaintext).length;
  const featuresFor = (element: HTMLElement): DraftFacetFeature[] => {
    switch (element.tagName) {
      case 'B': case 'STRONG': return [{ $type: `${LEAFLET_FACET}#bold` }];
      case 'I': case 'EM': return [{ $type: `${LEAFLET_FACET}#italic` }];
      case 'U': case 'INS': return [{ $type: `${LEAFLET_FACET}#underline` }];
      case 'S': case 'STRIKE': case 'DEL': return [{ $type: `${LEAFLET_FACET}#strikethrough` }];
      case 'CODE': return [{ $type: `${LEAFLET_FACET}#code` }];
      case 'MARK': return [{ $type: `${LEAFLET_FACET}#highlight` }];
      case 'A': {
        const href = element.getAttribute('href');
        return href ? [{ $type: `${LEAFLET_FACET}#link`, uri: href }] : [];
      }
      default: return [];
    }
  };
  const walk = (node: Node, active: DraftFacetFeature[]) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || '';
      if (!text) return;
      const byteStart = byteLength();
      plaintext += text;
      const byteEnd = byteLength();
      if (active.length && byteEnd > byteStart) {
        facets.push({ index: { byteStart, byteEnd }, features: [...active] });
      }
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === 'BR') { plaintext += '\n'; return; }
    const isContainer = node.tagName === 'DIV' || node.tagName === 'P';
    if (isContainer && plaintext && !plaintext.endsWith('\n')) plaintext += '\n';
    const added = featuresFor(node);
    const next = added.length ? [...active, ...added] : active;
    node.childNodes.forEach((child) => walk(child, next));
    if (isContainer && plaintext && !plaintext.endsWith('\n')) plaintext += '\n';
  };
  root.childNodes.forEach((child) => walk(child, []));
  return { plaintext, facets };
}

// Render plaintext + leaflet facets to escaped HTML for the preview.
function richTextToHtml(plaintext: string, facets?: DraftFacet[]): string {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const bytes = encoder.encode(plaintext);
  const boundaries = new Set<number>([0, bytes.length]);
  const valid: DraftFacet[] = [];
  for (const facet of facets || []) {
    const { byteStart, byteEnd } = facet?.index || {};
    if (!Number.isInteger(byteStart) || !Number.isInteger(byteEnd)
      || byteStart < 0 || byteEnd <= byteStart || byteEnd > bytes.length
      || !Array.isArray(facet.features)) continue;
    valid.push(facet);
    boundaries.add(byteStart);
    boundaries.add(byteEnd);
  }
  const order = [...boundaries].sort((a, b) => a - b);
  let html = '';
  for (let index = 0; index + 1 < order.length; index += 1) {
    const start = order[index];
    const end = order[index + 1];
    let segment = draftEscapeHtml(decoder.decode(bytes.slice(start, end))).replace(/\n/g, '<br>');
    const active = new Set<string>();
    let link: string | undefined;
    for (const facet of valid) {
      if (facet.index.byteStart <= start && facet.index.byteEnd >= end) {
        for (const feature of facet.features) {
          active.add(feature.$type);
          if (feature.$type === `${LEAFLET_FACET}#link` && typeof feature.uri === 'string') link = feature.uri;
        }
      }
    }
    if (active.has(`${LEAFLET_FACET}#bold`)) segment = `<strong>${segment}</strong>`;
    if (active.has(`${LEAFLET_FACET}#italic`)) segment = `<em>${segment}</em>`;
    if (active.has(`${LEAFLET_FACET}#underline`)) segment = `<u>${segment}</u>`;
    if (active.has(`${LEAFLET_FACET}#strikethrough`)) segment = `<s>${segment}</s>`;
    if (active.has(`${LEAFLET_FACET}#highlight`)) segment = `<mark>${segment}</mark>`;
    if (active.has(`${LEAFLET_FACET}#code`)) segment = `<code>${segment}</code>`;
    if (link) segment = `<a href="${draftEscapeHtml(link)}" target="_blank" rel="noopener">${segment}</a>`;
    html += segment;
  }
  return html;
}

const DRAFT_TEXT_TYPES: DraftBlockType[] = ['text', 'header', 'blockquote', 'code'];
const draftBlockLabel: Record<DraftBlockType, string> = {
  text: 'Write something…',
  header: 'Heading',
  blockquote: 'Quote',
  code: 'Code',
  unorderedList: 'List item',
  orderedList: 'List item',
  horizontalRule: '',
  image: '',
  video: '',
  button: '',
  website: '',
  bskyPost: '',
  math: '',
  embed: '',
};

// Video blocks round-trip as pub.leaflet.blocks.iframe; on reload those pointing
// at a /video/ path or a video file extension map back to the editor's video
// block, and every other iframe URL hydrates as a website embed.
function isVideoEmbedUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    return url.pathname.startsWith('/video/') || /\.(mp4|webm|mov|m4v|ogv|mpg|3gp|3g2)$/i.test(url.pathname);
  } catch { return false; }
}

function draftBlockFromLeaflet(block: Record<string, unknown>, alignment?: string): DraftBlock | undefined {
  const type = typeof block.$type === 'string' ? block.$type.split('.').pop() || '' : '';
  const base: DraftBlock = { id: crypto.randomUUID(), type: 'text' };
  if (alignment && /^#textAlign(Left|Center|Right|Justify)$/.test(alignment)) base.alignment = alignment;
  switch (type) {
    case 'text': case 'blockquote': case 'math': case 'button': case 'website':
    case 'bskyPost': case 'horizontalRule': case 'unorderedList': case 'orderedList':
      break;
    case 'header': base.level = Number.isInteger(block.level) ? Math.min(6, Math.max(1, block.level as number)) : 2; break;
    case 'code': base.language = typeof block.language === 'string' ? block.language : ''; break;
    case 'image': {
      base.image = block.image;
      base.alt = typeof block.alt === 'string' ? block.alt : '';
      const ratio = block.aspectRatio as { width?: unknown; height?: unknown } | undefined;
      if (Number.isInteger(ratio?.width) && Number.isInteger(ratio?.height) && (ratio!.width as number) > 0) {
        base.aspectRatio = { width: ratio!.width as number, height: ratio!.height as number };
      }
      base.type = 'image';
      return base;
    }
    // pub.leaflet.blocks.iframe — uploaded videos hydrate back into video
    // blocks; everything else becomes a generic website embed.
    case 'iframe': {
      const url = typeof block.url === 'string' ? block.url : '';
      const ratio = block.aspectRatio as { width?: unknown; height?: unknown } | undefined;
      const validRatio = Number.isInteger(ratio?.width) && Number.isInteger(ratio?.height) && (ratio!.width as number) > 0
        ? { width: ratio!.width as number, height: ratio!.height as number }
        : undefined;
      if (isVideoEmbedUrl(url)) {
        base.video = url;
        base.videoObjectUrl = url;
        base.alt = typeof block.title === 'string' && block.title !== 'Embedded video' ? block.title : '';
        if (validRatio) base.aspectRatio = validRatio;
        base.type = 'video';
        return base;
      }
      if (!url) return undefined;
      base.url = url;
      base.title = typeof block.title === 'string' && block.title !== 'Embedded website' ? block.title : '';
      if (Number.isInteger(block.height) && (block.height as number) >= 16 && (block.height as number) <= 1600) {
        base.height = block.height as number;
      }
      if (validRatio) base.aspectRatio = validRatio;
      base.type = 'embed';
      return base;
    }
    default: return undefined;
  }
  base.type = type as DraftBlockType;
  if (type === 'math') base.tex = typeof block.tex === 'string' ? block.tex : '';
  if (type === 'button') {
    base.label = typeof block.text === 'string' ? block.text : '';
    base.url = typeof block.url === 'string' ? block.url : '';
  }
  if (type === 'website') {
    base.url = typeof block.src === 'string' ? block.src : '';
    base.title = typeof block.title === 'string' ? block.title : '';
    base.description = typeof block.description === 'string' ? block.description : '';
  }
  if (type === 'bskyPost') {
    const ref = block.postRef as { uri?: unknown; cid?: unknown } | undefined;
    if (typeof ref?.uri === 'string' && typeof ref?.cid === 'string') {
      base.postRef = { uri: ref.uri, cid: ref.cid };
      base.url = ref.uri;
    }
  }
  return base;
}

async function loadDraftListPage(did: string) {
  if (!accountPage) return;
  const section = accountPage.querySelector<HTMLElement>('[data-draft-list]');
  if (!section || section.dataset.draftLoaded === did) return;
  section.dataset.draftLoaded = did;
  const list = section.querySelector<HTMLElement>('[data-drafts-list]');
  const status = section.querySelector<HTMLElement>('[data-drafts-status]');
  const newButton = section.querySelector<HTMLButtonElement>('[data-draft-new]');
  const gate = accountPage.querySelector<HTMLElement>('[data-draft-gate]');
  if (!list || !status) return;

  newButton?.addEventListener('click', () => {
    window.location.assign(`/account/author/draft/${createTid()}`);
  });

  const showGate = async () => {
    try {
      const postsResponse = await fetch(`/api/account/posts?author=${encodeURIComponent(did)}`, { cache: 'no-store' });
      const posts = postsResponse.ok ? await postsResponse.json() as unknown[] : [];
      if (!Array.isArray(posts) || posts.length === 0) {
        section.hidden = true;
        if (gate) gate.hidden = false;
        return true;
      }
    } catch { /* fall through to the generic error */ }
    return false;
  };

  try {
    const query = new URLSearchParams({ repo: did, collection: DRAFT_COLLECTION, limit: '100' });
    const postsQuery = new URLSearchParams({ repo: did, collection: 'pub.leaflet.document', limit: '100' });
    const [response, postsResponse] = await Promise.all([
      repoRequest(`com.atproto.repo.listRecords?${query}`),
      // Leaflet documents predate the draft collection — list them too so they
      // can be imported for editing.
      repoRequest(`com.atproto.repo.listRecords?${postsQuery}`).catch(() => undefined),
    ]);
    const payload = await response.json() as {
      records?: Array<{ uri?: unknown; value?: Record<string, unknown> }>;
    };
    const postsPayload = postsResponse?.ok
      ? await postsResponse.json() as { records?: Array<{ uri?: unknown; value?: Record<string, unknown> }> }
      : { records: [] };
    if (session?.did !== did) return;
    const drafts = (payload.records || []).flatMap((record) => {
      if (typeof record.uri !== 'string' || !record.value || typeof record.value !== 'object') return [];
      const value = record.value;
      let rkey: string;
      try { rkey = recordKeyFromUri(record.uri); } catch { return []; }
      const doc = value.document as Record<string, unknown> | undefined;
      const title = (typeof value.title === 'string' && value.title.trim() ? value.title.trim() : '')
        || (typeof doc?.title === 'string' && doc.title.trim() ? doc.title.trim() : 'Untitled');
      const updatedAt = typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))
        ? value.updatedAt
        : typeof value.createdAt === 'string' ? value.createdAt : '';
      const publishedUri = typeof value.publishedUri === 'string' ? value.publishedUri : '';
      const postUri = typeof value.postUri === 'string' ? value.postUri : '';
      const publishedAt = typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt))
        ? value.publishedAt
        : '';
      return [{ uri: record.uri, rkey, title, updatedAt, published: Boolean(publishedUri || postUri), publishedUri, publishedAt }];
    }).sort((a, b) => (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0));
    const draftedUris = new Set(drafts.map((draft) => draft.publishedUri).filter(Boolean));
    const posts = (postsPayload.records || []).flatMap((record) => {
      if (typeof record.uri !== 'string' || !record.value || typeof record.value !== 'object') return [];
      // Drafts that already point at this post are listed above as drafts.
      if (draftedUris.has(record.uri)) return [];
      const value = record.value;
      const title = typeof value.title === 'string' && value.title.trim() ? value.title.trim() : 'Untitled';
      const publishedAt = typeof value.publishedAt === 'string' && Number.isFinite(Date.parse(value.publishedAt))
        ? value.publishedAt : '';
      return [{ uri: record.uri, title, publishedAt, value }];
    }).sort((a, b) => (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0));

    const publishedBadge = (label = 'Published') => {
      const badge = document.createElement('span');
      badge.className = 'draft-list__badge';
      badge.textContent = label;
      return badge;
    };
    const isFuture = (iso: string) => Date.parse(iso) > Date.now();

    list.replaceChildren();
    for (const draft of drafts) {
      const item = document.createElement('li');
      item.className = 'draft-list__item';
      const link = document.createElement('a');
      link.href = `/account/author/draft/${encodeURIComponent(draft.rkey)}`;
      const title = document.createElement('span');
      title.className = 'draft-list__title';
      title.textContent = draft.title;
      const meta = document.createElement('span');
      meta.className = 'draft-list__meta';
      meta.textContent = draft.updatedAt
        ? `Updated ${new Date(draft.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`
        : 'Draft';
      if (draft.published) meta.prepend(publishedBadge(draft.publishedAt && isFuture(draft.publishedAt) ? 'Scheduled' : 'Published'), ' ');
      link.append(title, meta);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'auth-signout';
      remove.textContent = 'Delete';
      remove.addEventListener('click', async () => {
        if (!window.confirm(`Delete the draft “${draft.title}”?`)) return;
        remove.disabled = true;
        try {
          await repoRequest('com.atproto.repo.deleteRecord', { repo: did, collection: DRAFT_COLLECTION, rkey: draft.rkey });
          try { localStorage.removeItem(`cc:draft-backup:${did}:${draft.rkey}`); } catch {}
          item.remove();
          if (!list.children.length) status.textContent = 'You have no drafts yet.';
        } catch (error) {
          status.textContent = errorMessage(error);
          remove.disabled = false;
        }
      });
      item.append(link, remove);
      list.append(item);
    }
    for (const post of posts) {
      const item = document.createElement('li');
      item.className = 'draft-list__item';
      const link = document.createElement('a');
      link.href = '#';
      const title = document.createElement('span');
      title.className = 'draft-list__title';
      title.textContent = post.title;
      const meta = document.createElement('span');
      meta.className = 'draft-list__meta';
      const postScheduled = post.publishedAt && isFuture(post.publishedAt);
      meta.textContent = post.publishedAt
        ? `${postScheduled ? 'Scheduled for' : 'Published'} ${new Date(post.publishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: postScheduled ? 'short' : undefined })}`
        : 'Published post';
      meta.prepend(publishedBadge(postScheduled ? 'Scheduled' : 'Published'), ' ');
      link.append(title, meta);
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'auth-signout';
      edit.textContent = 'Edit';
      const editPost = async () => {
        edit.disabled = true;
        link.removeAttribute('href');
        status.textContent = `Preparing “${post.title}” for editing…`;
        try {
          // Wrap the published Leaflet document in a draft record so the editor
          // can load it; the draft remembers which post it came from.
          const rkey = createTid();
          const now = new Date().toISOString();
          await repoRequest('com.atproto.repo.putRecord', {
            repo: did,
            collection: DRAFT_COLLECTION,
            rkey,
            record: {
              $type: DRAFT_COLLECTION,
              createdAt: now,
              updatedAt: now,
              title: post.title,
              publishedUri: post.uri,
              ...(post.publishedAt ? { publishedAt: post.publishedAt } : {}),
              document: post.value,
            },
          });
          window.location.assign(`/account/author/draft/${encodeURIComponent(rkey)}`);
        } catch (error) {
          status.textContent = errorMessage(error);
          edit.disabled = false;
        }
      };
      edit.addEventListener('click', () => { void editPost(); });
      link.addEventListener('click', (event) => { event.preventDefault(); void editPost(); });
      item.append(link, edit);
      list.append(item);
    }
    status.textContent = drafts.length || posts.length
      ? ''
      : 'You have no drafts yet. Start a new one.';
  } catch (error) {
    if (session?.did !== did) return;
    if (await showGate()) return;
    status.textContent = errorMessage(error);
  }
}

// Re-entering the draft editor installs a fresh document-level listener; abort
// the previous one so stale sessions don't accumulate.
let draftSpellAbort: AbortController | undefined;

async function loadDraftEditor(did: string) {
  if (!accountPage) return;
  const page = accountPage.querySelector<HTMLElement>('[data-draft-editor]');
  if (!page || page.dataset.draftLoaded === did) return;
  page.dataset.draftLoaded = did;
  const rkey = page.dataset.draftRkey || '';
  if (!/^[a-zA-Z0-9._~:-]+$/.test(rkey)) return;
  const blocksEl = page.querySelector<HTMLElement>('[data-draft-blocks]');
  const previewEl = page.querySelector<HTMLElement>('[data-draft-preview]');
  const statusEl = page.querySelector<HTMLElement>('[data-draft-status]');
  const workspace = page.querySelector<HTMLElement>('[data-draft-workspace]');
  const gate = page.querySelector<HTMLElement>('[data-draft-gate]');
  const toolbar = page.querySelector<HTMLElement>('[data-draft-toolbar]');
  const saveButton = page.querySelector<HTMLButtonElement>('[data-draft-save]');
  const deleteButton = page.querySelector<HTMLButtonElement>('[data-draft-delete]');
  const publishButton = page.querySelector<HTMLButtonElement>('[data-draft-publish]');
  const publishedLink = page.querySelector<HTMLAnchorElement>('[data-draft-published-link]');
  const previewLinkButton = page.querySelector<HTMLButtonElement>('[data-draft-preview-link]');
  previewLinkButton?.addEventListener('click', async () => {
    // Draft records are public on the author's repo; this link renders the
    // unpublished draft on the site (noindexed) for anyone you share it with.
    const url = `${window.location.origin}/preview/draft/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`;
    try {
      await navigator.clipboard.writeText(url);
      const label = previewLinkButton.innerHTML;
      previewLinkButton.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Copied';
      window.setTimeout(() => { previewLinkButton.innerHTML = label; }, 2000);
    } catch {
      window.prompt('Copy the draft preview link', url);
    }
  });
  const metaForm = page.querySelector<HTMLElement>('.draft-editor__meta');
  const settingsButton = page.querySelector<HTMLButtonElement>('[data-draft-settings]');
  const settingsPanel = page.querySelector<HTMLDetailsElement>('[data-draft-settings-panel]');
  const importButton = page.querySelector<HTMLButtonElement>('[data-draft-import]');
  const importInput = page.querySelector<HTMLInputElement>('[data-draft-import-file]');
  settingsButton?.addEventListener('click', () => {
    if (!settingsPanel) return;
    settingsPanel.open = !settingsPanel.open;
    settingsButton.setAttribute('aria-expanded', String(settingsPanel.open));
  });
  if (!blocksEl || !previewEl || !statusEl || !workspace || !toolbar || !saveButton || !deleteButton || !publishButton || !metaForm) return;
  const titleInput = metaForm.querySelector<HTMLInputElement>('[data-draft-field="title"]')!;
  const descriptionInput = metaForm.querySelector<HTMLTextAreaElement>('[data-draft-field="description"]')!;
  const tagsInput = metaForm.querySelector<HTMLTextAreaElement>('[data-draft-field="tags"]')!;
  const publicationInput = metaForm.querySelector<HTMLSelectElement>('[data-draft-field="publication"]')!;
  const coverInput = metaForm.querySelector<HTMLInputElement>('[data-draft-field="cover"]')!;
  const coverPreview = metaForm.querySelector<HTMLImageElement>('[data-draft-cover-preview]');
  const coverRemoveInput = metaForm.querySelector<HTMLInputElement>('[data-draft-field="coverRemove"]')!;
  const sourcesInput = metaForm.querySelector<HTMLTextAreaElement>('[data-draft-field="sources"]')!;
  const backlinkInput = metaForm.querySelector<HTMLInputElement>('[data-draft-field="backlink"]')!;
  const coauthorsInput = metaForm.querySelector<HTMLInputElement>('[data-draft-field="coauthors"]');
  const coauthorTokens = () => (coauthorsInput?.value || '')
    .split(',')
    .map((token) => token.trim().replace(/^@/, ''))
    .filter(Boolean)
    .slice(0, 8);
  // Handles resolve through the public bsky API; DIDs pass through.
  const resolveCoauthorDids = async () => {
    const dids: string[] = [];
    for (const token of coauthorTokens()) {
      if (/^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(token)) {
        if (token !== did && !dids.includes(token)) dids.push(token);
        continue;
      }
      if (!/^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(token)) {
        throw new Error(`“${token}” is not a handle or a DID.`);
      }
      const res = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({})) as { did?: unknown };
      if (!res.ok || typeof data.did !== 'string') {
        throw new Error(`Could not resolve the co-author “${token}”.`);
      }
      if (data.did !== did && !dids.includes(data.did)) dids.push(data.did);
    }
    return dids;
  };

  const state = {
    blocks: [] as DraftBlock[],
    blockElements: new Map<string, HTMLElement>(),
    createdAt: undefined as string | undefined,
    cover: undefined as unknown,
    coverObjectUrl: undefined as string | undefined,
    version: 0,
    savedVersion: -1,
    syncing: false,
    exists: false,
    publishedUri: undefined as string | undefined,
    publishedAt: undefined as string | undefined,
    postUri: undefined as string | undefined,
    metadataExisted: false,
    metadataCreatedAt: undefined as string | undefined,
  };
  // Local backup: unsynced changes are mirrored to localStorage so losing the
  // session (expired app-password sign-in, closed tab, dead connection) never
  // loses writing. A successful sync clears it; on the next load a backup
  // newer than the PDS record is restored and synced once signed in again.
  const backupKey = `cc:draft-backup:${did}:${rkey}`;
  const writeBackup = () => {
    try {
      const draftDocument = serializeDraft();
      const draftSourceList = draftSources();
      const draftBacklinkValue = draftBacklink();
      localStorage.setItem(backupKey, JSON.stringify({
        savedAt: Date.now(),
        record: {
          $type: DRAFT_COLLECTION,
          createdAt: state.createdAt,
          updatedAt: new Date().toISOString(),
          title: draftDocument.title,
          ...(typeof draftDocument.description === 'string' ? { description: draftDocument.description } : {}),
          ...(draftSourceList.length ? { sources: draftSourceList } : {}),
          ...(draftBacklinkValue ? { backlink: draftBacklinkValue } : {}),
          ...(state.publishedUri ? { publishedUri: state.publishedUri } : {}),
          ...(state.postUri ? { postUri: state.postUri } : {}),
          ...(state.publishedAt ? { publishedAt: state.publishedAt } : {}),
          ...(coauthorTokens().length ? { coauthors: coauthorTokens() } : {}),
          document: draftDocument,
        },
      }));
    } catch { /* A draft that can't serialize yet isn't worth backing up. */ }
  };
  const loadBackup = (): { savedAt: number; record: Record<string, unknown> } | undefined => {
    try {
      const parsed = JSON.parse(localStorage.getItem(backupKey) || 'null') as { savedAt?: unknown; record?: unknown } | null;
      if (!parsed || typeof parsed.savedAt !== 'number' || !parsed.record || typeof parsed.record !== 'object') return undefined;
      return { savedAt: parsed.savedAt, record: parsed.record as Record<string, unknown> };
    } catch { return undefined; }
  };
  const clearBackup = () => { try { localStorage.removeItem(backupKey); } catch {} };
  let backupTimer: number | undefined;
  const queueBackup = () => {
    if (backupTimer) window.clearTimeout(backupTimer);
    backupTimer = window.setTimeout(writeBackup, 1000);
  };

  const markDirty = () => { state.version += 1; queueBackup(); };

  const currentBlockElement = (): HTMLElement | undefined => {
    const node = window.getSelection()?.anchorNode;
    const element = node instanceof HTMLElement ? node : node?.parentElement;
    return element?.closest<HTMLElement>('[data-block-id]') ?? undefined;
  };
  const blockFor = (element: HTMLElement) => state.blocks.find((block) => block.id === element.dataset.blockId);

  const serializeBlock = (block: DraftBlock, element: HTMLElement): Record<string, unknown> | undefined => {
    const editable = element.querySelector<HTMLElement>('.draft-block__editable');
    switch (block.type) {
      case 'text': case 'blockquote': {
        const { plaintext, facets } = editable ? serializeEditable(editable) : { plaintext: '', facets: [] };
        const out: Record<string, unknown> = { $type: `pub.leaflet.blocks.${block.type}`, plaintext };
        if (facets.length) out.facets = facets;
        return out;
      }
      case 'header': {
        const { plaintext, facets } = editable ? serializeEditable(editable) : { plaintext: '', facets: [] };
        const out: Record<string, unknown> = { $type: 'pub.leaflet.blocks.header', level: block.level || 2, plaintext };
        if (facets.length) out.facets = facets;
        return out;
      }
      case 'code': {
        const out: Record<string, unknown> = { $type: 'pub.leaflet.blocks.code', plaintext: editable?.textContent || '' };
        const language = element.querySelector<HTMLInputElement>('[data-field="language"]')?.value.trim();
        if (language) out.language = language;
        return out;
      }
      case 'unorderedList': case 'orderedList': {
        const rows = [...element.querySelectorAll<HTMLElement>('.draft-block__item-editable')];
        const children = rows.map((row) => {
          const { plaintext, facets } = serializeEditable(row);
          const content: Record<string, unknown> = { $type: 'pub.leaflet.blocks.text', plaintext };
          if (facets.length) content.facets = facets;
          return { content };
        }).filter((item) => (item.content.plaintext as string).trim().length > 0);
        if (!children.length) return undefined;
        const out: Record<string, unknown> = { $type: `pub.leaflet.blocks.${block.type}`, children };
        if (block.type === 'orderedList' && block.level) out.startIndex = block.level;
        return out;
      }
      case 'horizontalRule': return { $type: 'pub.leaflet.blocks.horizontalRule' };
      case 'image': {
        if (!block.image || !block.aspectRatio) return undefined;
        const alt = element.querySelector<HTMLInputElement>('[data-field="alt"]')?.value.trim();
        const out: Record<string, unknown> = {
          $type: 'pub.leaflet.blocks.image',
          image: block.image,
          aspectRatio: block.aspectRatio,
        };
        if (alt) out.alt = alt;
        return out;
      }
      case 'video': {
        if (!block.video) return undefined;
        const alt = element.querySelector<HTMLInputElement>('[data-field="alt"]')?.value.trim();
        const out: Record<string, unknown> = { $type: 'pub.leaflet.blocks.iframe', url: block.video };
        if (block.aspectRatio) out.aspectRatio = block.aspectRatio;
        out.title = alt || 'Embedded video';
        return out;
      }
      case 'button': {
        const label = element.querySelector<HTMLInputElement>('[data-field="label"]')?.value.trim() || '';
        const url = element.querySelector<HTMLInputElement>('[data-field="url"]')?.value.trim() || '';
        if (!label || !url) return undefined;
        return { $type: 'pub.leaflet.blocks.button', text: label, url };
      }
      case 'embed': {
        const url = element.querySelector<HTMLInputElement>('[data-field="url"]')?.value.trim() || block.url || '';
        if (!url) return undefined;
        const out: Record<string, unknown> = {
          $type: 'pub.leaflet.blocks.iframe',
          url,
          title: element.querySelector<HTMLInputElement>('[data-field="title"]')?.value.trim() || 'Embedded website',
        };
        const height = Number(element.querySelector<HTMLInputElement>('[data-field="height"]')?.value);
        if (Number.isInteger(height) && height >= 16 && height <= 1600) out.height = height;
        else if (block.aspectRatio) out.aspectRatio = block.aspectRatio;
        return out;
      }
      case 'website': {
        const url = element.querySelector<HTMLInputElement>('[data-field="url"]')?.value.trim() || '';
        if (!url) return undefined;
        const out: Record<string, unknown> = { $type: 'pub.leaflet.blocks.website', src: url };
        const title = element.querySelector<HTMLInputElement>('[data-field="title"]')?.value.trim();
        const description = element.querySelector<HTMLInputElement>('[data-field="description"]')?.value.trim();
        if (title) out.title = title;
        if (description) out.description = description;
        return out;
      }
      case 'bskyPost': {
        if (!block.postRef) return undefined;
        const out: Record<string, unknown> = { $type: 'pub.leaflet.blocks.bskyPost', postRef: block.postRef };
        out.clientHost = 'coffeencode.cc';
        return out;
      }
      case 'math': {
        const tex = element.querySelector<HTMLInputElement>('[data-field="tex"]')?.value.trim() || block.tex || '';
        if (!tex) return undefined;
        return { $type: 'pub.leaflet.blocks.math', tex };
      }
      default: return undefined;
    }
  }

  const renderPreview = () => {
    if (coverPreview) {
      coverPreview.src = state.coverObjectUrl || '';
      coverPreview.hidden = !state.coverObjectUrl;
    }
    const title = titleInput.value.trim();
    const description = descriptionInput.value.trim();
    const parts: string[] = [];
    if (state.coverObjectUrl) parts.push(`<img class="draft-preview__cover" src="${state.coverObjectUrl}" alt="">`);
    parts.push(`<h1 class="draft-preview__title">${draftEscapeHtml(title || 'Untitled')}</h1>`);
    if (description) parts.push(`<p class="draft-preview__description">${draftEscapeHtml(description)}</p>`);
    let body = '';
    for (const block of state.blocks) {
      const element = state.blockElements.get(block.id);
      if (!element) continue;
      const align = block.alignment && block.alignment !== '#textAlignLeft'
        ? ` style="text-align:${block.alignment.slice(10).toLowerCase()}"` : '';
      const editable = element.querySelector<HTMLElement>('.draft-block__editable');
      const rich = () => {
        const { plaintext, facets } = editable ? serializeEditable(editable) : { plaintext: '', facets: [] };
        return richTextToHtml(plaintext, facets);
      };
      switch (block.type) {
        case 'text': body += `<p${align}>${rich()}</p>`; break;
        case 'header': {
          const level = Math.min(3, Math.max(1, block.level || 2));
          body += `<h${level}${align}>${rich()}</h${level}>`;
          break;
        }
        case 'blockquote': body += `<blockquote${align}>${rich()}</blockquote>`; break;
        case 'code': body += `<pre><code>${draftEscapeHtml(editable?.textContent || '')}</code></pre>`; break;
        case 'unorderedList': case 'orderedList': {
          const tag = block.type === 'unorderedList' ? 'ul' : 'ol';
          const rows = [...element.querySelectorAll<HTMLElement>('.draft-block__item-editable')]
            .map((row) => {
              const { plaintext, facets } = serializeEditable(row);
              return `<li>${richTextToHtml(plaintext, facets)}</li>`;
            }).join('');
          body += `<${tag}${align}>${rows}</${tag}>`;
          break;
        }
        case 'horizontalRule': body += '<hr>'; break;
        case 'image': {
          if (!block.imageObjectUrl) break;
          const alt = element.querySelector<HTMLInputElement>('[data-field="alt"]')?.value.trim() || '';
          body += `<figure><img src="${block.imageObjectUrl}" alt="${draftEscapeHtml(alt)}">${alt ? `<figcaption>${draftEscapeHtml(alt)}</figcaption>` : ''}</figure>`;
          break;
        }
        case 'video': {
          const src = block.videoObjectUrl || block.video;
          if (!src) break;
          const alt = element.querySelector<HTMLInputElement>('[data-field="alt"]')?.value.trim() || '';
          const ratio = block.aspectRatio ? ` style="aspect-ratio:${block.aspectRatio.width}/${block.aspectRatio.height}"` : '';
          body += `<figure><video src="${draftEscapeHtml(src)}" controls preload="metadata" playsinline${ratio}></video>${alt ? `<figcaption>${draftEscapeHtml(alt)}</figcaption>` : ''}</figure>`;
          break;
        }
        case 'button': {
          const label = element.querySelector<HTMLInputElement>('[data-field="label"]')?.value.trim() || 'Button';
          const url = element.querySelector<HTMLInputElement>('[data-field="url"]')?.value.trim() || '#';
          body += `<a class="draft-preview__button" href="${draftEscapeHtml(url)}">${draftEscapeHtml(label)}</a><br>`;
          break;
        }
        case 'website': {
          const url = element.querySelector<HTMLInputElement>('[data-field="url"]')?.value.trim() || '#';
          const title = element.querySelector<HTMLInputElement>('[data-field="title"]')?.value.trim() || url;
          const description = element.querySelector<HTMLInputElement>('[data-field="description"]')?.value.trim() || '';
          body += `<a class="draft-preview__card" href="${draftEscapeHtml(url)}"><strong>${draftEscapeHtml(title)}</strong>${description ? `<span>${draftEscapeHtml(description)}</span>` : ''}<span>${draftEscapeHtml(url)}</span></a>`;
          break;
        }
        case 'bskyPost': {
          const url = element.querySelector<HTMLInputElement>('[data-field="url"]')?.value.trim() || block.url || '';
          body += `<div class="draft-preview__embed"><i class="fa-brands fa-bluesky" aria-hidden="true"></i> Bluesky post${url ? ` — ${draftEscapeHtml(url)}` : ''}</div>`;
          break;
        }
        case 'math': {
          const tex = element.querySelector<HTMLInputElement>('[data-field="tex"]')?.value.trim() || '';
          body += `<div class="draft-preview__math">${draftEscapeHtml(tex)}</div>`;
          break;
        }
        case 'embed': {
          const url = element.querySelector<HTMLInputElement>('[data-field="url"]')?.value.trim() || block.url || '';
          if (!url) break;
          const title = element.querySelector<HTMLInputElement>('[data-field="title"]')?.value.trim() || 'Embedded website';
          const height = Number(element.querySelector<HTMLInputElement>('[data-field="height"]')?.value);
          const sizing = Number.isInteger(height) && height >= 16 && height <= 1600
            ? `height:${height}px;`
            : block.aspectRatio
              ? `aspect-ratio:${block.aspectRatio.width}/${block.aspectRatio.height};height:auto;`
              : 'aspect-ratio:16/9;height:auto;';
          body += `<iframe class="draft-preview__embed-frame" title="${draftEscapeHtml(title)}" src="${draftEscapeHtml(url)}" sandbox="allow-scripts allow-forms allow-presentation" referrerpolicy="no-referrer" loading="lazy" style="width:100%;${sizing}"></iframe>`;
          break;
        }
      }
    }
    parts.push(body || '<p class="draft-preview__empty">Start writing to see a preview.</p>');
    const previewSources = draftSources();
    const previewBacklink = draftBacklink();
    if (previewSources.length || previewBacklink) {
      const items = previewSources.map((source) => `<li><a href="${draftEscapeHtml(source)}">${draftEscapeHtml(draftSourceLabel(source))}</a></li>`);
      if (previewBacklink) items.push(`<li><a href="${draftEscapeHtml(previewBacklink.startsWith('at://') ? `https://pdsls.dev/${previewBacklink}` : previewBacklink)}">${previewBacklink.startsWith('at://') ? 'Original document' : `Source document`}</a> <span>${draftEscapeHtml(draftSourceLabel(previewBacklink))}</span></li>`);
      parts.push(`<section class="draft-preview__sources"><h2>Sources</h2><ul>${items.join('')}</ul></section>`);
    }
    previewEl.innerHTML = parts.join('');
  }

  let previewQueued = false;
  const queuePreview = () => {
    if (previewQueued) return;
    previewQueued = true;
    requestAnimationFrame(() => { previewQueued = false; renderPreview(); });
  };
  const changed = () => { markDirty(); queuePreview(); };

  // --- Spell & grammar checking (Harper, runs locally via WASM) ---
  // Underlines are painted with the Custom Highlight API so the contenteditable
  // DOM is never mutated by the checker. Lints, the personal dictionary and
  // ignored-lint hashes all stay on-device (localStorage + WASM).
  type HarperLint = import('harper.js').Lint;
  type HarperLinter = import('harper.js').Linter;
  type SpellSuggestion = { kind: number; text: string };
  type SpellLint = {
    start: number;
    end: number;
    message: string;
    kind: string;
    suggestions: SpellSuggestion[];
    raw: HarperLint;
  };
  const SPELL_PREF_KEY = 'cc:draft-spellcheck';
  const SPELL_WORDS_KEY = 'cc:harper-words';
  const SPELL_IGNORED_KEY = 'cc:harper-ignored';
  let spellEnabled = (() => {
    try { return localStorage.getItem(SPELL_PREF_KEY) !== 'off'; } catch { return true; }
  })();
  const highlightRegistry = typeof CSS !== 'undefined' && 'highlights' in CSS ? CSS.highlights : undefined;
  const spellButton = toolbar.querySelector<HTMLButtonElement>('[data-spellcheck]');
  const lintStore = new Map<HTMLElement, { version: number; lints: SpellLint[] }>();
  const lintTimers = new Map<HTMLElement, number>();
  let linterPromise: Promise<HarperLinter | undefined> | undefined;
  let popoverLint: { editable: HTMLElement; lint: SpellLint } | undefined;

  const spellPopover = document.createElement('div');
  spellPopover.className = 'draft-spell-pop';
  spellPopover.hidden = true;
  spellPopover.addEventListener('mousedown', (event) => event.preventDefault());
  page.append(spellPopover);

  const getLinter = (): Promise<HarperLinter | undefined> => {
    linterPromise ??= (async () => {
      try {
        const { LocalLinter, Dialect, createBinaryModuleFromUrl } = await import('harper.js');
        const linter = new LocalLinter({
          binary: createBinaryModuleFromUrl('/components/harper_wasm_slim_bg.wasm', 'slim'),
          dialect: Dialect.American,
        });
        await linter.setup();
        try {
          const words = JSON.parse(localStorage.getItem(SPELL_WORDS_KEY) || '[]') as unknown;
          if (Array.isArray(words)) {
            await linter.importWords(words.filter((word): word is string => typeof word === 'string'));
          }
        } catch { /* A corrupt word list is not worth blocking the linter for. */ }
        try {
          const ignored = localStorage.getItem(SPELL_IGNORED_KEY);
          if (ignored) await linter.importIgnoredLints(ignored);
        } catch { /* Same for ignored-lint hashes. */ }
        // The personal dictionary lives as a record on the author's repo so it
        // follows them across browsers; localStorage is just the offline cache.
        try {
          const response = await repoRequest(`com.atproto.repo.getRecord?${new URLSearchParams({
            repo: did,
            collection: DICTIONARY_COLLECTION,
            rkey: DICTIONARY_RKEY,
          })}`);
          if (response.ok) {
            const payload = await response.json() as { value?: { words?: unknown; ignored?: unknown } };
            const remoteWords = Array.isArray(payload.value?.words)
              ? payload.value.words.filter((word): word is string => typeof word === 'string')
              : [];
            if (remoteWords.length) {
              await linter.importWords(remoteWords);
              const merged = [...new Set([...(await linter.exportWords()), ...remoteWords])];
              try { localStorage.setItem(SPELL_WORDS_KEY, JSON.stringify(merged)); } catch { /* cache only */ }
            }
            if (typeof payload.value?.ignored === 'string' && payload.value.ignored) {
              await linter.importIgnoredLints(payload.value.ignored);
            }
          }
        } catch { /* Missing record or pre-permission session — local only. */ }
        return linter as HarperLinter;
      } catch {
        // Offline or the WASM failed to load — checking silently stays off.
        return undefined;
      }
    })();
    return linterPromise;
  };

  const textNodesOf = (editable: HTMLElement) => {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(editable, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
    return nodes;
  };
  const rangeForOffsets = (editable: HTMLElement, start: number, end: number) => {
    const nodes = textNodesOf(editable);
    const range = document.createRange();
    let offset = 0;
    let started = false;
    for (const node of nodes) {
      const next = offset + node.data.length;
      if (!started && start <= next) {
        range.setStart(node, Math.max(0, start - offset));
        started = true;
      }
      if (started && end <= next) {
        range.setEnd(node, Math.max(0, end - offset));
        return range;
      }
      offset = next;
    }
    if (!started || !nodes.length) return undefined;
    const last = nodes[nodes.length - 1];
    range.setEnd(last, last.data.length);
    return range;
  };
  const offsetAt = (editable: HTMLElement, container: Node, offset: number) => {
    const probe = document.createRange();
    probe.selectNodeContents(editable);
    probe.setEnd(container, offset);
    return probe.toString().length;
  };

  const refreshHighlights = () => {
    if (!highlightRegistry) return;
    const spelling: Range[] = [];
    const grammar: Range[] = [];
    if (spellEnabled) {
      for (const [editable, entry] of lintStore) {
        if (!editable.isConnected) { lintStore.delete(editable); continue; }
        for (const lint of entry.lints) {
          const range = rangeForOffsets(editable, lint.start, lint.end);
          if (!range) continue;
          (lint.kind === 'Spelling' ? spelling : grammar).push(range);
        }
      }
    }
    highlightRegistry.set('draft-spell', new Highlight(...spelling));
    highlightRegistry.set('draft-grammar', new Highlight(...grammar));
  };

  // Persist the dictionary locally and to the author's repo (debounced — the
  // record is the source of truth across devices, localStorage the cache).
  let dictionaryTimer: number | undefined;
  const syncDictionary = () => {
    if (dictionaryTimer) window.clearTimeout(dictionaryTimer);
    dictionaryTimer = window.setTimeout(() => {
      dictionaryTimer = undefined;
      void (async () => {
        const linter = await getLinter();
        if (!linter) return;
        const [words, ignored] = await Promise.all([linter.exportWords(), linter.exportIgnoredLints()]);
        try {
          localStorage.setItem(SPELL_WORDS_KEY, JSON.stringify(words));
          localStorage.setItem(SPELL_IGNORED_KEY, ignored);
        } catch { /* cache only */ }
        await repoRequest('com.atproto.repo.putRecord', {
          repo: did,
          collection: DICTIONARY_COLLECTION,
          rkey: DICTIONARY_RKEY,
          record: { $type: DICTIONARY_COLLECTION, words, ignored, updatedAt: new Date().toISOString() },
        }).catch(() => { /* Sessions before the dictionary scope stay local. */ });
      })();
    }, 1500);
  };

  const hidePopover = () => {
    spellPopover.hidden = true;
    popoverLint = undefined;
  };

  const applySuggestion = async (editable: HTMLElement, lint: SpellLint, suggestion: SpellSuggestion) => {
    const range = rangeForOffsets(editable, lint.start, lint.end);
    if (!range) return;
    const selection = window.getSelection();
    if (suggestion.kind === 1) {
      // SuggestionKind.Remove — delete the flagged span entirely.
      range.deleteContents();
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      // Replace selects the flagged span; InsertAfter collapses to its end.
      // insertText goes through the native editing pipeline so the fix is
      // undoable with Cmd/Ctrl+Z; fall back to a manual insert if it declines.
      if (suggestion.kind === 2) range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);
      const beforeLength = (editable.textContent || '').length;
      const expectedLength = suggestion.kind === 2
        ? beforeLength + suggestion.text.length
        : beforeLength - (lint.end - lint.start) + suggestion.text.length;
      const insertedNatively = document.execCommand('insertText', false, suggestion.text);
      // execCommand can report success yet leave the DOM untouched.
      if (!insertedNatively || (editable.textContent || '').length !== expectedLength) {
        if (suggestion.kind !== 2) range.deleteContents();
        else range.collapse(false);
        const inserted = document.createTextNode(suggestion.text);
        range.insertNode(inserted);
        const caret = document.createRange();
        caret.setStartAfter(inserted);
        caret.collapse(true);
        selection?.removeAllRanges();
        selection?.addRange(caret);
      }
    }
    hidePopover();
    editable.focus();
    changed();
    scheduleLint(editable, 250);
  };

  const refreshPopover = () => {
    if (!spellEnabled) { hidePopover(); return; }
    const selection = window.getSelection();
    const anchor = selection?.anchorNode ?? null;
    const host = anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
    const editable = host?.closest<HTMLElement>('.draft-block__editable');
    if (!selection?.rangeCount || !editable || !page.contains(editable)) { hidePopover(); return; }
    const entry = lintStore.get(editable);
    if (!entry?.lints.length) { hidePopover(); return; }
    const range = selection.getRangeAt(0);
    if (!editable.contains(range.startContainer) || !editable.contains(range.endContainer)) { hidePopover(); return; }
    const start = offsetAt(editable, range.startContainer, range.startOffset);
    const end = offsetAt(editable, range.endContainer, range.endOffset);
    const lo = Math.min(start, end);
    const hi = Math.max(start, end);
    const lint = entry.lints.find((item) => lo <= item.end && hi >= item.start);
    if (!lint) { hidePopover(); return; }
    popoverLint = { editable, lint };

    spellPopover.replaceChildren();
    const kind = document.createElement('span');
    kind.className = 'draft-spell-pop__kind';
    kind.textContent = lint.kind === 'Spelling' ? 'Spelling' : 'Grammar';
    const message = document.createElement('p');
    message.className = 'draft-spell-pop__message';
    message.textContent = lint.message;
    spellPopover.append(kind, message);
    for (const suggestion of lint.suggestions.slice(0, 5)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'draft-spell-pop__suggestion';
      const problem = (editable.textContent || '').slice(lint.start, lint.end);
      button.textContent = suggestion.kind === 1 ? `Remove “${problem}”` : suggestion.text;
      button.addEventListener('click', () => void applySuggestion(editable, lint, suggestion));
      spellPopover.append(button);
    }
    const actions = document.createElement('div');
    actions.className = 'draft-spell-pop__actions';
    const minor = (label: string, run: () => void) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'draft-spell-pop__minor';
      button.textContent = label;
      button.addEventListener('click', run);
      actions.append(button);
    };
    if (lint.kind === 'Spelling') {
      minor('Add to dictionary', () => void (async () => {
        const word = (editable.textContent || '').slice(lint.start, lint.end).trim();
        const linter = await getLinter();
        if (!linter || !word) return;
        await linter.importWords([word]);
        syncDictionary();
        hidePopover();
        void runLint(editable);
      })());
    }
    minor('Ignore', () => void (async () => {
      const linter = await getLinter();
      if (!linter) return;
      await linter.ignoreLint(editable.textContent || '', lint.raw);
      syncDictionary();
      hidePopover();
      void runLint(editable);
    })());
    spellPopover.append(actions);

    const rect = rangeForOffsets(editable, lint.start, lint.end)?.getBoundingClientRect();
    if (!rect) { hidePopover(); return; }
    spellPopover.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 316))}px`;
    spellPopover.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 10)}px`;
    spellPopover.hidden = false;
  };

  const runLint = async (editable: HTMLElement) => {
    if (!spellEnabled || !editable.isConnected) return;
    const element = editable.closest<HTMLElement>('[data-block-id]');
    const owner = element ? blockFor(element) : undefined;
    if (!owner || owner.type === 'code') {
      lintStore.delete(editable);
      refreshHighlights();
      return;
    }
    const entry = lintStore.get(editable) || { version: 0, lints: [] };
    entry.version += 1;
    lintStore.set(editable, entry);
    const version = entry.version;
    const linter = await getLinter();
    if (!linter || lintStore.get(editable)?.version !== version) return;
    try {
      const lints = await linter.lint(editable.textContent || '', {
        language: 'plaintext',
        ...(owner.type === 'header' ? { forceAllHeadings: true } : {}),
      });
      if (lintStore.get(editable)?.version !== version) return;
      entry.lints = lints.map((lint) => {
        const span = lint.span();
        return {
          start: span.start,
          end: span.end,
          message: lint.message(),
          kind: lint.lint_kind(),
          suggestions: lint.suggestions().map((item) => ({ kind: item.kind(), text: item.get_replacement_text() })),
          raw: lint,
        };
      });
      refreshHighlights();
      if (popoverLint?.editable === editable) refreshPopover();
    } catch { /* A failed pass keeps the previous marks. */ }
  };
  const scheduleLint = (editable: HTMLElement, delay = 600) => {
    const existing = lintTimers.get(editable);
    if (existing) window.clearTimeout(existing);
    lintTimers.set(editable, window.setTimeout(() => {
      lintTimers.delete(editable);
      void runLint(editable);
    }, delay));
  };
  const lintAll = (delay = 900) => {
    page.querySelectorAll<HTMLElement>('.draft-block__editable').forEach((editable) => scheduleLint(editable, delay));
  };
  const setSpellEnabled = (on: boolean) => {
    spellEnabled = on;
    try { localStorage.setItem(SPELL_PREF_KEY, on ? 'on' : 'off'); } catch { /* preference is best effort */ }
    spellButton?.setAttribute('aria-pressed', String(on));
    page.querySelectorAll<HTMLElement>('.draft-block__editable').forEach((editable) => {
      // While Harper is off the editables fall back to the browser's checker.
      editable.spellcheck = !on;
    });
    if (on) {
      lintAll(150);
      void getLinter();
    } else {
      lintStore.clear();
      refreshHighlights();
      hidePopover();
    }
  };
  spellButton?.setAttribute('aria-pressed', String(spellEnabled));
  spellButton?.addEventListener('click', () => setSpellEnabled(!spellEnabled));
  draftSpellAbort?.abort();
  draftSpellAbort = new AbortController();
  document.addEventListener('selectionchange', refreshPopover, { signal: draftSpellAbort.signal });
  document.addEventListener('scroll', hidePopover, { capture: true, passive: true, signal: draftSpellAbort.signal });
  if (spellEnabled && 'requestIdleCallback' in window) {
    window.requestIdleCallback(() => { void getLinter(); }, { timeout: 4000 });
  }

  // --- Slash commands ---
  // Typing "/" in an editable opens a filterable menu of block commands; Enter
  // deletes the "/query" text and inserts the chosen block below.
  type SlashCommand = { name: string; keywords: string; icon: string; apply: (after: HTMLElement) => void };
  const insertSlashBlock = (after: HTMLElement, type: DraftBlockType, level?: number) => {
    const element = insertBlock({ id: crypto.randomUUID(), type, level }, after);
    const hasEditable = Boolean(element.querySelector('.draft-block__editable'));
    // Structural blocks get a fresh paragraph underneath to keep writing.
    if (!hasEditable) insertBlock({ id: crypto.randomUUID(), type: 'text' }, element);
    const target = element.querySelector<HTMLElement>('.draft-block__editable') || element.querySelector<HTMLElement>('input');
    if (target) { placeCaretAtEnd(target); target.focus(); }
    changed();
  };
  const slashCommands: SlashCommand[] = [
    { name: 'Paragraph', keywords: 'text p', icon: 'fa-solid fa-paragraph', apply: (after) => insertSlashBlock(after, 'text') },
    { name: 'Heading 1', keywords: 'h1 title', icon: '', apply: (after) => insertSlashBlock(after, 'header', 1) },
    { name: 'Heading 2', keywords: 'h2 subtitle', icon: '', apply: (after) => insertSlashBlock(after, 'header', 2) },
    { name: 'Heading 3', keywords: 'h3 section', icon: '', apply: (after) => insertSlashBlock(after, 'header', 3) },
    { name: 'Quote', keywords: 'blockquote callout', icon: 'fa-solid fa-quote-left', apply: (after) => insertSlashBlock(after, 'blockquote') },
    { name: 'Code block', keywords: 'code pre', icon: 'fa-solid fa-file-code', apply: (after) => insertSlashBlock(after, 'code') },
    { name: 'Bulleted list', keywords: 'list bullet ul', icon: 'fa-solid fa-list-ul', apply: (after) => insertSlashBlock(after, 'unorderedList') },
    { name: 'Numbered list', keywords: 'list number ol', icon: 'fa-solid fa-list-ol', apply: (after) => insertSlashBlock(after, 'orderedList') },
    { name: 'Divider', keywords: 'hr rule line separator', icon: 'fa-solid fa-minus', apply: (after) => insertSlashBlock(after, 'horizontalRule') },
    { name: 'Image', keywords: 'picture photo img', icon: 'fa-solid fa-image', apply: (after) => insertSlashBlock(after, 'image') },
    { name: 'Video', keywords: 'film movie', icon: 'fa-solid fa-film', apply: (after) => insertSlashBlock(after, 'video') },
    { name: 'Website embed', keywords: 'embed iframe site', icon: 'fa-solid fa-window-restore', apply: (after) => insertSlashBlock(after, 'embed') },
    { name: 'Link card', keywords: 'website url card link', icon: 'fa-solid fa-globe', apply: (after) => insertSlashBlock(after, 'website') },
    { name: 'Button', keywords: 'cta link button', icon: 'fa-solid fa-square-check', apply: (after) => insertSlashBlock(after, 'button') },
    { name: 'Bluesky post', keywords: 'bsky skeet bluesky', icon: 'fa-brands fa-bluesky', apply: (after) => insertSlashBlock(after, 'bskyPost') },
    { name: 'Math', keywords: 'tex equation formula sum', icon: '', apply: (after) => insertSlashBlock(after, 'math') },
    { name: 'Spell check', keywords: 'check spelling grammar harper', icon: 'fa-solid fa-spell-check', apply: () => setSpellEnabled(!spellEnabled) },
  ];
  const slashMenu = document.createElement('div');
  slashMenu.className = 'draft-slash-menu';
  slashMenu.hidden = true;
  slashMenu.addEventListener('mousedown', (event) => event.preventDefault());
  page.append(slashMenu);
  let slashState: { editable: HTMLElement; slashOffset: number; items: SlashCommand[]; index: number } | undefined;

  const closeSlashMenu = () => {
    slashState = undefined;
    slashMenu.hidden = true;
  };
  const caretTextOffset = (editable: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return -1;
    const range = selection.getRangeAt(0);
    if (!editable.contains(range.startContainer)) return -1;
    return offsetAt(editable, range.startContainer, range.startOffset);
  };
  const renderSlashMenu = () => {
    const state = slashState;
    if (!state) { closeSlashMenu(); return; }
    slashMenu.replaceChildren();
    if (!state.items.length) {
      const empty = document.createElement('p');
      empty.className = 'draft-slash-menu__empty';
      empty.textContent = 'No matching blocks';
      slashMenu.append(empty);
    }
    state.items.forEach((command, itemIndex) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'draft-slash-menu__item';
      item.setAttribute('aria-selected', String(itemIndex === state.index));
      const icon = document.createElement('i');
      icon.className = command.icon || 'fa-solid fa-heading';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = command.name;
      item.append(icon, label);
      item.addEventListener('click', () => applySlashCommand(command));
      slashMenu.append(item);
    });
    // Anchor the menu under the caret.
    const selection = window.getSelection();
    const caretRange = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
    caretRange?.collapse(true);
    const rect = caretRange?.getClientRects()[0] || state.editable.getBoundingClientRect();
    slashMenu.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - 268))}px`;
    slashMenu.style.top = `${Math.min(rect.bottom + 8, window.innerHeight - 320)}px`;
    slashMenu.hidden = false;
  };
  const updateSlashMenu = (editable: HTMLElement) => {
    const element = editable.closest<HTMLElement>('[data-block-id]');
    const owner = element ? blockFor(element) : undefined;
    if (!owner || owner.type === 'code') { closeSlashMenu(); return; }
    const caret = caretTextOffset(editable);
    if (caret < 0) { closeSlashMenu(); return; }
    const before = (editable.textContent || '').slice(0, caret);
    const match = before.match(/(?:^|\s)\/([a-z0-9]*)$/i);
    if (!match) { closeSlashMenu(); return; }
    const query = match[1].toLowerCase();
    const items = slashCommands.filter((command) =>
      `${command.name} ${command.keywords}`.toLowerCase().includes(query));
    const slashOffset = caret - query.length - 1;
    if (slashState?.editable === editable && slashState.slashOffset === slashOffset) {
      slashState.items = items;
      if (slashState.index >= items.length) slashState.index = 0;
    } else {
      slashState = { editable, slashOffset, items, index: 0 };
    }
    renderSlashMenu();
  };
  const applySlashCommand = (command: SlashCommand) => {
    const state = slashState;
    if (!state) return;
    const caret = caretTextOffset(state.editable);
    if (caret >= 0) {
      const range = rangeForOffsets(state.editable, state.slashOffset, caret);
      range?.deleteContents();
      changed();
      scheduleLint(state.editable, 200);
    }
    const element = state.editable.closest<HTMLElement>('[data-block-id]');
    closeSlashMenu();
    if (element) command.apply(element);
  };
  // Returns true when the keydown was consumed by the open menu — callers should
  // stopImmediatePropagation so Enter doesn't also split the block.
  const slashMenuKeydown = (editable: HTMLElement, event: KeyboardEvent): boolean => {
    if (!slashState) return false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const count = slashState.items.length;
      if (count) slashState.index = (slashState.index + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
      renderSlashMenu();
      return true;
    }
    if (event.key === 'Enter' || event.key === 'Tab') {
      const command = slashState.items[slashState.index];
      if (command) applySlashCommand(command);
      return true;
    }
    if (event.key === 'Escape') { closeSlashMenu(); return true; }
    // Caret moved away by mouse/keys — recompute on next selectionchange.
    return false;
  };
  document.addEventListener('selectionchange', () => {
    if (!slashState) return;
    const editable = slashState.editable;
    const caret = caretTextOffset(editable);
    // Keep the menu only while the caret sits inside the "/query" text.
    if (caret <= slashState.slashOffset || caret < 0) closeSlashMenu(); else updateSlashMenu(editable);
  }, { signal: draftSpellAbort.signal });
  document.addEventListener('scroll', closeSlashMenu, { capture: true, passive: true, signal: draftSpellAbort.signal });

  // --- Document keyboard shortcuts (Google Docs-style) ---
  // Cmd/Ctrl+B/I/U/Z already come free with contenteditable; these add the rest.
  const docShortcut = (editable: HTMLElement, event: KeyboardEvent): boolean => {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return false;
    const element = editable.closest<HTMLElement>('[data-block-id]');
    const inline = (command: string) => { document.execCommand(command); changed(); return true; };
    const convert = (type: DraftBlockType, level?: number) => {
      if (!element) return false;
      convertBlock(element, type, level);
      return true;
    };
    const align = (alignment: string) => {
      const block = element ? blockFor(element) : undefined;
      if (!block || !element) return false;
      block.alignment = block.alignment === alignment ? undefined : alignment;
      element.dataset.align = block.alignment || '';
      changed();
      return true;
    };
    if (event.altKey) {
      // Cmd/Ctrl+Alt+0..3 — paragraph / headings.
      const level = { Digit0: 0, Digit1: 1, Digit2: 2, Digit3: 3 }[event.code];
      if (level !== undefined) return convert(level === 0 ? 'text' : 'header', level || undefined);
      return false;
    }
    if (event.shiftKey) {
      switch (event.code) {
        case 'KeyX': return inline('strikeThrough');
        case 'Digit7': return convert('orderedList');
        case 'Digit8': return convert('unorderedList');
        case 'KeyL': return align('#textAlignLeft');
        case 'KeyE': return align('#textAlignCenter');
        case 'KeyR': return align('#textAlignRight');
        case 'KeyJ': return align('#textAlignJustify');
        default: return false;
      }
    }
    if (event.code === 'Backslash') {
      clearFormattingForSelection();
      return true;
    }
    if (event.code === 'KeyK') {
      const url = window.prompt('Link URL (leave empty to remove a link):');
      if (url === null) return true;
      if (url.trim()) document.execCommand('createLink', false, url.trim());
      else document.execCommand('unlink');
      changed();
      return true;
    }
    return false;
  };

  // --- Arrow-key block navigation ---
  // Up on the first visual line / Down on the last (and Left/Right at the
  // edges) moves the caret into the adjacent block's editable.
  const focusEditableAt = (editable: HTMLElement, atStart: boolean) => {
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(atStart);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    editable.focus();
  };
  const caretLineEdge = (editable: HTMLElement, edge: 'first' | 'last') => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const caretRect = selection.getRangeAt(0).getClientRects()[0]
      || selection.getRangeAt(0).getBoundingClientRect();
    const length = (editable.textContent || '').length;
    if (!length) return true;
    const edgeRect = rangeForOffsets(editable, edge === 'first' ? 0 : length - 1, edge === 'first' ? 1 : length)
      ?.getClientRects()[0];
    if (!caretRect || !edgeRect) return false;
    return Math.abs(caretRect.top - edgeRect.top) < 4;
  };
  const blockNavKeydown = (editable: HTMLElement, event: KeyboardEvent): boolean => {
    const editables = [...page.querySelectorAll<HTMLElement>('.draft-block__editable')];
    const index = editables.indexOf(editable);
    if (index < 0) return false;
    const caret = caretTextOffset(editable);
    const length = (editable.textContent || '').length;
    if (event.key === 'ArrowUp' && caretLineEdge(editable, 'first')) {
      const target = editables[index - 1];
      if (target) focusEditableAt(target, false);
      return Boolean(target);
    }
    if (event.key === 'ArrowDown' && caretLineEdge(editable, 'last')) {
      const target = editables[index + 1];
      if (target) focusEditableAt(target, true);
      return Boolean(target);
    }
    if (event.key === 'ArrowLeft' && caret === 0) {
      const target = editables[index - 1];
      if (target) focusEditableAt(target, false);
      return Boolean(target);
    }
    if (event.key === 'ArrowRight' && caret === length) {
      const target = editables[index + 1];
      if (target) focusEditableAt(target, true);
      return Boolean(target);
    }
    return false;
  };

  const caretAtStart = (editable: HTMLElement) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || !selection.isCollapsed) return false;
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(editable);
    range.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
    return range.toString().length === 0;
  }

  const placeCaretAtEnd = (editable: HTMLElement) => {
    const range = document.createRange();
    range.selectNodeContents(editable);
    range.collapse(false);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  const makeEditable = (block: DraftBlock, itemHtml = '', className = 'draft-block__editable') => {
    const editable = document.createElement('div');
    editable.className = className;
    editable.contentEditable = 'true';
    editable.spellcheck = !spellEnabled;
    editable.dataset.placeholder = draftBlockLabel[block.type];
    editable.innerHTML = itemHtml;
    editable.addEventListener('input', changed);
    editable.addEventListener('input', () => scheduleLint(editable));
    editable.addEventListener('input', () => updateSlashMenu(editable));
    editable.addEventListener('blur', () => window.setTimeout(hidePopover, 120));
    editable.addEventListener('blur', () => window.setTimeout(closeSlashMenu, 120));
    scheduleLint(editable, 1500);
    editable.addEventListener('keydown', (event) => {
      if (slashMenuKeydown(editable, event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (docShortcut(editable, event)) { event.preventDefault(); return; }
      if (blockNavKeydown(editable, event)) event.preventDefault();
    });
    editable.addEventListener('keydown', (event) => {
      const element = editable.closest<HTMLElement>('[data-block-id]');
      const owner = element ? blockFor(element) : undefined;
      if (!element || !owner) return;
      if (event.key === 'Enter' && !event.shiftKey && owner.type !== 'code') {
        event.preventDefault();
        const selection = window.getSelection();
        const fragment = document.createDocumentFragment();
        if (selection?.rangeCount) {
          const range = selection.getRangeAt(0);
          const post = range.cloneRange();
          post.selectNodeContents(editable);
          post.setStart(range.endContainer, range.endOffset);
          fragment.append(post.extractContents());
        }
        if (editable.classList.contains('draft-block__item-editable')) {
          const row = document.createElement('div');
          row.className = 'draft-block__item-row';
          const next = makeEditable(owner, '', 'draft-block__editable draft-block__item-editable');
          next.append(fragment);
          row.append(next);
          editable.closest('.draft-block__item-row')?.after(row);
          placeCaretAtEnd(next);
          next.focus();
        } else {
          const next = insertBlock({ id: crypto.randomUUID(), type: 'text' }, element);
          const nextEditable = next.querySelector<HTMLElement>('.draft-block__editable');
          nextEditable?.append(fragment);
          if (nextEditable) { nextEditable.focus(); }
        }
        changed();
        return;
      }
      if (event.key === 'Backspace' && selectionAtStart(editable)) {
        if (editable.classList.contains('draft-block__item-editable')) {
          const rows = element.querySelectorAll('.draft-block__item-editable');
          if (rows.length <= 1) {
            event.preventDefault();
            convertBlock(element, 'text');
            return;
          }
          const row = editable.closest<HTMLElement>('.draft-block__item-row');
          const previous = row?.previousElementSibling?.querySelector<HTMLElement>('.draft-block__item-editable');
          if (previous && (editable.textContent || '') === '') {
            event.preventDefault();
            row?.remove();
            placeCaretAtEnd(previous);
            previous.focus();
            changed();
          }
          return;
        }
        const previous = element.previousElementSibling as HTMLElement | null;
        if ((editable.textContent || '') === '') {
          event.preventDefault();
          if (state.blocks.length > 1) {
            removeBlock(element);
            const target = previous?.querySelector<HTMLElement>('.draft-block__editable:not(.draft-block__item-editable)')
              || previous?.querySelector<HTMLElement>('.draft-block__item-editable');
            if (target) { placeCaretAtEnd(target); target.focus(); }
          }
          return;
        }
        if (previous && caretAtStart(editable)) {
          const previousEditable = previous.querySelector<HTMLElement>('.draft-block__editable:not(.draft-block__item-editable)')
            || previous.querySelector<HTMLElement>('.draft-block__item-editable');
          if (!previousEditable) return;
          event.preventDefault();
          const marker = previousEditable.childNodes.length;
          previousEditable.append(...editable.childNodes);
          removeBlock(element);
          const range = document.createRange();
          const target = previousEditable.childNodes[marker - 1] || previousEditable;
          range.setStartAfter(target);
          range.collapse(true);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
          previousEditable.focus();
          changed();
        }
      }
    });
    const selectionAtStart = (el: HTMLElement) => {
      const selection = window.getSelection();
      if (!selection?.rangeCount || !selection.isCollapsed) return false;
      return caretAtStart(el);
    };
    return editable;
  };

  const removeBlock = (element: HTMLElement) => {
    const block = blockFor(element);
    if (block) {
      state.blocks = state.blocks.filter((item) => item !== block);
      state.blockElements.delete(block.id);
    }
    element.remove();
    changed();
  }

  const createField = (label: string, field: string, value: string, placeholder = '') => {
    const input = document.createElement('input');
    input.dataset.field = field;
    input.value = value;
    input.placeholder = placeholder || label;
    input.setAttribute('aria-label', label);
    input.addEventListener('input', changed);
    return input;
  }

  const createBlockElement = (block: DraftBlock, innerHtml = ''): HTMLElement => {
    const element = document.createElement('div');
    element.className = 'draft-block';
    element.dataset.blockId = block.id;
    element.dataset.type = block.type;
    if (block.level) element.dataset.level = String(block.level);
    if (block.alignment) element.dataset.align = block.alignment;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'draft-block__remove';
    remove.textContent = '×';
    remove.title = 'Remove block';
    remove.addEventListener('click', () => removeBlock(element));
    element.append(remove);

    if (DRAFT_TEXT_TYPES.includes(block.type)) {
      element.append(makeEditable(block, innerHtml));
      if (block.type === 'code') {
        const language = createField('Code language (optional)', 'language', block.language || '', 'Language');
        element.append(language);
      }
      return element;
    }
    if (block.type === 'unorderedList' || block.type === 'orderedList') {
      const rows = innerHtml ? [innerHtml] : [''];
      for (const html of rows) {
        const row = document.createElement('div');
        row.className = 'draft-block__item-row';
        row.append(makeEditable(block, html, 'draft-block__editable draft-block__item-editable'));
        element.append(row);
      }
      return element;
    }
    if (block.type === 'horizontalRule') {
      const rule = document.createElement('hr');
      rule.className = 'draft-block__hr';
      element.append(rule);
      return element;
    }
    const fields = document.createElement('div');
    fields.className = 'draft-block__fields';
    if (block.type === 'image') {
      const preview = document.createElement('div');
      preview.className = 'draft-block__image';
      const show = (url?: string) => {
        preview.replaceChildren();
        if (url) {
          const img = document.createElement('img');
          img.src = url;
          img.alt = '';
          preview.append(img);
        }
      };
      show(block.imageObjectUrl);
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.setAttribute('aria-label', 'Block image');
      file.addEventListener('change', async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        statusEl.textContent = 'Uploading image…';
        try {
          block.image = await uploadAuthorImage(picked);
          const url = URL.createObjectURL(picked);
          block.imageObjectUrl = url;
          const dims = await new Promise<{ width: number; height: number }>((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
            img.onerror = () => resolve({ width: 1, height: 1 });
            img.src = url;
          });
          block.aspectRatio = dims;
          show(url);
          statusEl.textContent = '';
          changed();
        } catch (error) {
          statusEl.textContent = errorMessage(error);
        }
      });
      const alt = createField('Alt text', 'alt', block.alt || '', 'Describe this image');
      fields.append(file, preview, alt);
      element.append(fields);
      return element;
    }
    if (block.type === 'video') {
      const preview = document.createElement('div');
      preview.className = 'draft-block__video';
      const show = (url?: string) => {
        preview.replaceChildren();
        if (url) {
          const player = document.createElement('video');
          player.src = url;
          player.controls = true;
          player.preload = 'metadata';
          player.playsInline = true;
          preview.append(player);
        }
      };
      show(block.videoObjectUrl || block.video);
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'video/*';
      file.setAttribute('aria-label', 'Block video');
      file.addEventListener('change', async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        statusEl.textContent = 'Uploading video…';
        try {
          const uploaded = await uploadAuthorVideo(picked);
          block.video = uploaded.url;
          block.mimeType = uploaded.mimeType;
          const url = URL.createObjectURL(picked);
          block.videoObjectUrl = url;
          block.aspectRatio = await new Promise<{ width: number; height: number }>((resolve) => {
            const probe = document.createElement('video');
            probe.preload = 'metadata';
            probe.onloadedmetadata = () => resolve({ width: probe.videoWidth || 16, height: probe.videoHeight || 9 });
            probe.onerror = () => resolve({ width: 16, height: 9 });
            probe.src = url;
          });
          show(url);
          statusEl.textContent = '';
          changed();
        } catch (error) {
          statusEl.textContent = errorMessage(error);
        }
      });
      const alt = createField('Video description', 'alt', block.alt || '', 'Describe this video');
      fields.append(file, preview, alt);
      element.append(fields);
      return element;
    }
    if (block.type === 'button') {
      fields.append(
        createField('Button text', 'label', block.label || '', 'Button text'),
        createField('Button link URL', 'url', block.url || '', 'https://…'),
      );
      element.append(fields);
      return element;
    }
    if (block.type === 'website') {
      fields.append(
        createField('Link URL', 'url', block.url || '', 'https://…'),
        createField('Card title (optional)', 'title', block.title || '', 'Title'),
        createField('Card description (optional)', 'description', block.description || '', 'Description'),
      );
      element.append(fields);
      return element;
    }
    if (block.type === 'bskyPost') {
      fields.append(createField('Bluesky post URL or at:// URI', 'url', block.url || '', 'https://bsky.app/profile/…/post/…'));
      element.append(fields);
      return element;
    }
    if (block.type === 'embed') {
      const height = createField('Height in px (optional)', 'height', block.height ? String(block.height) : '', 'Default 16:9');
      height.inputMode = 'numeric';
      fields.append(
        createField('Embed URL', 'url', block.url || '', 'https://…'),
        createField('Embed title (optional)', 'title', block.title || '', 'Embedded website'),
        height,
      );
      element.append(fields);
      return element;
    }
    if (block.type === 'math') {
      fields.append(createField('TeX expression', 'tex', block.tex || '', 'e = mc^2'));
      element.append(fields);
      return element;
    }
    return element;
  }

  const insertBlock = (block: DraftBlock, after: HTMLElement | undefined, innerHtml = ''): HTMLElement => {
    const element = createBlockElement(block, innerHtml);
    state.blockElements.set(block.id, element);
    const index = state.blocks.length;
    state.blocks.push(block);
    if (after && after.parentElement === blocksEl) {
      const afterBlock = blockFor(after);
      if (afterBlock) {
        const afterIndex = state.blocks.indexOf(afterBlock);
        state.blocks.splice(index, 1);
        state.blocks.splice(afterIndex + 1, 0, block);
      }
      after.after(element);
    } else {
      blocksEl.append(element);
    }
    return element;
  }

  const convertBlock = (element: HTMLElement, type: DraftBlockType, level?: number) => {
    const block = blockFor(element);
    if (!block) return;
    const editable = element.querySelector<HTMLElement>('.draft-block__editable');
    const html = editable?.innerHTML || '';
    block.type = type;
    block.level = level;
    const replacement = createBlockElement(block, html);
    state.blockElements.set(block.id, replacement);
    element.replaceWith(replacement);
    const target = replacement.querySelector<HTMLElement>('.draft-block__editable');
    if (target) { target.focus(); placeCaretAtEnd(target); }
    changed();
  }

  // --- Import (Markdown / Word) ---
  // Reduce imported HTML to the inline tags the editor's facet serializer
  // understands: everything else is unwrapped, scripts/media dropped.
  const sanitizeImportedHtml = (root: HTMLElement) => {
    const allowed = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'INS', 'S', 'STRIKE', 'DEL', 'CODE', 'MARK', 'A', 'BR']);
    const dropped = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'IMG', 'VIDEO', 'AUDIO', 'SVG', 'TEMPLATE']);
    const clean = (node: ChildNode) => {
      if (!(node instanceof HTMLElement)) return;
      const tag = node.tagName;
      if (dropped.has(tag)) { node.remove(); return; }
      [...node.childNodes].forEach(clean);
      if (allowed.has(tag)) {
        if (tag === 'A') {
          const href = node.getAttribute('href') || '';
          if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) {
            [...node.attributes].forEach((attr) => { if (attr.name !== 'href') node.removeAttribute(attr.name); });
          } else {
            node.replaceWith(...node.childNodes);
          }
        } else {
          [...node.attributes].forEach((attr) => node.removeAttribute(attr.name));
        }
      } else {
        node.replaceWith(...node.childNodes);
      }
    };
    [...root.childNodes].forEach(clean);
  };

  // Strip pasted formatting (backgrounds, font sizes, foreign spans) back to
  // the editor's inline vocabulary. Applies to the selection when there is
  // one, otherwise the whole block.
  const clearFormatting = (editable: HTMLElement) => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
    if (range && !range.collapsed
      && editable.contains(range.startContainer) && editable.contains(range.endContainer)) {
      const probe = document.createElement('div');
      probe.append(range.extractContents());
      sanitizeImportedHtml(probe);
      const inserted = [...probe.childNodes];
      const fragment = document.createDocumentFragment();
      fragment.append(...inserted);
      range.insertNode(fragment);
      if (inserted.length) {
        const reselect = document.createRange();
        reselect.setStartBefore(inserted[0]);
        reselect.setEndAfter(inserted[inserted.length - 1]);
        selection?.removeAllRanges();
        selection?.addRange(reselect);
      }
    } else {
      sanitizeImportedHtml(editable);
      editable.normalize();
    }
    changed();
    scheduleLint(editable, 200);
  };
  const clearFormattingForSelection = () => {
    const anchor = window.getSelection()?.anchorNode;
    const host = anchor instanceof HTMLElement ? anchor : anchor?.parentElement;
    const editable = host?.closest<HTMLElement>('.draft-block__editable');
    if (editable && page.contains(editable)) clearFormatting(editable);
  };

  type ImportedBlock = { model: DraftBlock; html?: string; rows?: string[] };
  const draftBlocksFromHtml = (html: string): ImportedBlock[] => {
    const container = document.createElement('div');
    container.innerHTML = html;
    sanitizeImportedHtml(container);
    const out: ImportedBlock[] = [];
    const pushText = (inner: string, type: DraftBlockType = 'text') => {
      const probe = document.createElement('div');
      probe.innerHTML = inner;
      if (!(probe.textContent || '').trim()) return;
      out.push({ model: { id: crypto.randomUUID(), type }, html: inner });
    };
    const visit = (element: Element) => {
      const tag = element.tagName;
      if (/^H[1-6]$/.test(tag)) {
        out.push({ model: { id: crypto.randomUUID(), type: 'header', level: Number(tag[1]) }, html: element.innerHTML });
      } else if (tag === 'P') {
        pushText(element.innerHTML);
      } else if (tag === 'BLOCKQUOTE') {
        // Flatten nested paragraphs inside quotes into line breaks.
        const probe = element.cloneNode(true) as HTMLElement;
        probe.querySelectorAll('p').forEach((p) => p.replaceWith(...p.childNodes, document.createElement('br')));
        pushText(probe.innerHTML, 'blockquote');
      } else if (tag === 'PRE') {
        const code = element.querySelector('code') || element;
        const language = (code.getAttribute('class') || '').match(/language-([a-zA-Z0-9#+_-]{1,40})/)?.[1] || '';
        const plaintext = code.textContent || '';
        if (plaintext.trim()) {
          out.push({ model: { id: crypto.randomUUID(), type: 'code', language }, html: draftEscapeHtml(plaintext) });
        }
      } else if (tag === 'UL' || tag === 'OL') {
        const rows = [...element.children]
          .filter((item) => item.tagName === 'LI')
          .map((item) => item.innerHTML)
          .filter((inner) => {
            const probe = document.createElement('div');
            probe.innerHTML = inner;
            return (probe.textContent || '').trim().length > 0;
          });
        if (rows.length) {
          out.push({ model: { id: crypto.randomUUID(), type: tag === 'OL' ? 'orderedList' : 'unorderedList' }, rows });
        }
      } else if (tag === 'HR') {
        out.push({ model: { id: crypto.randomUUID(), type: 'horizontalRule' } });
      } else if (tag === 'DIV' || tag === 'SECTION' || tag === 'ARTICLE' || tag === 'MAIN' || tag === 'BODY') {
        [...element.children].forEach(visit);
      } else {
        pushText(element.innerHTML || element.textContent || '');
      }
    };
    [...container.children].forEach(visit);
    return out;
  };

  const insertImportedBlock = ({ model, html = '', rows }: ImportedBlock) => {
    const isList = model.type === 'unorderedList' || model.type === 'orderedList';
    const element = insertBlock(model, undefined, isList ? (rows?.[0] || '') : html);
    if (isList) {
      for (const rowHtml of (rows || []).slice(1)) {
        const row = document.createElement('div');
        row.className = 'draft-block__item-row';
        row.append(makeEditable(model, rowHtml, 'draft-block__editable draft-block__item-editable'));
        element.append(row);
      }
    }
    return element;
  };

  const importFile = async (file: File) => {
    statusEl.textContent = `Importing ${file.name}…`;
    let html = '';
    if (/\.docx$/i.test(file.name)) {
      await import('mammoth/mammoth.browser.js');
      const mammoth = (window as { mammoth?: { convertToHtml: (input: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }> } }).mammoth;
      if (!mammoth) throw new Error('The Word importer failed to load.');
      html = (await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() })).value;
    } else {
      const { marked } = await import('marked');
      html = await marked.parse(await file.text());
    }
    const imported = draftBlocksFromHtml(html);
    if (!imported.length) throw new Error('Nothing importable was found in that file.');
    // Replace the lone empty starter block rather than appending below it.
    if (state.blocks.length === 1) {
      const only = state.blocks[0];
      const onlyElement = state.blockElements.get(only.id);
      if (only.type === 'text' && onlyElement && !(onlyElement.textContent || '').trim()) removeBlock(onlyElement);
    }
    imported.forEach(insertImportedBlock);
    if (!titleInput.value.trim()) {
      titleInput.value = file.name.replace(/\.(md|markdown|mdx|docx)$/i, '');
    }
    changed();
    statusEl.textContent = `Imported ${file.name}.`;
  };
  importButton?.addEventListener('click', () => importInput?.click());
  importInput?.addEventListener('change', () => {
    const file = importInput.files?.[0];
    importInput.value = '';
    if (!file) return;
    importFile(file).catch((error) => {
      statusEl.textContent = errorMessage(error);
    });
  });

  const toggleInlineCode = () => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const ancestor = range.commonAncestorContainer;
    const host = ancestor instanceof HTMLElement ? ancestor : ancestor.parentElement;
    const code = host?.closest('code');
    if (code && code.parentElement) {
      const parent = code.parentElement;
      while (code.firstChild) parent.insertBefore(code.firstChild, code);
      parent.removeChild(code);
      parent.normalize();
    } else {
      const element = document.createElement('code');
      try {
        range.surroundContents(element);
      } catch {
        element.append(range.extractContents());
        range.insertNode(element);
      }
    }
    changed();
  }

  toolbar.addEventListener('mousedown', (event) => event.preventDefault());
  toolbar.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button) return;
    if (button.hasAttribute('data-clear-format')) { clearFormattingForSelection(); return; }
    const command = button.dataset.cmd;
    if (command === 'inlineCode') { toggleInlineCode(); return; }
    if (command === 'link') {
      const url = window.prompt('Link URL (leave empty to remove a link):');
      if (url === null) return;
      if (url.trim()) document.execCommand('createLink', false, url.trim());
      else document.execCommand('unlink');
      changed();
      return;
    }
    if (command) {
      document.execCommand(command);
      changed();
      return;
    }
    const align = button.dataset.align;
    const current = currentBlockElement();
    if (align) {
      const block = current ? blockFor(current) : undefined;
      if (block && current) {
        block.alignment = block.alignment === align ? undefined : align;
        current.dataset.align = block.alignment || '';
        changed();
      }
      return;
    }
    const blockSpec = button.dataset.block;
    if (!blockSpec) return;
    const [type, level] = blockSpec.split(':') as [DraftBlockType, string?];
    const structural: DraftBlockType[] = ['horizontalRule', 'image', 'video', 'button', 'website', 'bskyPost', 'math', 'embed'];
    if (DRAFT_TEXT_TYPES.includes(type) || type === 'unorderedList' || type === 'orderedList') {
      if (current) convertBlock(current, type, level ? Number(level) : undefined);
      else {
        const element = insertBlock({ id: crypto.randomUUID(), type, level: level ? Number(level) : undefined }, undefined);
        element.querySelector<HTMLElement>('.draft-block__editable')?.focus();
      }
      return;
    }
    if (structural.includes(type)) {
      const block: DraftBlock = { id: crypto.randomUUID(), type };
      const element = insertBlock(block, current);
      // Leave a fresh paragraph underneath so writing can continue.
      insertBlock({ id: crypto.randomUUID(), type: 'text' }, element);
      element.querySelector('input')?.focus();
      changed();
    }
  });

  [titleInput, descriptionInput, tagsInput, publicationInput, sourcesInput, backlinkInput, ...(coauthorsInput ? [coauthorsInput] : [])]
    .forEach((input) => input.addEventListener('input', changed));
  coverInput.addEventListener('change', async () => {
    const picked = coverInput.files?.[0];
    if (!picked) return;
    statusEl.textContent = 'Uploading cover image…';
    try {
      state.cover = await uploadAuthorImage(picked);
      if (state.coverObjectUrl) URL.revokeObjectURL(state.coverObjectUrl);
      state.coverObjectUrl = URL.createObjectURL(picked);
      coverRemoveInput.checked = false;
      statusEl.textContent = '';
      changed();
    } catch (error) {
      statusEl.textContent = errorMessage(error);
    }
  });
  coverRemoveInput.addEventListener('change', () => {
    if (coverRemoveInput.checked) {
      state.cover = undefined;
      if (state.coverObjectUrl) { URL.revokeObjectURL(state.coverObjectUrl); state.coverObjectUrl = undefined; }
    }
    changed();
  });

  const resolveBskyPostRef = async (input: string): Promise<{ uri: string; cid: string }> => {
    let uri = input.trim();
    const web = uri.match(/^https?:\/\/(?:www\.)?bsky\.app\/profile\/([^/]+)\/post\/([a-zA-Z0-9._~:-]+)/);
    if (web) {
      const profile: { did?: string } = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(web[1])}`)
        .then(async (response): Promise<{ did?: string }> => response.ok ? await response.json() as { did?: string } : {});
      if (!profile.did) throw new Error(`Could not resolve the Bluesky account "${web[1]}".`);
      uri = `at://${profile.did}/app.bsky.feed.post/${web[2]}`;
    }
    if (!/^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/app\.bsky\.feed\.post\/[a-zA-Z0-9._~:-]+$/.test(uri)) {
      throw new Error('A Bluesky post block needs a bsky.app post link or an at:// post URI.');
    }
    const posts: { posts?: Array<{ cid?: string }> } = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=${encodeURIComponent(uri)}`)
      .then(async (response): Promise<{ posts?: Array<{ cid?: string }> }> => response.ok ? await response.json() as { posts?: Array<{ cid?: string }> } : {});
    const cid = posts.posts?.[0]?.cid;
    if (!cid) throw new Error('That Bluesky post could not be found.');
    return { uri, cid };
  }

  const serializeDraft = () => {
    const document: Record<string, unknown> = {
      $type: 'pub.leaflet.document',
      author: did,
      title: titleInput.value.trim() || 'Untitled',
      pages: [{
        $type: 'pub.leaflet.pages.linearDocument',
        blocks: state.blocks.flatMap((block) => {
          const element = state.blockElements.get(block.id);
          if (!element) return [];
          const serialized = serializeBlock(block, element);
          if (!serialized) return [];
          return [{ block: serialized, ...(block.alignment && block.alignment !== '#textAlignLeft' ? { alignment: block.alignment } : {}) }];
        }),
      }],
    };
    const description = descriptionInput.value.trim();
    if (description) document.description = description;
    const tags = tagsInput.value.split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 25);
    if (tags.length) document.tags = tags;
    const publication = publicationInput.value.trim();
    if (publication) {
      if (!/^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/(pub\.leaflet\.publication|site\.standard\.publication)\/[a-zA-Z0-9._~:-]+$/.test(publication)) {
        throw new Error('The publication must be an at:// URI of a pub.leaflet.publication or site.standard.publication record.');
      }
      document.publication = publication;
    }
    if (state.cover) document.coverImage = state.cover;
    return document;
  }

  let cachedAuthorHandle: string | undefined;
  const draftAuthorHandle = async (): Promise<string> => {
    if (cachedAuthorHandle) return cachedAuthorHandle;
    const known = loadKnownAccounts().find((account) => account.did === did)?.handle;
    if (known) {
      cachedAuthorHandle = known;
      return known;
    }
    try {
      const response = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`);
      if (response.ok) {
        const profile = await response.json() as { handle?: unknown };
        if (typeof profile.handle === 'string' && profile.handle) {
          cachedAuthorHandle = profile.handle;
          return profile.handle;
        }
      }
    } catch { /* Fall through to the publication path hint. */ }
    return did;
  };
  const draftSources = () => [...new Set(sourcesInput.value.split('\n').map((line) => line.trim()).filter(Boolean))];
  const draftBacklink = () => backlinkInput.value.trim();
  const draftSourceLabel = (value: string) => {
    if (value.startsWith('at://')) return value;
    try { return new URL(value).hostname.replace(/^www\./, ''); } catch { return value; }
  };
  const isHttpUrl = (value: string) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
      return false;
    }
  };
  const metadataValidationError = () => {
    const invalid = draftSources().find((source) => !isHttpUrl(source));
    if (invalid) return `"${invalid}" is not a valid http(s) URL.`;
    const backlink = draftBacklink();
    if (backlink && !isHttpUrl(backlink) && !/^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/[a-zA-Z0-9.]+\/[a-zA-Z0-9._~:-]+$/.test(backlink)) {
      return 'The source document must be a valid URL or at:// URI.';
    }
    return '';
  };

  let lastWrittenMetadata = '';
  const syncPostMetadata = async () => {
    const postRkey = state.postUri?.split('/').pop() || '';
    if (!postRkey) return;
    const sources = draftSources();
    const backlink = draftBacklink();
    const key = JSON.stringify({ postRkey, sources, backlink });
    if (key === lastWrittenMetadata) return;
    if (!sources.length && !backlink) {
      if (state.metadataExisted) {
        await repoRequest('com.atproto.repo.deleteRecord', { repo: did, collection: POST_METADATA_COLLECTION, rkey: postRkey });
      }
      state.metadataExisted = false;
      state.metadataCreatedAt = undefined;
      lastWrittenMetadata = key;
      return;
    }
    state.metadataCreatedAt = state.metadataCreatedAt || new Date().toISOString();
    const record: Record<string, unknown> = { $type: POST_METADATA_COLLECTION, createdAt: state.metadataCreatedAt };
    if (sources.length) record.sources = sources;
    if (backlink) record.backlink = backlink;
    await repoRequest('com.atproto.repo.putRecord', { repo: did, collection: POST_METADATA_COLLECTION, rkey: postRkey, record });
    state.metadataExisted = true;
    lastWrittenMetadata = key;
  };

  const publicationUrls = new Map<string, string>();
  const loadDraftPublications = async () => {
    const publications: Array<{ uri: string; label: string }> = [];
    for (const collection of ['site.standard.publication', 'pub.leaflet.publication'] as const) {
      try {
        const query = new URLSearchParams({ repo: did, collection, limit: '100' });
        const response = await repoRequest(`com.atproto.repo.listRecords?${query}`);
        const payload = await response.json() as {
          records?: Array<{ uri?: unknown; value?: Record<string, unknown> }>;
        };
        for (const record of payload.records || []) {
          if (typeof record.uri !== 'string') continue;
          const value = record.value || {};
          if (typeof value.url === 'string' && value.url) publicationUrls.set(record.uri, value.url);
          const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim()
            : typeof value.title === 'string' && value.title.trim() ? value.title.trim()
            : record.uri.split('/').pop() || record.uri;
          publications.push({ uri: record.uri, label: name });
        }
      } catch { /* A missing collection just means no publications of that type. */ }
    }
    const previous = publicationInput.value;
    publicationInput.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = publications.length ? 'No publication' : 'No publications found in your repository';
    publicationInput.append(none);
    for (const publication of publications) {
      const option = document.createElement('option');
      option.value = publication.uri;
      option.textContent = publication.label;
      publicationInput.append(option);
    }
    if (previous && !publications.some((publication) => publication.uri === previous)) {
      const option = document.createElement('option');
      option.value = previous;
      option.textContent = previous;
      publicationInput.append(option);
    }
    publicationInput.value = previous;
    return publications;
  };

  const resolvePendingPostRefs = async () => {
    for (const block of state.blocks) {
      if (block.type === 'bskyPost' && !block.postRef) {
        const element = state.blockElements.get(block.id);
        const input = element?.querySelector<HTMLInputElement>('[data-field="url"]')?.value.trim();
        if (input) block.postRef = await resolveBskyPostRef(input);
      }
    }
  };

  const draftPlainText = (pages: unknown): string => {
    const texts: string[] = [];
    const read = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(read); return; }
      const record = node as Record<string, unknown>;
      if (typeof record.plaintext === 'string' && record.plaintext.trim()) texts.push(record.plaintext.trim());
      read(record.children);
      read(record.content);
      read(record.block);
      read(record.pages);
      read(record.blocks);
    };
    read(pages);
    return texts.join('\n\n').slice(0, 30000);
  };

  const showPublishedLink = () => {
    publishButton.innerHTML = state.publishedUri
      ? '<i class="fa-solid fa-rotate" aria-hidden="true"></i> Update'
      : '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Publish';
    if (!publishedLink) return;
    const postMatch = state.postUri?.match(/^at:\/\/[^/]+\/site\.standard\.document\/([a-zA-Z0-9._~:-]+)$/);
    if (postMatch) {
      const postRkey = postMatch[1];
      publishedLink.href = `/author/${encodeURIComponent(cachedAuthorHandle || did)}/${encodeURIComponent(postRkey)}`;
      publishedLink.hidden = false;
      publishedLink.removeAttribute('target');
      publishedLink.removeAttribute('rel');
      // Swap the DID for the reader-facing handle once it resolves — the
      // canonical story URL is /author/{handle}/{rkey}.
      void draftAuthorHandle().then((handle) => {
        if (handle !== did && state.postUri?.endsWith(`/${postRkey}`)) {
          publishedLink.href = `/author/${encodeURIComponent(handle)}/${encodeURIComponent(postRkey)}`;
        }
      });
      return;
    }
    if (state.publishedUri) {
      publishedLink.href = `https://pdsls.dev/${state.publishedUri}`;
      publishedLink.hidden = false;
      publishedLink.target = '_blank';
      publishedLink.rel = 'noopener';
      return;
    }
    publishedLink.hidden = true;
    publishedLink.removeAttribute('href');
  };

  const sync = async (manual = false) => {
    if (state.syncing) return;
    state.syncing = true;
    const versionAtStart = state.version;
    saveButton.disabled = true;
    statusEl.textContent = 'Syncing draft…';
    try {
      await resolvePendingPostRefs();
      const now = new Date().toISOString();
      state.createdAt = state.createdAt || now;
      const draftDocument = serializeDraft();
      const draftSourceList = draftSources();
      const draftBacklinkValue = draftBacklink();
      await repoRequest('com.atproto.repo.putRecord', {
        repo: did,
        collection: DRAFT_COLLECTION,
        rkey,
        record: {
          $type: DRAFT_COLLECTION,
          createdAt: state.createdAt,
          updatedAt: now,
          title: draftDocument.title,
          ...(typeof draftDocument.description === 'string' ? { description: draftDocument.description } : {}),
          ...(draftSourceList.length ? { sources: draftSourceList } : {}),
          ...(draftBacklinkValue ? { backlink: draftBacklinkValue } : {}),
          ...(state.publishedUri ? { publishedUri: state.publishedUri } : {}),
          ...(state.postUri ? { postUri: state.postUri } : {}),
          ...(state.publishedAt ? { publishedAt: state.publishedAt } : {}),
          ...(coauthorTokens().length ? { coauthors: coauthorTokens() } : {}),
          document: draftDocument,
        },
      });
      if (state.postUri && !metadataValidationError()) {
        // The published story's sources card lives in a separate record keyed
        // by the post rkey; keep it in step with the draft fields.
        try { await syncPostMetadata(); } catch { /* Metadata sync must not fail the draft sync. */ }
      }
      state.exists = true;
      // A synced draft record is previewable by link.
      if (previewLinkButton) previewLinkButton.hidden = false;
      state.savedVersion = versionAtStart;
      // If edits arrived mid-sync the backup holds them; only clear when clean.
      if (state.version === state.savedVersion) clearBackup();
      statusEl.textContent = `Synced at ${new Date().toLocaleTimeString(undefined, { timeStyle: 'short' })}.`;
    } catch (error) {
      // Preserve everything locally so a lost session never loses the draft.
      writeBackup();
      statusEl.textContent = error instanceof Error ? error.message : 'The draft could not be synced.';
      if (manual) throw error;
    } finally {
      state.syncing = false;
      saveButton.disabled = false;
    }
  }

  saveButton.addEventListener('click', () => { void sync(true).catch(() => {}); });
  deleteButton.addEventListener('click', async () => {
    if (!window.confirm('Delete this draft? This cannot be undone.')) return;
    deleteButton.disabled = true;
    try {
      if (state.exists) {
        await repoRequest('com.atproto.repo.deleteRecord', { repo: did, collection: DRAFT_COLLECTION, rkey });
      }
      clearBackup();
      state.savedVersion = state.version;
      window.location.assign('/account/author/draft');
    } catch (error) {
      statusEl.textContent = errorMessage(error);
      deleteButton.disabled = false;
    }
  });
  const publishDialog = page.querySelector<HTMLDialogElement>('[data-draft-publish-dialog]');
  const publishPreview = publishDialog?.querySelector<HTMLElement>('[data-draft-publish-preview]');
  const publishConfirm = publishDialog?.querySelector<HTMLButtonElement>('[data-draft-publish-confirm]');
  const scheduleInput = publishDialog?.querySelector<HTMLInputElement>('[data-draft-schedule]');
  const updateNoteRow = publishDialog?.querySelector<HTMLElement>('[data-draft-update-note-row]');
  const updateNoteInput = publishDialog?.querySelector<HTMLInputElement>('[data-draft-update-note]');
  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time.
  const toLocalInputValue = (date: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  const scheduledFromInput = () => {
    const value = scheduleInput?.value ? new Date(scheduleInput.value) : undefined;
    return value && Number.isFinite(value.getTime()) && value.getTime() > Date.now() + 30000 ? value : undefined;
  };
  const refreshPublishConfirmLabel = (updating: boolean) => {
    if (!publishConfirm) return;
    publishConfirm.innerHTML = scheduledFromInput()
      ? '<i class="fa-regular fa-clock" aria-hidden="true"></i> Schedule'
      : updating
        ? '<i class="fa-solid fa-rotate" aria-hidden="true"></i> Update'
        : '<i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Publish';
  };
  const publishDraft = async () => {
    state.syncing = true;
    publishButton.disabled = true;
    saveButton.disabled = true;
    statusEl.textContent = 'Publishing…';
    try {
      await resolvePendingPostRefs();
      const now = new Date().toISOString();
      const draftDocument = serializeDraft();
      const publication = publicationInput.value.trim();
      const site = /^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/site\.standard\.publication\/[a-zA-Z0-9._~:-]+$/.test(publication)
        ? publication
        : undefined;
      // A future "Publish at" schedules the story: the record is written now
      // with a future publishedAt, the site keeps it out of listings until the
      // time passes, and its URL works as a preview link immediately.
      const scheduleValue = scheduleInput?.value ? new Date(scheduleInput.value) : undefined;
      const scheduledFor = scheduleValue && Number.isFinite(scheduleValue.getTime())
        && scheduleValue.getTime() > Date.now() + 30000
        ? scheduleValue.toISOString()
        : undefined;
      // Republishing updates the records in place — the document URIs, and so
      // the story's canonical path, stay the same.
      const existingDocRkey = state.publishedUri
        ?.match(/^at:\/\/[^/]+\/pub\.leaflet\.document\/([a-zA-Z0-9._~:-]+)$/)?.[1];
      const existingPostRkey = state.postUri
        ?.match(/^at:\/\/[^/]+\/site\.standard\.document\/([a-zA-Z0-9._~:-]+)$/)?.[1];
      // Keep the original publishedAt for stories already live; a cleared
      // schedule field on a scheduled story means "publish now".
      const publishedAt = scheduledFor
        || (state.publishedAt && Date.parse(state.publishedAt) <= Date.now() ? state.publishedAt : now);

      let postRef: { uri: string; cid: string } | undefined;
      if (site) {
        // site.standard.document.path joins with the publication's url to form
        // the document's canonical web URL — standard.site readers and
        // verification rely on it resolving to this site's rendered page.
        const docRkey = existingPostRkey || createTid();
        let basePath = '';
        try {
          basePath = new URL(publicationUrls.get(site) || '').pathname.replace(/\/+$/, '');
        } catch { /* Publications without a resolvable url keep the full path. */ }
        let authorHandle = await draftAuthorHandle();
        if (authorHandle === did) {
          // Last resort: publications mounted at /author/{handle} already carry
          // the handle in their url, so reuse it rather than writing a DID path
          // that won't match the site's canonical /author/{handle}/{rkey} URL.
          const hinted = basePath.match(/^\/author\/([^/]+)/)?.[1];
          if (hinted) authorHandle = decodeURIComponent(hinted);
        }
        const pagePath = `/author/${encodeURIComponent(authorHandle)}/${encodeURIComponent(docRkey)}`;
        const documentPath = basePath && pagePath.startsWith(`${basePath}/`)
          ? pagePath.slice(basePath.length)
          : pagePath;
        const standardRecord: Record<string, unknown> = {
          $type: 'site.standard.document',
          site,
          path: documentPath,
          title: draftDocument.title,
          publishedAt,
          author: did,
          content: { $type: 'pub.leaflet.content', pages: draftDocument.pages },
        };
        const coAuthorDids = await resolveCoauthorDids();
        if (coAuthorDids.length) standardRecord.authors = [did, ...coAuthorDids];
        if (existingPostRkey) {
          // Republishes stamp updatedAt; an update note appends to the update
          // history readers see under the headline.
          standardRecord.updatedAt = now;
          const note = updateNoteInput?.value.trim() || '';
          let priorUpdates: Array<{ at: string; note?: string }> = [];
          try {
            const existingResponse = await repoRequest(`com.atproto.repo.getRecord?${new URLSearchParams({ repo: did, collection: 'site.standard.document', rkey: existingPostRkey })}`);
            if (existingResponse.ok) {
              const existingValue = (await existingResponse.json() as { value?: { updates?: unknown } }).value;
              if (Array.isArray(existingValue?.updates)) {
                priorUpdates = existingValue.updates.filter(
                  (entry): entry is { at: string; note?: string } => Boolean(entry) && typeof (entry as { at?: unknown }).at === 'string',
                );
              }
            }
          } catch { /* Update history is best-effort — the record still writes. */ }
          if (note) {
            standardRecord.updates = [...priorUpdates, { at: now, note }].slice(-20);
            standardRecord.updateNote = note;
          } else if (priorUpdates.length) {
            standardRecord.updates = priorUpdates;
          }
        }
        const textContent = draftPlainText(draftDocument.pages);
        const description = typeof draftDocument.description === 'string' && draftDocument.description.trim()
          ? draftDocument.description.trim()
          : textContent.slice(0, 300).trim();
        if (description) standardRecord.description = description;
        if (Array.isArray(draftDocument.tags)) standardRecord.tags = draftDocument.tags;
        if (draftDocument.coverImage) standardRecord.coverImage = draftDocument.coverImage;
        if (textContent) standardRecord.textContent = textContent;
        const standardResponse = await repoRequest('com.atproto.repo.putRecord', {
          repo: did,
          collection: 'site.standard.document',
          rkey: docRkey,
          record: standardRecord,
        });
        const standardResult = await standardResponse.json() as { uri?: unknown; cid?: unknown };
        if (typeof standardResult.uri !== 'string' || typeof standardResult.cid !== 'string') {
          throw new Error('The account provider did not return the published story record.');
        }
        state.postUri = standardResult.uri;
        postRef = { uri: standardResult.uri, cid: standardResult.cid };
      }

      const leafRecord = { ...draftDocument, publishedAt, ...(postRef ? { postRef } : {}) };
      const response = existingDocRkey
        ? await repoRequest('com.atproto.repo.putRecord', {
          repo: did,
          collection: 'pub.leaflet.document',
          rkey: existingDocRkey,
          record: leafRecord,
        })
        : await repoRequest('com.atproto.repo.createRecord', {
          repo: did,
          collection: 'pub.leaflet.document',
          record: leafRecord,
        });
      const result = await response.json() as { uri?: unknown };
      if (typeof result.uri !== 'string') throw new Error('The account provider did not return the published document URI.');
      state.publishedUri = result.uri;
      state.publishedAt = publishedAt;
      showPublishedLink();
      // Drop the edge-cached story/post lists so readers see the new version
      // right away instead of waiting out the cache TTL.
      const publishedPostRkey = state.postUri?.split('/').pop() || '';
      if (publishedPostRkey) {
        void (async () => {
          const handle = await draftAuthorHandle();
          await fetch('/api/author/cache/purge', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              did,
              rkey: publishedPostRkey,
              ...(site ? { site } : {}),
              path: `/author/${encodeURIComponent(handle)}/${encodeURIComponent(publishedPostRkey)}`,
            }),
          });
        })().catch(() => { /* A failed purge just means the cache ages out. */ });
      }
      state.syncing = false;
      await sync();
      if (updateNoteInput) updateNoteInput.value = '';
      statusEl.textContent = scheduledFor
        ? `Scheduled for ${scheduleValue!.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })} — the story link works as a preview now and the story lists itself when the time comes.`
        : existingDocRkey
          ? 'Updated the published post — same link, latest content.'
          : state.postUri
            ? 'Published to Coffee & Code. The story link is live next to the Save button.'
            : 'Published as a Leaflet document. Add a site.standard.publication URI in metadata to also publish it to Coffee & Code.';
    } catch (error) {
      state.syncing = false;
      statusEl.textContent = error instanceof Error ? error.message : 'The draft could not be published.';
    } finally {
      publishButton.disabled = false;
      saveButton.disabled = false;
    }
  };

  const openPublishDialog = async () => {
    if (!publishDialog || !publishPreview || !publishConfirm) {
      await publishDraft();
      return;
    }
    const title = titleInput.value.trim() || 'Untitled';
    const description = descriptionInput.value.trim();
    const handle = await draftAuthorHandle();
    const updating = Boolean(state.publishedUri);
    const dialogTitle = publishDialog.querySelector<HTMLElement>('#draft-publish-dialog-title');
    if (dialogTitle) dialogTitle.textContent = updating ? 'Update post' : 'Publish post';
    const dialogIntro = publishDialog.querySelector<HTMLElement>('.draft-publish-dialog__intro');
    if (dialogIntro) {
      dialogIntro.textContent = updating
        ? 'This will update the existing record on your account — the link stays the same and the Coffee & Code home page will show the latest version.'
        : 'Publishing this post will publish it as a record on your account, and it will be shown on the Coffee & Code home page.';
    }
    if (scheduleInput) {
      scheduleInput.min = toLocalInputValue(new Date(Date.now() + 5 * 60 * 1000));
      // Prefill with the existing schedule when the story is still scheduled.
      scheduleInput.value = state.publishedAt && Date.parse(state.publishedAt) > Date.now()
        ? toLocalInputValue(new Date(state.publishedAt))
        : '';
      scheduleInput.oninput = () => refreshPublishConfirmLabel(updating);
    }
    refreshPublishConfirmLabel(updating);
    // Update notes only apply to stories already on the site.
    if (updateNoteRow) updateNoteRow.hidden = !(updating && state.postUri);
    publishPreview.replaceChildren();
    if (state.coverObjectUrl) {
      const image = document.createElement('img');
      image.className = 'draft-share-card__image';
      image.src = state.coverObjectUrl;
      image.alt = '';
      publishPreview.append(image);
    }
    const cardBody = document.createElement('div');
    cardBody.className = 'draft-share-card__body';
    const cardTitle = document.createElement('span');
    cardTitle.className = 'draft-share-card__title';
    cardTitle.textContent = title;
    cardBody.append(cardTitle);
    if (description) {
      const cardDescription = document.createElement('p');
      cardDescription.className = 'draft-share-card__description';
      cardDescription.textContent = description;
      cardBody.append(cardDescription);
    }
    const cardMeta = document.createElement('span');
    cardMeta.className = 'draft-share-card__meta';
    cardMeta.textContent = `${handle === did ? did : `@${handle}`} · coffeencode.cc`;
    cardBody.append(cardMeta);
    publishPreview.append(cardBody);
    publishConfirm.disabled = false;
    publishDialog.showModal();
  };
  publishDialog?.querySelector<HTMLButtonElement>('[data-draft-publish-cancel]')
    ?.addEventListener('click', () => publishDialog.close());
  publishDialog?.addEventListener('click', (event) => {
    if (event.target === publishDialog) publishDialog.close();
  });
  publishConfirm?.addEventListener('click', () => {
    publishDialog?.close();
    void publishDraft();
  });
  publishButton.addEventListener('click', () => {
    if (state.syncing) return;
    const metaError = metadataValidationError();
    if (metaError) { statusEl.textContent = metaError; return; }
    void openPublishDialog();
  });
  const shortcutsDialog = page.querySelector<HTMLDialogElement>('[data-draft-shortcuts-dialog]');
  toolbar.querySelector<HTMLButtonElement>('[data-draft-shortcuts]')
    ?.addEventListener('click', () => shortcutsDialog?.showModal());
  shortcutsDialog?.querySelector<HTMLButtonElement>('[data-draft-shortcuts-close]')
    ?.addEventListener('click', () => shortcutsDialog.close());
  shortcutsDialog?.addEventListener('click', (event) => {
    if (event.target === shortcutsDialog) shortcutsDialog.close();
  });
  window.addEventListener('beforeunload', (event) => {
    if (state.version !== state.savedVersion && !state.syncing) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  const timer = window.setInterval(() => {
    if (state.version !== state.savedVersion) void sync();
  }, DRAFT_SYNC_INTERVAL_MS);
  window.addEventListener('pagehide', () => {
    window.clearInterval(timer);
    // Last-chance flush: anything still unsynced lands in localStorage.
    if (state.version !== state.savedVersion) writeBackup();
  }, { once: true });

  // Load the existing record (if any) and hydrate the editor. A local backup
  // newer than the stored record wins — it holds changes that never synced.
  let restoredFromBackup = false;
  try {
    await loadDraftPublications();
    const query = new URLSearchParams({ repo: did, collection: DRAFT_COLLECTION, rkey });
    const activeSession = requireSession();
    const hydrateDraft = async (value: Record<string, unknown>) => {
      if (typeof value.createdAt === 'string' && !state.createdAt) state.createdAt = value.createdAt;
      const doc = value.document as Record<string, unknown> | undefined;
      titleInput.value = typeof doc?.title === 'string' ? doc.title : '';
      descriptionInput.value = typeof doc?.description === 'string' ? doc.description : '';
      tagsInput.value = Array.isArray(doc?.tags) ? doc.tags.filter((tag): tag is string => typeof tag === 'string').join(', ') : '';
      const storedPublication = typeof doc?.publication === 'string' ? doc.publication : '';
      if (storedPublication && ![...publicationInput.options].some((option) => option.value === storedPublication)) {
        const option = document.createElement('option');
        option.value = storedPublication;
        option.textContent = storedPublication;
        publicationInput.append(option);
      }
      publicationInput.value = storedPublication;
      if (Array.isArray(value.sources)) {
        sourcesInput.value = value.sources.filter((source): source is string => typeof source === 'string').join('\n');
      }
      if (typeof value.backlink === 'string') backlinkInput.value = value.backlink;
      if (coauthorsInput) {
        coauthorsInput.value = Array.isArray(value.coauthors)
          ? value.coauthors.filter((token): token is string => typeof token === 'string').join(', ')
          : '';
      }
      if (state.postUri) {
        // Older drafts may predate stored sources — hydrate from the published
        // story's metadata record so the fields match what readers see.
        try {
          const postRkey = state.postUri.split('/').pop() || '';
          const meta = postRkey ? await fetchPostMetadataRecord(did, postRkey) : undefined;
          state.metadataExisted = Boolean(meta);
          state.metadataCreatedAt = typeof meta?.createdAt === 'string' ? meta.createdAt : undefined;
          if (!sourcesInput.value.trim() && Array.isArray(meta?.sources)) sourcesInput.value = meta.sources.join('\n');
          if (!backlinkInput.value.trim() && typeof meta?.backlink === 'string') backlinkInput.value = meta.backlink;
          lastWrittenMetadata = JSON.stringify({ postRkey, sources: draftSources(), backlink: draftBacklink() });
        } catch { /* Missing metadata is fine; the fields just stay as stored. */ }
      }
      if (doc?.coverImage && typeof doc.coverImage === 'object') {
        state.cover = doc.coverImage;
        const cid = (doc.coverImage as { ref?: { $link?: unknown } }).ref?.$link;
        if (typeof cid === 'string') {
          const blobResponse = await activeSession.fetchHandler(`/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did, cid })}`);
          if (blobResponse.ok) state.coverObjectUrl = URL.createObjectURL(await blobResponse.blob());
        }
      }
      const pages = Array.isArray(doc?.pages) ? doc.pages : [];
      const linear = pages.find((entry): entry is Record<string, unknown> => Boolean(entry)
        && typeof entry === 'object' && (entry as Record<string, unknown>).$type === 'pub.leaflet.pages.linearDocument'
        && Array.isArray((entry as Record<string, unknown>).blocks));
      for (const wrapper of (linear?.blocks as Array<Record<string, unknown>> | undefined) || []) {
        const raw = wrapper?.block as Record<string, unknown> | undefined;
        if (!raw || typeof raw !== 'object') continue;
        const alignment = typeof wrapper?.alignment === 'string' ? wrapper.alignment : undefined;
        const model = draftBlockFromLeaflet(raw, alignment);
        if (!model) continue;
        let inner = '';
        if (model.type === 'unorderedList' || model.type === 'orderedList') {
          const flatten = (children: unknown): string[] => {
            if (!Array.isArray(children)) return [];
            return children.flatMap((child) => {
              const item = child as { content?: { plaintext?: unknown; facets?: DraftFacet[] }; children?: unknown; orderedListChildren?: { children?: unknown }; unorderedListChildren?: { children?: unknown } };
              const text = typeof item?.content?.plaintext === 'string'
                ? richTextToHtml(item.content.plaintext, Array.isArray(item.content.facets) ? item.content.facets : undefined)
                : '';
              return [text, ...flatten(item?.children), ...flatten(item?.orderedListChildren?.children), ...flatten(item?.unorderedListChildren?.children)];
            });
          };
          const rows = flatten((raw as { children?: unknown }).children);
          insertBlock(model, undefined, rows[0] || '');
          const element = state.blockElements.get(model.id)!;
          for (const html of rows.slice(1)) {
            const row = document.createElement('div');
            row.className = 'draft-block__item-row';
            row.append(makeEditable(model, html, 'draft-block__editable draft-block__item-editable'));
            element.append(row);
          }
          continue;
        }
        if (DRAFT_TEXT_TYPES.includes(model.type) && typeof raw.plaintext === 'string') {
          inner = model.type === 'code'
            ? draftEscapeHtml(raw.plaintext)
            : richTextToHtml(raw.plaintext, Array.isArray(raw.facets) ? raw.facets as DraftFacet[] : undefined);
        }
        if (model.type === 'image' && model.image && typeof model.image === 'object') {
          const cid = (model.image as { ref?: { $link?: unknown } }).ref?.$link;
          if (typeof cid === 'string') {
            const blobResponse = await activeSession.fetchHandler(`/xrpc/com.atproto.sync.getBlob?${new URLSearchParams({ did, cid })}`);
            if (blobResponse.ok) model.imageObjectUrl = URL.createObjectURL(await blobResponse.blob());
          }
        }
        insertBlock(model, undefined, inner);
      }
    };

    const response = await activeSession.fetchHandler(`/xrpc/com.atproto.repo.getRecord?${query.toString()}`);
    if (response.ok) {
      const payload = await response.json() as { value?: Record<string, unknown> };
      const remoteValue = payload.value;
      if (session?.did !== did) return;
      state.exists = true;
      if (previewLinkButton) previewLinkButton.hidden = false;
      state.createdAt = typeof remoteValue?.createdAt === 'string' ? remoteValue.createdAt : undefined;
      if (typeof remoteValue?.publishedAt === 'string') {
        state.publishedAt = remoteValue.publishedAt;
      }
      if (typeof remoteValue?.publishedUri === 'string' && /^at:\/\//.test(remoteValue.publishedUri)) {
        state.publishedUri = remoteValue.publishedUri;
      }
      if (typeof remoteValue?.postUri === 'string' && /^at:\/\//.test(remoteValue.postUri)) {
        state.postUri = remoteValue.postUri;
      }
      const backup = loadBackup();
      const remoteUpdatedAt = Date.parse(typeof remoteValue?.updatedAt === 'string' ? remoteValue.updatedAt : '') || 0;
      if (backup && backup.savedAt > remoteUpdatedAt) {
        restoredFromBackup = true;
        await hydrateDraft(backup.record);
      } else {
        await hydrateDraft(remoteValue || {});
      }
    } else {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      const missing = response.status === 404 || (response.status === 400 && payload?.error === 'RecordNotFound');
      if (!missing) {
        if (response.status === 401 || response.status === 403) {
          statusEl.textContent = 'Your account needs author permissions for drafts. Sign out, then sign in again and approve the requested permissions.';
          if (gate) gate.hidden = false;
          return;
        }
        throw new Error(payload?.error || `Could not load the draft (${response.status}).`);
      }
      // Nothing on the PDS yet — a local backup may still hold the draft.
      const backup = loadBackup();
      if (backup) {
        restoredFromBackup = true;
        await hydrateDraft(backup.record);
      }
    }
  } catch (error) {
    statusEl.textContent = error instanceof Error ? error.message : 'Could not load the draft.';
    return;
  }

  if (!state.blocks.length) insertBlock({ id: crypto.randomUUID(), type: 'text' }, undefined);
  if (restoredFromBackup) {
    // Leave the draft dirty so the autosync pushes the restored copy back up
    // now that the user is signed in again.
    markDirty();
    void sync();
  } else {
    state.savedVersion = state.version;
  }
  workspace.hidden = false;
  showPublishedLink();
  statusEl.textContent = restoredFromBackup
    ? 'Restored unsaved changes from this browser — syncing…'
    : state.exists ? 'Draft loaded.' : 'New draft — it will sync automatically.';
  renderPreview();
}

// ---------------------------------------------------------------------------
// Publication creator — /account/author/create (unlinked page). Uses a
// dedicated OAuth client whose only grant is site.standard.publication plus
// image blobs, so the permission never lands in the main session's scope. Its
// OAuth callback lands back on this same page.
// ---------------------------------------------------------------------------

const createClientScope = (rawCreateClientMetadata as { scope?: string }).scope
  || 'atproto repo:site.standard.publication?action=create&action=update&action=delete blob:image/*';
let publicationClient: BrowserOAuthClient | undefined;
let publicationClientInit: Promise<Awaited<ReturnType<BrowserOAuthClient['init']>>> | undefined;

function getPublicationClient() {
  if (!publicationClient) {
    publicationClient = new BrowserOAuthClient({
      clientMetadata: rawCreateClientMetadata as OAuthClientMetadataInput,
      handleResolver,
    });
  }
  if (!publicationClientInit) publicationClientInit = publicationClient.init();
  return { client: publicationClient, initialized: publicationClientInit };
}

function hexToRgb(value: string): { r: number; g: number; b: number } | undefined {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return undefined;
  const rgb = parseInt(match[1], 16);
  return { r: (rgb >> 16) & 255, g: (rgb >> 8) & 255, b: rgb & 255 };
}

async function loadCreatePublication() {
  const page = document.querySelector<HTMLElement>('[data-publication-create]');
  if (!page || page.dataset.pubCreateLoaded) return;
  page.dataset.pubCreateLoaded = '1';

  const signinPanel = page.querySelector<HTMLElement>('[data-pub-signin]');
  const identifierInput = page.querySelector<HTMLInputElement>('[data-pub-identifier]');
  const signinButton = page.querySelector<HTMLButtonElement>('[data-pub-signin-button]');
  const form = page.querySelector<HTMLFormElement>('[data-pub-form]');
  const nameInput = page.querySelector<HTMLInputElement>('[data-pub-name]');
  const descriptionInput = page.querySelector<HTMLTextAreaElement>('[data-pub-description]');
  const iconInput = page.querySelector<HTMLInputElement>('[data-pub-icon]');
  const widthInput = page.querySelector<HTMLInputElement>('[data-pub-width]');
  const submitButton = page.querySelector<HTMLButtonElement>('[data-pub-submit]');
  const switchButton = page.querySelector<HTMLButtonElement>('[data-pub-switch]');
  const status = page.querySelector<HTMLElement>('[data-pub-status]');
  const result = page.querySelector<HTMLElement>('[data-pub-result]');
  const registeredSection = page.querySelector<HTMLElement>('[data-pub-registered]');
  const registeredList = page.querySelector<HTMLElement>('[data-pub-registered-list]');
  const adminPanel = page.querySelector<HTMLElement>('[data-pub-admin]');
  const addUriInput = page.querySelector<HTMLInputElement>('[data-pub-add-uri]');
  const addButton = page.querySelector<HTMLButtonElement>('[data-pub-add-button]');
  if (!signinPanel || !form || !nameInput || !status || !result || !submitButton) return;

  // Publications only appear on the site once the owner lists them in
  // cc.coffeencode.publications on their repo. That record is public, so the
  // list below renders for everyone; the add/remove controls need the owner's
  // session in the create client.
  const SITE_OWNER_DID = 'did:plc:l37td5yhxl2irrzrgvei4qay';
  const SITE_OWNER_PDS = 'https://account.coffeencode.cc';
  const PUBLICATIONS_COLLECTION = 'cc.coffeencode.publications';
  const publicationUriPattern = /^at:\/\/did:[a-z0-9]+:[a-zA-Z0-9._:%-]+\/site\.standard\.publication\/[a-zA-Z0-9._~:-]+$/;

  type RegisteredPublication = { uri: string; rkey: string; name?: string; owned: boolean };
  const readRegistered = async (): Promise<RegisteredPublication[]> => {
    // The list reads at://{SITE_OWNER_DID}/cc.coffeencode.publications/self —
    // its `publications` array is what this section shows and manages. The
    // site itself additionally auto-discovers publications in the owner's
    // repo; those appear here only once registered in the record.
    const configQuery = new URLSearchParams({ repo: SITE_OWNER_DID, collection: PUBLICATIONS_COLLECTION, rkey: 'self' });
    const configResponse = await fetch(`${SITE_OWNER_PDS}/xrpc/com.atproto.repo.getRecord?${configQuery}`);
    const record = configResponse.ok
      ? await configResponse.json() as { value?: { publications?: unknown } }
      : {};
    const raw = Array.isArray(record.value?.publications) ? record.value.publications : [];
    const uris = [...new Set(
      raw.filter((uri): uri is string => typeof uri === 'string' && publicationUriPattern.test(uri)),
    )];
    const entries: RegisteredPublication[] = [];
    for (const uri of uris) {
      const parts = uri.match(/^at:\/\/([^/]+)\/[^/]+\/([^/]+)$/)!;
      const owned = parts[1] === SITE_OWNER_DID;
      let name: string | undefined;
      try {
        const pds = owned ? SITE_OWNER_PDS : (await resolveSignInPds(parts[1])).pds;
        const pubQuery = new URLSearchParams({ repo: parts[1], collection: 'site.standard.publication', rkey: parts[2] });
        const pubResponse = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?${pubQuery}`);
        if (pubResponse.ok) {
          const pub = await pubResponse.json() as { value?: { name?: unknown } };
          if (typeof pub.value?.name === 'string' && pub.value.name) name = pub.value.name;
        }
      } catch { /* Name is decorative — the URI still lists. */ }
      entries.push({ uri, rkey: parts[2], name, owned });
    }
    return entries;
  };

  let pubSession: OAuthSession | undefined;
  let initError: unknown;
  try {
    const { initialized } = getPublicationClient();
    const resolved = await initialized;
    if (resolved) pubSession = resolved.session;
  } catch (error) {
    initError = error;
  }

  const writeRegistered = async (publications: string[]) => {
    const activeSession = pubSession;
    if (!activeSession || activeSession.did !== SITE_OWNER_DID) throw new Error('Only the site owner can change the publications list.');
    const query = new URLSearchParams({ repo: activeSession.did, collection: PUBLICATIONS_COLLECTION, rkey: 'self' });
    const getResponse = await activeSession.fetchHandler(`/xrpc/com.atproto.repo.getRecord?${query}`);
    let value: Record<string, unknown> = { $type: PUBLICATIONS_COLLECTION, publications: [] };
    if (getResponse.ok) {
      const record = await getResponse.json() as { value?: Record<string, unknown> };
      if (record.value && typeof record.value === 'object') value = record.value;
    }
    value.$type = PUBLICATIONS_COLLECTION;
    value.publications = publications;
    const putResponse = await activeSession.fetchHandler('/xrpc/com.atproto.repo.putRecord', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: activeSession.did, collection: PUBLICATIONS_COLLECTION, rkey: 'self', record: value }),
    });
    if (!putResponse.ok) {
      const payload = await putResponse.json().catch(() => null) as { error?: string; message?: string } | null;
      throw new Error([payload?.error, payload?.message].filter(Boolean).join(': ') || `The publications record could not be saved (${putResponse.status}).`);
    }
  };

  const renderRegistered = async () => {
    if (!registeredSection || !registeredList) return;
    registeredSection.hidden = false;
    const entries = await readRegistered();
    registeredList.replaceChildren();
    if (!entries.length) {
      const empty = document.createElement('li');
      empty.textContent = 'No publications are registered yet.';
      registeredList.append(empty);
      return;
    }
    for (const entry of entries) {
      const item = document.createElement('li');
      const label = document.createElement('code');
      label.textContent = `${entry.name ? `${entry.name} — ` : ''}${entry.uri}${entry.owned ? ' (site publication)' : ''}`;
      item.append(label);
      if (pubSession?.did === SITE_OWNER_DID) {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.textContent = 'Remove';
        remove.addEventListener('click', async () => {
          remove.disabled = true;
          try {
            // Removing unregisters the URI from the publications record — it
            // never deletes the site.standard.publication record itself.
            const current = await readRegistered();
            await writeRegistered(current.map((candidate) => candidate.uri).filter((uri) => uri !== entry.uri));
            await renderRegistered();
          } catch (error) {
            status.textContent = errorMessage(error);
            remove.disabled = false;
          }
        });
        item.append(remove);
      }
      registeredList.append(item);
    }
  };
  void renderRegistered();

  if (adminPanel && pubSession?.did === SITE_OWNER_DID) {
    adminPanel.hidden = false;
    addButton?.addEventListener('click', async () => {
      const uri = (addUriInput?.value || '').trim();
      if (!publicationUriPattern.test(uri)) {
        status.textContent = 'That is not a site.standard.publication URI.';
        return;
      }
      addButton.disabled = true;
      try {
        const current = await readRegistered();
        const publications = current.map((candidate) => candidate.uri);
        if (!publications.includes(uri)) publications.push(uri);
        await writeRegistered(publications);
        if (addUriInput) addUriInput.value = '';
        await renderRegistered();
        status.textContent = 'Publication added — it will list on the site within a couple of minutes.';
      } catch (error) {
        status.textContent = errorMessage(error);
      } finally {
        addButton.disabled = false;
      }
    });
  }

  if (!pubSession) {
    signinPanel.hidden = false;
    status.textContent = initError
      ? (initError instanceof Error ? initError.message : 'Publication sign-in could not initialize.')
      : '';
    signinButton?.addEventListener('click', async () => {
      const identifier = identifierInput?.value.trim() || '';
      if (!identifier) {
        status.textContent = 'Enter your handle or DID first.';
        return;
      }
      signinButton.disabled = true;
      status.textContent = 'Redirecting to your account provider…';
      try {
        await publicationClient!.signInRedirect(identifier as Parameters<BrowserOAuthClient['signInRedirect']>[0], { scope: createClientScope });
      } catch (error) {
        signinButton.disabled = false;
        status.textContent = errorMessage(error);
      }
    });
    return;
  }

  signinPanel.hidden = true;
  form.hidden = false;
  status.textContent = '';

  switchButton?.addEventListener('click', async () => {
    await pubSession!.signOut().catch(() => { /* Local sign-out is what matters. */ });
    window.location.reload();
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const activeSession = pubSession;
    if (!activeSession) return;
    submitButton.disabled = true;
    status.textContent = 'Creating your publication…';
    result.hidden = true;
    try {
      const name = nameInput.value.trim();
      if (!name) throw new Error('Give your publication a name.');
      const description = descriptionInput?.value.trim() || '';
      const pageWidth = Math.min(2000, Math.max(320, parseInt(widthInput?.value || '', 10) || 768));

      // The publication URL keys on the account's handle — that's how the site
      // mounts it under /author/{handle}.
      let handle: string = activeSession.did;
      try {
        const profileResponse = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(activeSession.did)}`);
        if (profileResponse.ok) {
          const profile = await profileResponse.json() as { handle?: unknown };
          if (typeof profile.handle === 'string' && profile.handle) handle = profile.handle;
        }
      } catch { /* A DID path works as a fallback — author pages resolve DIDs. */ }

      let iconBlob: unknown;
      const iconFile = iconInput?.files?.[0];
      if (iconFile) {
        const upload = await activeSession.fetchHandler('/xrpc/com.atproto.repo.uploadBlob', {
          method: 'POST',
          headers: { 'Content-Type': iconFile.type || 'application/octet-stream' },
          body: iconFile,
        });
        const uploadPayload = await upload.json().catch(() => null) as { blob?: unknown; error?: string; message?: string } | null;
        if (!upload.ok || !uploadPayload?.blob) {
          throw new Error([uploadPayload?.error, uploadPayload?.message].filter(Boolean).join(': ')
            || `Icon upload failed (${upload.status}).`);
        }
        iconBlob = uploadPayload.blob;
      }

      const color = (key: string) => hexToRgb(
        page.querySelector<HTMLInputElement>(`[data-pub-color="${key}"]`)?.value || '',
      );
      const accent = color('accent');
      const accentForeground = color('accentForeground');
      const background = color('background');
      const foreground = color('foreground');
      const rgb = (type: string, value?: { r: number; g: number; b: number }) => value
        ? { $type: type, ...value }
        : undefined;

      const record: Record<string, unknown> = {
        $type: 'site.standard.publication',
        name,
        url: `https://coffeencode.cc/author/${encodeURIComponent(handle)}`,
        ...(description ? { description } : {}),
        ...(iconBlob ? { icon: iconBlob } : {}),
        ...(accent && accentForeground && background && foreground
          ? {
            basicTheme: {
              $type: 'site.standard.theme.basic',
              accent: rgb('site.standard.theme.color#rgb', accent),
              accentForeground: rgb('site.standard.theme.color#rgb', accentForeground),
              background: rgb('site.standard.theme.color#rgb', background),
              foreground: rgb('site.standard.theme.color#rgb', foreground),
            },
            theme: {
              $type: 'pub.leaflet.publication#theme',
              accentBackground: rgb('pub.leaflet.theme.color#rgb', accent),
              accentText: rgb('pub.leaflet.theme.color#rgb', accentForeground),
              backgroundColor: rgb('pub.leaflet.theme.color#rgb', background),
              primary: rgb('pub.leaflet.theme.color#rgb', foreground),
              bodyFont: 'source-sans',
              headingFont: 'lora',
              pageBackground: { $type: 'pub.leaflet.theme.color#rgba', a: 100, b: 0, g: 0, r: 255 },
              pageWidth,
              showPageBackground: false,
            },
          }
          : {}),
        preferences: {
          prevNextDirection: 'rtl',
          showComments: true,
          showFirstLast: false,
          showInDiscover: true,
          showMentions: true,
          showPrevNext: true,
          showRecommends: true,
        },
      };

      const response = await activeSession.fetchHandler('/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: activeSession.did, collection: 'site.standard.publication', record }),
      });
      const payload = await response.json().catch(() => null) as { uri?: unknown; error?: string; message?: string } | null;
      if (!response.ok || typeof payload?.uri !== 'string') {
        throw new Error([payload?.error, payload?.message].filter(Boolean).join(': ')
          || `The account provider did not create the record (${response.status}).`);
      }
      const uri = payload.uri;
      status.textContent = 'Publication created.';
      const isOwner = activeSession.did === SITE_OWNER_DID;
      result.innerHTML = `<strong>Publication URI</strong><br><code>${draftEscapeHtml(uri)}</code><br>`
        + `Paste this into the <strong>Publication</strong> field in your draft's document settings to publish under it. `
        + (isOwner
          ? 'It is already a site publication — the site discovers it automatically.'
          : 'The site lists it once the owner adds the URI under <em>Publications on Coffee &amp; Code</em> below. ')
        + `<a href="https://pdsls.dev/${draftEscapeHtml(uri)}" target="_blank" rel="noopener">View on PDSls <i class="fa-solid fa-arrow-up-right-from-square" aria-hidden="true"></i></a> · `
        + `<a href="/account/author/draft">Open your drafts <i class="fa-solid fa-arrow-right" aria-hidden="true"></i></a>`;
      result.hidden = false;
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : 'The publication could not be created.';
    } finally {
      submitButton.disabled = false;
    }
  });
}
