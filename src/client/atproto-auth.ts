import {
  BrowserOAuthClient,
  OAuthCallbackError,
  type OAuthClientMetadataInput,
  type OAuthSession,
} from '@atproto/oauth-client-browser';
import rawClientMetadata from '../../media/oauth-client-metadata-v5.json';

// The same file is published as a Cloudflare static asset at the client_id URL.
// Embedding it here avoids a second metadata fetch in the browser and prevents
// the browser config from drifting from the public document.
const clientMetadata = rawClientMetadata as OAuthClientMetadataInput;
const clientOrigin = new URL(clientMetadata.client_id!).origin;
const handleResolver = 'https://database.coffeencode.cc';

let client: BrowserOAuthClient | undefined;
let session: OAuthSession | undefined;
let initializationError: unknown;
let callbackState: string | null | undefined;

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
const coffeeAccountButton = document.querySelector<HTMLButtonElement>('[data-coffee-account]');
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
      toggleCommentLike: (commentUri: string, isLiked: boolean) => Promise<void>;
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

function renderAccount() {
  const loginLinks = document.querySelectorAll<HTMLElement>('[data-login-link]');
  const displayName = session?.sub || '';
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
    if (authName) authName.textContent = session.sub;
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
    const profileDid = accountPage.querySelector<HTMLElement>('[data-profile-did]');
    const profileAvatar = accountPage.querySelector<HTMLImageElement>('[data-profile-avatar]');
    const profilePlaceholder = accountPage.querySelector<HTMLElement>('[data-profile-placeholder]');
    if (profileDid) profileDid.textContent = did;
    fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`)
      .then((response) => response.ok ? response.json() : Promise.reject(new Error('Profile unavailable')))
      .then((profile: { avatar?: string; displayName?: string; handle?: string; description?: string }) => {
        if (session?.did !== did) return;
        if (profileName) profileName.textContent = profile.displayName || profile.handle || did;
        if (profileHandle) profileHandle.textContent = profile.handle ? `@${profile.handle}` : '';
        if (profileBio) profileBio.textContent = profile.description || '';
        if (profileAvatar && profile.avatar) {
          profileAvatar.src = profile.avatar;
          profileAvatar.alt = `${profile.displayName || profile.handle || did}'s profile picture`;
          profileAvatar.hidden = false;
          if (profilePlaceholder) profilePlaceholder.hidden = true;
        }
      })
      .catch(() => { if (profileName) profileName.textContent = session?.sub || did; });
      void loadAccountViewedPosts(did);
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
        headerAccountAvatar.alt = `${profile.displayName || profile.handle || did}'s profile picture`;
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
  if (!section || !editButton || !form) return;

  try {
    const query = new URLSearchParams({ repo: did, collection: 'cc.coffeencode.author.profile', rkey: 'self' });
    const response = await repoRequest(`com.atproto.repo.getRecord?${query.toString()}`);
    const result = await response.json() as { value?: Record<string, unknown> };
    const value = result.value;
    if (session?.did !== did || value?.$type !== 'cc.coffeencode.author.profile') return;

    accountAuthorRecord = value;
    accountAuthorDid = did;
    section.hidden = false;
    editButton.hidden = false;
    editButton.onclick = () => {
      if (!accountAuthorRecord || accountAuthorDid !== session?.did) return;
      form.reset();
      const displayName = form.elements.namedItem('displayName') as HTMLInputElement;
      const pronouns = form.elements.namedItem('pronouns') as HTMLInputElement;
      const description = form.elements.namedItem('description') as HTMLTextAreaElement;
      displayName.value = typeof accountAuthorRecord.displayName === 'string' ? accountAuthorRecord.displayName : '';
      pronouns.value = typeof accountAuthorRecord.pronouns === 'string' ? accountAuthorRecord.pronouns : '';
      description.value = typeof accountAuthorRecord.description === 'string' ? accountAuthorRecord.description : '';
      if (status) status.textContent = '';
      form.hidden = false;
      editButton.hidden = true;
      const currentPins = Array.isArray(accountAuthorRecord.pinnedPosts)
        ? accountAuthorRecord.pinnedPosts.filter((uri): uri is string => typeof uri === 'string')
        : [];
      void loadAuthorPostPicker(did, form, currentPins);
    };
    accountPage.querySelector<HTMLButtonElement>('[data-cancel-author-edit]')!.onclick = () => {
      form.hidden = true;
      editButton.hidden = false;
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
      const pins = data.getAll('pinnedPost').map((uri) => uri.toString().trim()).filter(Boolean);
      // Post records may use valid AT Protocol rkeys outside the TID character
      // subset, so validate the AT URI structure without over-restricting keys.
      const validPostUri = /^at:\/\/did:[^/\s?#]+\/site\.standard\.document\/[^/\s?#]+$/;
      if (pins.some((uri) => !validPostUri.test(uri))) {
        if (status) status.textContent = 'Each pinned post must be a valid site.standard.document AT URI.';
        return;
      }
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
        if (bannerFile) next.banner = await uploadAuthorImage(bannerFile);
        else if (removeBanner) delete next.banner;
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
  } catch {
    // A missing record means this account is not an author account.
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
    const postsByUri = new Map(posts.map((post) => [post.uri, post]));
    selectedUris.forEach((uri) => {
      if (!postsByUri.has(uri)) postsByUri.set(uri, { uri, title: 'Pinned story', publishedAt: '' });
    });

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

try {
  if (window.location.origin !== clientOrigin) {
    throw new Error(`AT Protocol sign-in is configured for ${clientOrigin}.`);
  }

  client = new BrowserOAuthClient({
    clientMetadata,
    handleResolver,
    onSessionDeleted: (did) => {
      if (session?.did !== did) return;
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
  if (!client) return;
  try {
    const initialized = await client.init();
    if (initialized) {
      session = initialized.session;
      if ('state' in initialized) callbackState = initialized.state;
    }
  } catch (error) {
    initializationError = error;
    if (authForm) showAuthError(`Sign-in could not initialize: ${errorMessage(error)}`);
  }

  renderAccount();
  if (callbackState !== undefined && window.location.pathname === '/auth') {
    window.location.replace(safeReturnPath(callbackState));
  }
})();

coffeeAccountButton?.addEventListener('click', async () => {
  clearAuthError();
  if (!client) {
    showAuthError(`Sign-in could not initialize: ${errorMessage(initializationError)}`);
    return;
  }
  coffeeAccountButton.disabled = true;
  coffeeAccountButton.textContent = 'Connecting…';
  try {
    await oauthReady;
    const returnPath = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
    await client.signInRedirect('https://account.coffeencode.cc', { state: returnPath });
  } catch (error) {
    showAuthError(errorMessage(error));
    coffeeAccountButton.disabled = false;
    coffeeAccountButton.textContent = 'Continue with Coffee & Code';
  }
});

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
    await oauthReady;
    const returnPath = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
    await client.signInRedirect('https://account.coffeencode.cc', { state: returnPath, prompt: 'create' });
  } catch (error) {
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
  toggleCommentLike: async (commentUri: string, isLiked: boolean) => {
    await oauthReady;
    const activeSession = requireSession();
    const collection = 'cc.coffeencode.comment.like';
    const rkey = await recordKey(commentUri);
    if (isLiked) {
      await repoRequest('com.atproto.repo.deleteRecord', { repo: activeSession.did, collection, rkey });
      return;
    }
    await repoRequest('com.atproto.repo.createRecord', {
      repo: activeSession.did,
      collection,
      rkey,
      record: { $type: collection, subject: { uri: commentUri }, createdAt: new Date().toISOString() },
    });
  },
};

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
      await oauthReady;
      const returnPath = safeReturnPath(new URLSearchParams(window.location.search).get('returnTo'));
      await client.signInRedirect(handle, { state: returnPath });
    } catch (error) {
      showAuthError(errorMessage(error));
      if (submit) {
        submit.disabled = false;
        submit.textContent = 'Continue with existing account';
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
    throw new Error('Your account has not granted this permission yet. Log out and sign in again to approve the updated permissions.');
  }
  const detail = [payload?.error, payload?.message].filter(Boolean).join(': ');
  throw new Error(detail || `AT Protocol request failed (${response.status}).`);
}

async function recordKey(document: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(document));
  return `post-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function getOwnRecords(document: string, did: string) {
  const response = await fetch(`/api/reactions?subject=${encodeURIComponent(document)}&did=${encodeURIComponent(did)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Could not load your reaction state.');
  return await response.json() as { liked: boolean; disliked: boolean; recommended: boolean };
}

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
        if (viewCount) viewCount.textContent = `${Number(counts.views || 0).toLocaleString()} views`;
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

  const refreshReactionState = async () => {
    await oauthReady;
    if (!session) return;
    const state = await getOwnRecords(documentUri, session.did);
    container.querySelector<HTMLButtonElement>('[data-reaction="like"]')?.setAttribute('aria-pressed', String(state.liked));
    container.querySelector<HTMLButtonElement>('[data-reaction="dislike"]')?.setAttribute('aria-pressed', String(state.disliked));
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
    const rkey = await recordKey(documentUri);
    buttons.forEach((item) => { item.disabled = true; });
    if (status) status.textContent = 'Saving your reaction…';

    let recommendationFailed = false;
    let wasSelected = false;
    try {
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
          } catch {
            recommendationFailed = true;
          }
        }
      }

      await refreshReactionState();
      const response = await fetch(`/api/reactions?subject=${encodeURIComponent(documentUri)}`, { cache: 'no-store' });
      if (response.ok) {
        const counts = await response.json() as { likes: number; dislikes: number };
        (['like', 'dislike'] as const).forEach((reaction) => {
          const count = container.querySelector<HTMLElement>(`[data-reaction-count="${reaction}"]`);
          const total = reaction === 'like' ? counts.likes : counts.dislikes;
          if (count) count.textContent = Number(total || 0).toLocaleString();
        });
      }

      if (status) {
        status.textContent = recommendationFailed
          ? 'Your like was saved, but its recommendation could not be created. Sign out and back in to approve updated permissions.'
          : wasSelected ? 'Reaction removed.' : 'Your reaction was recorded.';
      }
    } catch (error) {
      if (status) status.textContent = errorMessage(error);
    } finally {
      buttons.forEach((item) => { item.disabled = false; });
    }
  }));
});
