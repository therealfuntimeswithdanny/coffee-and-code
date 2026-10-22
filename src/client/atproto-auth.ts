import { BrowserOAuthClient } from '@atproto/oauth-client-browser';

const clientId = `${window.location.origin}/oauth-client-metadata.json`;
const client = await BrowserOAuthClient.load({ clientId });
const initialized = await client.init();
let session = initialized?.session;

function safeReturnPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value === '/auth') return '/';
  return value;
}

function repoRequest(path: string, body?: unknown) {
  if (!session) throw new Error('Sign in with your AT Protocol account to react.');
  return session.fetchHandler(`/xrpc/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function repoQuery(collection: string, rkey: string) {
  const params = new URLSearchParams({ repo: session?.did || '', collection, rkey });
  return `com.atproto.repo.getRecord?${params.toString()}`;
}

function recordKey(document: string) {
  return crypto.subtle.digest('SHA-256', new TextEncoder().encode(document))
    .then((digest) => `post-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`);
}

async function recordExists(collection: string, rkey: string) {
  try {
    const response = await repoRequest(repoQuery(collection, rkey));
    if (!response.ok) return false;
    return true;
  } catch {
    return false;
  }
}

const authForm = document.querySelector<HTMLFormElement>('[data-auth-form]');
const authAccount = document.querySelector<HTMLElement>('[data-auth-account]');
const authName = document.querySelector<HTMLElement>('[data-auth-name]');
const authError = document.querySelector<HTMLElement>('[data-auth-error]');
const signoutButton = document.querySelector<HTMLButtonElement>('[data-auth-signout]');

if (authForm) {
  if (session) {
    authForm.hidden = true;
    if (authAccount) authAccount.hidden = false;
    if (authName) authName.textContent = session.sub;
  }
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const handle = new FormData(authForm).get('handle')?.toString().trim();
    if (!handle) return;
    const submit = authForm.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (submit) { submit.disabled = true; submit.textContent = 'Connecting…'; }
    try {
      sessionStorage.setItem('cc-auth-return', safeReturnPath(new URLSearchParams(location.search).get('returnTo')));
      await client.signInRedirect(handle);
    } catch (error) {
      if (authError) { authError.hidden = false; authError.textContent = error instanceof Error ? error.message : 'Unable to start sign-in.'; }
      if (submit) { submit.disabled = false; submit.textContent = 'Continue with AT Protocol'; }
    }
  });
}

signoutButton?.addEventListener('click', async () => {
  try {
    await session?.signOut();
  } finally {
    window.location.reload();
  }
});

document.querySelectorAll<HTMLAnchorElement>('.login-button').forEach((link) => {
  if (!session) return;
  link.textContent = 'Account';
  link.setAttribute('aria-label', `Signed in as ${session.sub}`);
});

if (initialized?.state !== undefined) {
  const returnPath = safeReturnPath(sessionStorage.getItem('cc-auth-return'));
  sessionStorage.removeItem('cc-auth-return');
  if (location.pathname === '/auth') window.location.replace(returnPath);
}

document.querySelectorAll<HTMLElement>('[data-reaction-subject]').forEach((container) => {
  const subject = container.dataset.reactionSubject;
  const status = container.querySelector<HTMLElement>('.article-reactions__status');
  if (!subject) return;

  const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-reaction]'));
  const collections = {
    like: 'cc.coffeencode.interact.like',
    dislike: 'cc.coffeencode.interact.dislike',
  } as const;

  const updateState = async () => {
    if (!session) return;
    const rkey = await recordKey(subject);
    const [liked, disliked] = await Promise.all([
      recordExists(collections.like, rkey),
      recordExists(collections.dislike, rkey),
    ]);
    container.querySelector<HTMLButtonElement>('[data-reaction="like"]')?.setAttribute('aria-pressed', String(liked));
    container.querySelector<HTMLButtonElement>('[data-reaction="dislike"]')?.setAttribute('aria-pressed', String(disliked));
  };

  void updateState();
  buttons.forEach((button) => button.addEventListener('click', async () => {
    if (!session) {
      sessionStorage.setItem('cc-auth-return', `${location.pathname}${location.search}${location.hash}`);
      window.location.assign(`/auth?returnTo=${encodeURIComponent(`${location.pathname}${location.search}${location.hash}`)}`);
      return;
    }
    const kind = button.dataset.reaction as keyof typeof collections;
    if (!(kind in collections)) return;
    const other = kind === 'like' ? 'dislike' : 'like';
    const repo = session.did;
    const rkey = await recordKey(subject);
    buttons.forEach((item) => { item.disabled = true; });
    if (status) status.textContent = 'Saving your reaction…';
    try {
      const wasSelected = await recordExists(collections[kind], rkey);
      const oppositeSelected = await recordExists(collections[other], rkey);
      if (wasSelected) {
        const response = await repoRequest('com.atproto.repo.deleteRecord', { repo, collection: collections[kind], rkey });
        if (!response.ok) throw new Error(`Could not remove reaction (${response.status}).`);
      } else {
        if (oppositeSelected) {
          const response = await repoRequest('com.atproto.repo.deleteRecord', { repo, collection: collections[other], rkey });
          if (!response.ok) throw new Error(`Could not update reaction (${response.status}).`);
        }
        const response = await repoRequest('com.atproto.repo.createRecord', {
          repo, collection: collections[kind], rkey,
          record: { $type: collections[kind], document: subject, createdAt: new Date().toISOString() },
        });
        if (!response.ok) throw new Error(`Could not save reaction (${response.status}).`);
      }
      await updateState();
      const response = await fetch(`/api/reactions?subject=${encodeURIComponent(subject)}`);
      if (response.ok) {
        const counts = await response.json() as { likes: number; dislikes: number };
        (['like', 'dislike'] as const).forEach((reaction) => {
          const count = container.querySelector<HTMLElement>(`[data-reaction-count="${reaction}"]`);
          if (count) count.textContent = Number(counts[reaction] || 0).toLocaleString();
        });
      }
      if (status) status.textContent = wasSelected ? 'Reaction removed.' : 'Your reaction was recorded.';
    } catch (error) {
      if (status) status.textContent = error instanceof Error ? error.message : 'Could not save your reaction. Please try again.';
    } finally {
      buttons.forEach((item) => { item.disabled = false; });
    }
  }));
});
