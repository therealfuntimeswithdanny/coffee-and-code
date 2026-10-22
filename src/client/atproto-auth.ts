import {
  BrowserOAuthClient,
  OAuthCallbackError,
  type OAuthClientMetadataInput,
  type OAuthSession,
} from '@atproto/oauth-client-browser';
import rawClientMetadata from '../../media/oauth-client-metadata.json';

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
const authAccount = document.querySelector<HTMLElement>('[data-auth-account]');
const authName = document.querySelector<HTMLElement>('[data-auth-name]');
const authError = document.querySelector<HTMLElement>('[data-auth-error]');
const signoutButton = document.querySelector<HTMLButtonElement>('[data-auth-signout]');

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
  if (session) {
    if (authForm) authForm.hidden = true;
    if (authAccount) authAccount.hidden = false;
    if (authName) authName.textContent = session.sub;
  } else {
    if (authForm) authForm.hidden = false;
    if (authAccount) authAccount.hidden = true;
    if (authName) authName.textContent = '';
  }

  document.querySelectorAll<HTMLAnchorElement>('.login-button').forEach((link) => {
    if (!session) return;
    link.textContent = 'Account';
    link.setAttribute('aria-label', `Signed in as ${session.sub}`);
  });
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
        submit.textContent = 'Continue with AT Protocol';
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
  const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (response.status === 401 || response.status === 403) {
    throw new Error('Your account has not granted this permission yet. Log out and sign in again to approve the updated permissions.');
  }
  throw new Error(payload?.message || payload?.error || `AT Protocol request failed (${response.status}).`);
}

function recordQuery(collection: string, rkey: string) {
  const params = new URLSearchParams({ repo: requireSession().did, collection, rkey });
  return `com.atproto.repo.getRecord?${params}`;
}

async function recordKey(document: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(document));
  return `post-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function recordExists(collection: string, rkey: string) {
  const response = await requireSession().fetchHandler(`/xrpc/${recordQuery(collection, rkey)}`);
  if (response.ok) return true;

  const payload = await response.json().catch(() => null) as { error?: string; message?: string } | null;
  if (response.status === 400 && payload?.error === 'RecordNotFound') return false;
  if (response.status === 401 || response.status === 403) {
    throw new Error('Your account has not granted this permission yet. Log out and sign in again to approve the updated permissions.');
  }
  throw new Error(payload?.message || payload?.error || `Could not read your reaction (${response.status}).`);
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
        const response = await fetch(`/api/reactions?subject=${encodeURIComponent(documentUri)}&_=${Date.now()}`);
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
    const rkey = await recordKey(documentUri);
    const [liked, disliked] = await Promise.all([
      recordExists(collections.like, rkey),
      recordExists(collections.dislike, rkey),
    ]);
    container.querySelector<HTMLButtonElement>('[data-reaction="like"]')?.setAttribute('aria-pressed', String(liked));
    container.querySelector<HTMLButtonElement>('[data-reaction="dislike"]')?.setAttribute('aria-pressed', String(disliked));
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
      wasSelected = await recordExists(collections[kind], rkey);
      const oppositeSelected = await recordExists(collections[opposite], rkey);

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
            const recommendationExists = await recordExists(recommendationCollection, rkey);
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
      const response = await fetch(`/api/reactions?subject=${encodeURIComponent(documentUri)}`);
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
