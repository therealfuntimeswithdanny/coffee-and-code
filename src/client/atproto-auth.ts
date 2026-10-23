import {
  BrowserOAuthClient,
  OAuthCallbackError,
  type OAuthClientMetadataInput,
  type OAuthSession,
} from '@atproto/oauth-client-browser';
import rawClientMetadata from '../../media/oauth-client-metadata-v2.json';

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

declare global {
  interface Window {
    coffeeAndCodeAuth?: {
      getDid: () => Promise<string | undefined>;
      createComment: (record: { subject: { uri: string }; reply?: { parent: { uri: string } }; text: string; createdAt: string }) => Promise<void>;
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

window.coffeeAndCodeAuth = {
  getDid: async () => {
    await oauthReady;
    return session?.did;
  },
  createComment: async (record) => {
    await oauthReady;
    const activeSession = requireSession();
    await repoRequest('com.atproto.repo.createRecord', {
      repo: activeSession.did,
      collection: 'cc.coffeencode.comment',
      record: { $type: 'cc.coffeencode.comment', ...record },
    });
  },
  toggleCommentLike: async (commentUri, isLiked) => {
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
  const response = await fetch(`/api/reactions?subject=${encodeURIComponent(document)}&did=${encodeURIComponent(did)}`);
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
