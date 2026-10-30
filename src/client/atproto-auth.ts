import {
  BrowserOAuthClient,
  OAuthCallbackError,
  type OAuthClientMetadataInput,
  type OAuthSession,
} from '@atproto/oauth-client-browser';
import rawClientMetadata from '../../media/oauth-client-metadata.json';
import rawAuthorClientMetadata from '../../media/oauth-client-metadata-author.json';

type OAuthMetadataVersion = 'member' | 'author';
type ForumImageInput = { file: File; alt: string };
type ForumStrongRef = { uri: string; cid: string };
const oauthMetadataVersions: Record<OAuthMetadataVersion, OAuthClientMetadataInput> = {
  member: rawClientMetadata as OAuthClientMetadataInput,
  author: rawAuthorClientMetadata as OAuthClientMetadataInput,
};
const metadataPreferenceKey = 'cc.oauth-metadata-version';
const pendingMetadataVersionKey = 'cc.oauth-pending-metadata-version';
const handleResolver = 'https://database.coffeencode.cc';
const oauthClients = new Map<OAuthMetadataVersion, BrowserOAuthClient>();

let client: BrowserOAuthClient | undefined;
let session: OAuthSession | undefined;
let initializationError: unknown;
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

const authForm = document.querySelector<HTMLFormElement>('[data-auth-form]');
const authOptions = document.querySelector<HTMLElement>('[data-auth-options]');
const authAccount = document.querySelector<HTMLElement>('[data-auth-account]');
const authName = document.querySelector<HTMLElement>('[data-auth-name]');
const authError = document.querySelector<HTMLElement>('[data-auth-error]');
const createCoffeeAccountButton = document.querySelector<HTMLButtonElement>('[data-create-coffee-account]');
const inviteStatus = document.querySelector<HTMLElement>('[data-invite-status]');
const invitePanel = document.querySelector<HTMLElement>('[data-invite-panel]');
const inviteCodeElement = document.querySelector<HTMLElement>('[data-invite-code]');
const copyInviteButton = document.querySelector<HTMLButtonElement>('[data-copy-invite]');
const signoutButton = document.querySelector<HTMLButtonElement>('[data-auth-signout]');
const headerAccount = document.querySelector<HTMLAnchorElement>('[data-account-link]');
const headerAccountAvatar = document.querySelector<HTMLImageElement>('[data-account-avatar]');
const headerAccountPlaceholder = document.querySelector<HTMLElement>('[data-account-placeholder]');
const mobileAccountLink = document.querySelector<HTMLAnchorElement>('[data-mobile-account-link]');
const accountPage = document.querySelector<HTMLElement>('[data-account-page]');
const signedOutAccount = document.querySelector<HTMLElement>('[data-account-signed-out]');
let signupInviteCode: string | undefined;
let accountAuthorRecord: Record<string, unknown> | undefined;
let accountAuthorDid: string | undefined;

declare global {
  interface Window {
    coffeeAndCodeAuth?: {
      getDid: () => Promise<string | undefined>;
      createComment: (record: { subject: { uri: string }; reply?: { parent: { uri: string } }; text: string; createdAt: string }) => Promise<void>;
      editComment: (uri: string, record: { subject: { uri: string }; reply?: { parent: { uri: string } }; text: string; createdAt: string }) => Promise<void>;
      deleteComment: (uri: string) => Promise<void>;
      toggleCommentLike: (commentUri: string, isLiked: boolean, likeRkey?: string) => Promise<string | undefined>;
      createForumPost: (forumUri: string, title: string, content: string, tags: string[], images: ForumImageInput[]) => Promise<void>;
      createForumReply: (root: ForumStrongRef, parent: ForumStrongRef, content: string, images: ForumImageInput[]) => Promise<void>;
      getForumVotes: (subjectUris: string[]) => Promise<Record<string, 'up' | 'down'>>;
      setForumVote: (subject: ForumStrongRef, direction: 'up' | 'down' | undefined) => Promise<void>;
      createForumModeration: (forumUri: string, subject: ForumStrongRef, action: string, moderators: string[]) => Promise<void>;
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

function isMetadataVersion(value: string | null | undefined): value is OAuthMetadataVersion {
  return value === 'member' || value === 'author';
}

function storedMetadataVersion(): OAuthMetadataVersion | undefined {
  try {
    const value = window.localStorage.getItem(metadataPreferenceKey);
    return isMetadataVersion(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function storedPendingMetadataVersion(): OAuthMetadataVersion | undefined {
  try {
    const value = window.localStorage.getItem(pendingMetadataVersionKey);
    return isMetadataVersion(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function clearPendingMetadataVersion() {
  try {
    window.localStorage.removeItem(pendingMetadataVersionKey);
  } catch (error) {
    console.error('Could not clear the pending OAuth metadata version:', error);
  }
}

function rememberMetadataVersion(version: OAuthMetadataVersion) {
  try {
    window.localStorage.setItem(metadataPreferenceKey, version);
    window.localStorage.setItem(pendingMetadataVersionKey, version);
  } catch {
    throw new Error('Your browser could not remember the OAuth client for the sign-in callback. Allow site storage and try again.');
  }
}

function getOAuthClient(version: OAuthMetadataVersion) {
  let oauthClient = oauthClients.get(version);
  if (!oauthClient) {
    oauthClient = new BrowserOAuthClient({
      clientMetadata: oauthMetadataVersions[version],
      handleResolver,
      onSessionDeleted: (did) => {
        if (session?.did !== did) return;
        session = undefined;
        renderAccount();
      },
    });
    oauthClients.set(version, oauthClient);
  }
  return oauthClient;
}

function initializeOAuthClient(oauthClient: BrowserOAuthClient) {
  let initialized = clientInitializations.get(oauthClient);
  if (!initialized) {
    initialized = oauthClient.init();
    clientInitializations.set(oauthClient, initialized);
  }
  return initialized;
}

async function selectedOAuthClient(handle?: string) {
  await oauthReady;
  let version: OAuthMetadataVersion = 'member';
  if (handle) {
    const query = new URLSearchParams({ handle });
    const authorResponse = await fetch(`/api/authors/check?${query}`, { cache: 'no-store' });
    if (!authorResponse.ok) throw new Error('Could not check whether this account is a Coffee & Code author. Please try again.');
    const authorResult = await authorResponse.json() as { isAuthor?: unknown };
    if (typeof authorResult.isAuthor !== 'boolean') throw new Error('Author check returned an invalid response.');
    if (authorResult.isAuthor) version = 'author';
  }
  rememberMetadataVersion(version);
  const selectedClient = getOAuthClient(version);
  client = selectedClient;
  const initialized = await initializeOAuthClient(selectedClient);
  session = initialized?.session;
  if (initialized && 'state' in initialized) callbackState = initialized.state;
  renderAccount();
  return selectedClient;
}

const initialMetadataVersion = storedPendingMetadataVersion() || storedMetadataVersion() || 'member';

function renderAccount() {
  const loginLinks = document.querySelectorAll<HTMLElement>('[data-login-link]');
  const displayName = session ? 'Your account' : '';
  loginLinks.forEach((link) => { link.hidden = Boolean(session); });
  if (headerAccount) {
    headerAccount.hidden = !session;
    headerAccount.setAttribute('aria-label', session ? `Account for ${displayName}` : 'Your account');
    headerAccount.title = session ? `Account for ${displayName}` : 'Your account';
  }
  if (mobileAccountLink) {
    mobileAccountLink.hidden = !session;
    mobileAccountLink.textContent = session ? `Account (${displayName})` : 'Account';
  }

  if (session) {
    if (authOptions) authOptions.hidden = true;
    if (authAccount) authAccount.hidden = false;
    if (authName) authName.textContent = 'Your account';
  } else {
    if (authOptions) authOptions.hidden = false;
    if (authAccount) authAccount.hidden = true;
    if (authName) authName.textContent = '';
  }

  if (accountPage) {
    if (signedOutAccount) signedOutAccount.hidden = Boolean(session);
    if (session) {
    const did = session.did;
    const profileName = accountPage.querySelector<HTMLElement>('[data-profile-name]');
    const profileHandle = accountPage.querySelector<HTMLElement>('[data-profile-handle]');
    const profileBio = accountPage.querySelector<HTMLElement>('[data-profile-bio]');
    const profileAvatar = accountPage.querySelector<HTMLImageElement>('[data-profile-avatar]');
    const profilePlaceholder = accountPage.querySelector<HTMLElement>('[data-profile-placeholder]');
    fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Profile unavailable')))
      .then((profile: { avatar?: string; displayName?: string; handle?: string; description?: string }) => {
        if (session?.did !== did) return;
        if (profileName) profileName.textContent = profile.displayName || profile.handle || 'Your account';
        if (profileHandle) profileHandle.textContent = profile.handle ? `@${profile.handle}` : '';
        if (profileBio) profileBio.textContent = profile.description || '';
        if (profileAvatar && profile.avatar) {
          profileAvatar.src = profile.avatar;
          profileAvatar.alt = `${profile.displayName || profile.handle || 'Account'} profile picture`;
          profileAvatar.hidden = false;
          if (profilePlaceholder) profilePlaceholder.hidden = true;
        }
      })
      .catch(() => { if (profileName) profileName.textContent = 'Your account'; });
      void loadAccountViewedPosts(did);
      void loadAccountSavedPosts(did);
      void loadAuthorProfileEditor(did);
    }
  }

  if (!session) {
    if (headerAccountAvatar) { headerAccountAvatar.hidden = true; headerAccountAvatar.removeAttribute('src'); }
    if (headerAccountPlaceholder) headerAccountPlaceholder.hidden = false;
    return;
  }

  const did = session.did;
  fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`)
    .then((response) => response.ok ? response.json() : Promise.reject(new Error('Profile unavailable')))
    .then((profile: { avatar?: string; displayName?: string; handle?: string }) => {
      if (session?.did !== did) return;
      const avatar = profile.avatar;
      if (headerAccountAvatar && avatar) {
        headerAccountAvatar.src = avatar;
        headerAccountAvatar.alt = `${profile.displayName || profile.handle || 'Account'} profile picture`;
        headerAccountAvatar.hidden = false;
        if (headerAccountPlaceholder) headerAccountPlaceholder.hidden = true;
      }
    })
    .catch(() => {});
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
      if (session?.did !== did || posts.length === 0) return;
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
  if (!picker || !loadingStatus) return;
  form.dataset.authorPostsLoaded = 'false';
  loadingStatus.textContent = 'Loading your published stories…';
  picker.replaceChildren();
  try {
    const response = await fetch(`/api/account/posts?author=${encodeURIComponent(did)}`, { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load your published stories.');
    const posts = await response.json() as Array<{ uri: string; title?: string; publishedAt?: string }>;
    if (session?.did !== did) return;
    const selected = new Set(selectedUris);
    const postsByUri = new Map(posts.filter((post) => typeof post.uri === 'string' && post.uri).map((post) => [post.uri, post]));

    const list = document.createElement('div');
    list.className = 'account-author-post-picker';
    if (!postsByUri.size) {
      loadingStatus.textContent = 'No published stories are available to pin yet.';
    } else {
      loadingStatus.textContent = 'Select or clear the stories you want pinned.';
    }
    postsByUri.forEach((post, uri) => {
      const label = document.createElement('label');
      label.className = 'account-author-post-option';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'pinnedPost';
      checkbox.value = uri;
      checkbox.checked = selected.has(uri);
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
      list.append(label);
    });
    picker.replaceChildren(list);
    form.dataset.authorPostsLoaded = 'true';
  } catch (error) {
    loadingStatus.textContent = error instanceof Error ? error.message : 'Could not load your published stories.';
  }
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
    const posts = await postsResponse.json() as Array<{ uri: string; path: string; title: string; publishedAt: string; cover?: string }>;
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
      const link = document.createElement('a');
      link.href = post?.path || (match ? `/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}` : '/');
      link.textContent = post?.title || 'Viewed story';
      const item = document.createElement('li');
      item.append(link);
      const metadata = document.createElement('small');
      metadata.textContent = record.value?.createdAt
        ? `Viewed ${new Date(record.value.createdAt).toLocaleDateString()}`
        : 'Viewed recently';
      item.append(metadata);
      fragment.append(item);
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
  if (!list || !status) return;
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
    const posts = await postsResponse.json() as Array<{ uri: string; path: string; title: string; publishedAt: string }>;
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
      const item = document.createElement('li');
      item.className = 'account-page__saved-item';
      const link = document.createElement('a');
      link.href = post?.path || (match ? `/${encodeURIComponent(match[1])}/${encodeURIComponent(match[2])}` : '/');
      link.textContent = post?.title || 'Saved story';
      if (createdAt && Number.isFinite(Date.parse(createdAt))) {
        const metadata = document.createElement('small');
        metadata.textContent = `Saved ${new Date(createdAt).toLocaleDateString()}`;
        link.append(metadata);
      }
      item.append(link);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'account-page__remove-save';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove ${link.textContent} from your reading list`);
      remove.addEventListener('click', async () => {
        if (session?.did !== did) return;
        remove.disabled = true;
        try {
          await repoRequest('com.atproto.repo.deleteRecord', { repo: did, collection: 'cc.coffeencode.save', rkey });
          item.remove();
          if (!list.children.length) {
            status.hidden = false;
            status.textContent = 'Stories you save will appear here.';
          }
        } catch (error) {
          status.hidden = false;
          status.textContent = errorMessage(error);
          remove.disabled = false;
        }
      });
      item.append(remove);
      fragment.append(item);
    });
    list.replaceChildren(fragment);
    status.hidden = true;
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : 'Could not load your reading list.';
  }
}

try {
  const clientOrigin = new URL(oauthMetadataVersions.member.client_id!).origin;
  if (window.location.origin !== clientOrigin) {
    throw new Error(`AT Protocol sign-in is configured for ${clientOrigin}.`);
  }
  client = getOAuthClient(initialMetadataVersion);
} catch (error) {
  initializationError = error;
}

renderAccount();

if (initializationError && authForm) {
  showAuthError(`Sign-in could not initialize: ${errorMessage(initializationError)}`);
}

const oauthReady = (async () => {
  if (!client) return;
  try {
    const initialized = await initializeOAuthClient(client);
    if (initialized) {
      session = initialized.session;
      if ('state' in initialized) callbackState = initialized.state;
    }
  } catch (error) {
    initializationError = error;
    if (authForm) showAuthError(`Sign-in could not initialize: ${errorMessage(error)}`);
  } finally {
    if (storedPendingMetadataVersion() === initialMetadataVersion) clearPendingMetadataVersion();
  }

  renderAccount();
  if (callbackState !== undefined && window.location.pathname === '/auth') {
    window.location.replace(safeReturnPath(callbackState));
  }
})();

createCoffeeAccountButton?.addEventListener('click', async () => {
  clearAuthError();
  if (!client) {
    showAuthError(`Sign-in could not initialize: ${errorMessage(initializationError)}`);
    return;
  }

  if (!signupInviteCode) {
    createCoffeeAccountButton.disabled = true;
    createCoffeeAccountButton.textContent = 'Getting an invite code…';
    try {
      const response = await fetch('/api/invite-code', { cache: 'no-store' });
      if (!response.ok) throw new Error('Could not get a signup invite code. Please try again shortly.');
      const result = await response.json() as { code?: unknown };
      if (typeof result.code !== 'string' || !result.code) throw new Error('Invite service returned an invalid code.');
      signupInviteCode = result.code;
      if (inviteCodeElement) inviteCodeElement.textContent = signupInviteCode;
      if (invitePanel) invitePanel.hidden = false;
      if (inviteStatus) inviteStatus.textContent = 'Copy this invite code. The Coffee & Code account page will ask you to paste it during sign-up.';
      createCoffeeAccountButton.textContent = 'Continue to account creation';
      createCoffeeAccountButton.disabled = false;
      return;
    } catch (error) {
      showAuthError(errorMessage(error));
      createCoffeeAccountButton.textContent = 'Create a Coffee & Code account';
      createCoffeeAccountButton.disabled = false;
      return;
    }
  }

  createCoffeeAccountButton.disabled = true;
  createCoffeeAccountButton.textContent = 'Connecting…';
  try {
    const signInClient = await selectedOAuthClient('account.coffeencode.cc');
    const returnPath = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
    await signInClient.signInRedirect('https://account.coffeencode.cc', { state: returnPath, prompt: 'create' });
  } catch (error) {
    clearPendingMetadataVersion();
    showAuthError(errorMessage(error));
    createCoffeeAccountButton.disabled = false;
    createCoffeeAccountButton.textContent = 'Continue to account creation';
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

async function listOwnForumVotes(activeSession: OAuthSession) {
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

window.coffeeAndCodeAuth = {
  getDid: async () => {
    await oauthReady;
    return session?.did;
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
};

async function uploadForumImages(images: ForumImageInput[], activeSession: OAuthSession) {
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

if (authForm) {
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

    try {
      const signInClient = await selectedOAuthClient(handle);
      const returnPath = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
      await signInClient.signInRedirect(handle, { state: returnPath });
    } catch (error) {
      clearPendingMetadataVersion();
      showAuthError(errorMessage(error));
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Continue';
      }
    }
  });
}

signoutButton?.addEventListener('click', async () => {
  await oauthReady;
  if (!session) return;
  signoutButton.disabled = true;
  try {
    await session.signOut();
    window.location.reload();
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
  if (!match) throw new Error('The account provider returned an invalid follow record URI.');
  return match[1];
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

document.querySelectorAll<HTMLElement>('[data-author-follow]').forEach((container) => {
  const button = container.querySelector<HTMLButtonElement>('[data-author-follow-button]');
  const status = container.querySelector<HTMLElement>('[data-author-follow-status]');
  const did = container.dataset.authorDid;
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
        const oldSubscription = subscriptionRecord!;
        await deleteFollowRecord(subscriptionCollection, oldSubscription.uri, activeDid);
        compensations.push(async () => {
          await createFollowRecord(subscriptionCollection, {
            ...oldSubscription.value,
            $type: subscriptionCollection,
          }, activeDid);
        });
        const oldFollow = followRecord!;
        await deleteFollowRecord(followCollection, oldFollow.uri, activeDid);
        compensations.push(async () => {
          await createFollowRecord(followCollection, {
            ...oldFollow.value,
            $type: followCollection,
          }, activeDid);
        });
      }

      await loadFollowState();
      if (status) status.textContent = shouldFollow ? 'Following on Bluesky and Coffee & Code.' : 'Unfollowed on Bluesky and Coffee & Code.';
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

  const refreshReactionState = async () => {
    await oauthReady;
    if (!session) return;
    const version = reactionActionVersion;
    const state = await getOwnRecords(documentUri, session.did);
    if (version !== reactionActionVersion) return;
    container.querySelector<HTMLButtonElement>('[data-reaction="like"]')?.setAttribute('aria-pressed', String(state.liked));
    container.querySelector<HTMLButtonElement>('[data-reaction="dislike"]')?.setAttribute('aria-pressed', String(state.disliked));
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
    buttons.forEach((item) => { item.disabled = true; });
    if (status) status.textContent = 'Saving your reaction…';
    const beforeCounts = { like: readReactionCount('like'), dislike: readReactionCount('dislike') };

    let wasSelected = false;
    try {
      const rkey = await recordKey(documentUri);
      const current = await getOwnRecords(documentUri, activeSession.did);
      wasSelected = kind === 'like' ? current.liked : current.disliked;
      const oppositeSelected = kind === 'like' ? current.disliked : current.liked;

      if (wasSelected) {
        await repoRequest('com.atproto.repo.deleteRecord', {
          repo: activeSession.did,
          collection: collections[kind],
          rkey,
        });
      } else {
        const createdAt = new Date().toISOString();
        await repoRequest('com.atproto.repo.createRecord', {
          repo: activeSession.did,
          collection: collections[kind],
          rkey,
          record: { $type: collections[kind], document: documentUri, createdAt },
        });

        if (oppositeSelected) {
          try {
            await repoRequest('com.atproto.repo.deleteRecord', {
              repo: activeSession.did,
              collection: collections[opposite],
              rkey,
            });
          } catch (error) {
            try {
              await repoRequest('com.atproto.repo.deleteRecord', {
                repo: activeSession.did,
                collection: collections[kind],
                rkey,
              });
            } catch {
              throw new Error('Your new reaction was saved, but the previous reaction could not be removed. Refresh the page to see the current state.');
            }
            throw error;
          }
        }

        if (kind === 'like') {
          try {
            const recommendationCollection = 'site.standard.graph.recommend';
            const recommendationExists = current.recommended;
            if (!recommendationExists) {
              await repoRequest('com.atproto.repo.createRecord', {
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
      }

      const liked = kind === 'like' ? !wasSelected : false;
      const disliked = kind === 'dislike' ? !wasSelected : false;
      if (actionVersion !== reactionActionVersion) return;
      container.querySelector<HTMLButtonElement>('[data-reaction="like"]')?.setAttribute('aria-pressed', String(liked));
      container.querySelector<HTMLButtonElement>('[data-reaction="dislike"]')?.setAttribute('aria-pressed', String(disliked));
      const delta = { like: 0, dislike: 0 };
      if (kind === 'like') delta.like = wasSelected ? -1 : 1;
      else delta.dislike = wasSelected ? -1 : 1;
      if (!wasSelected && oppositeSelected) delta[opposite] = -1;
      if (beforeCounts.like !== undefined) writeReactionCount('like', beforeCounts.like + delta.like);
      if (beforeCounts.dislike !== undefined) writeReactionCount('dislike', beforeCounts.dislike + delta.dislike);
      void refreshReactionCounts(beforeCounts, delta, actionVersion);

      if (status) {
        status.textContent = wasSelected
          ? `Your ${kind} was removed.`
          : kind === 'like' ? 'You liked this post.' : 'You disliked this post.';
      }
    } catch (error) {
      if (status) status.textContent = errorMessage(error);
    } finally {
      buttons.forEach((item) => { item.disabled = false; });
    }
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

  button.addEventListener('click', async () => {
    await oauthReady;
    if (!session) {
      const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/auth?returnTo=${encodeURIComponent(safeReturnPath(currentPath))}`);
      return;
    }
    const activeSession = session;
    const beforeCount = readCount();
    button.disabled = true;
    try {
      const rkey = await recordKey(documentUri);
      const current = await getOwnRecords(documentUri, activeSession.did);
      if (current.saved) {
        await repoRequest('com.atproto.repo.deleteRecord', { repo: activeSession.did, collection: 'cc.coffeencode.save', rkey });
      } else {
        await repoRequest('com.atproto.repo.createRecord', {
          repo: activeSession.did,
          collection: 'cc.coffeencode.save',
          rkey,
          record: { $type: 'cc.coffeencode.save', target: { document: documentUri }, createdAt: new Date().toISOString() },
        });
      }
      const saved = !current.saved;
      button.setAttribute('aria-pressed', String(saved));
      button.querySelector('i')?.classList.replace(saved ? 'fa-regular' : 'fa-solid', saved ? 'fa-solid' : 'fa-regular');
      const label = button.childNodes[1];
      if (label) label.textContent = saved ? ' Saved ' : ' Save ';
      if (beforeCount !== undefined) updateCount(beforeCount + (saved ? 1 : -1));
      if (status) status.textContent = saved ? 'Story saved to your account.' : 'Story removed from your saved posts.';

      if (beforeCount !== undefined) {
        for (const delay of [1200, 1800, 2600, 4000, 6000]) {
          await new Promise((resolve) => window.setTimeout(resolve, delay));
          const response = await fetch(`/api/reactions?subject=${encodeURIComponent(documentUri)}&_=${Date.now()}`, { cache: 'no-store' });
          if (!response.ok) continue;
          const counts = await response.json() as { saves?: number };
          if (Number.isFinite(counts.saves) && (saved ? Number(counts.saves) >= beforeCount + 1 : Number(counts.saves) < beforeCount)) {
            updateCount(Number(counts.saves));
            break;
          }
        }
      }
    } catch (error) {
      if (status) status.textContent = errorMessage(error);
    } finally {
      button.disabled = false;
    }
  });
});
