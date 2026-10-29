function forumAuth() {
  if (!window.coffeeAndCodeAuth) throw new Error('The sign-in service is still loading. Refresh and try again.');
  return window.coffeeAndCodeAuth;
}

async function requireForumDid() {
  const did = await forumAuth().getDid();
  if (did) return did;
  const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
  throw new Error('Taking you to sign in before continuing.');
}

function forumStatus(container, message, isError = false) {
  let status = container.querySelector('[data-forum-status]');
  if (!status && isError) {
    status = document.createElement('p');
    status.className = 'forum-status';
    status.setAttribute('role', 'status');
    container.append(status);
  }
  if (!status) return;
  status.textContent = message;
  status.dataset.error = String(isError);
}

function forumImages(form, maximum) {
  const files = Array.from(form.querySelector('input[name="images"]')?.files || []);
  if (files.length > maximum) throw new Error(`Choose no more than ${maximum} images.`);
  const altText = form.querySelector('[name="imageAlts"]')?.value || '';
  const alts = altText.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  if (files.length !== alts.length) {
    throw new Error(files.length ? 'Provide one non-empty alt text line for each image.' : 'Remove the unused image alt text.');
  }
  return files.map((file, index) => ({ file, alt: alts[index] }));
}

function forumTags(form) {
  const tags = String(new FormData(form).get('tags') || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
  const unique = [...new Set(tags.map((tag) => tag.toLowerCase()))];
  if (tags.length > 8 || unique.length !== tags.length || tags.some((tag) => tag.length > 32)) {
    throw new Error('Use up to eight unique tags, each no longer than 32 characters.');
  }
  return tags;
}

function showForumError(container, error) {
  const message = error instanceof Error ? error.message : 'The forum action could not be completed.';
  forumStatus(container, `${message} Sign in with an account that has the required permissions, then try again.`, true);
}

document.querySelectorAll('[data-forum-post]').forEach((form) => {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!(form instanceof HTMLFormElement)) return;
    const button = form.querySelector('button[type="submit"]');
    if (button) button.disabled = true;
    try {
      const data = new FormData(form);
      const images = forumImages(form, 10);
      await requireForumDid();
      await forumAuth().createForumPost(
        form.dataset.forumUri,
        String(data.get('title') || ''),
        String(data.get('content') || ''),
        forumTags(form),
        images,
      );
      forumStatus(form, 'Your post is published. Reloading…');
      window.location.reload();
    } catch (error) {
      showForumError(form, error);
      if (button) button.disabled = false;
    }
  });
});

function makeReplyForm(thread, parentUri, parentCid) {
  const form = document.createElement('form');
  form.className = 'forum-reply-form';
  form.dataset.forumReplyInline = '';
  form.dataset.parentUri = parentUri;
  form.dataset.parentCid = parentCid;
  form.innerHTML = `
    <p class="forum-status" data-forum-status role="status"></p>
    <label>Reply <textarea name="content" rows="4" maxlength="30000" required></textarea></label>
    <label>Images <input name="images" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple></label>
    <label>Image alt text (one line per selected image) <textarea name="imageAlts" rows="2"></textarea></label>
    <button type="submit" class="login-button">Post reply</button>`;
  const threadUri = thread.dataset.rootUri;
  if (!threadUri) throw new Error('The thread root is missing.');
  return form;
}

document.querySelectorAll('[data-reply-to]').forEach((button) => {
  button.addEventListener('click', () => {
    const article = button.closest('.forum-reply');
    const thread = button.closest('[data-forum-thread]');
    if (!(article instanceof HTMLElement) || !(thread instanceof HTMLElement)) return;
    const existing = article.querySelector('[data-forum-reply-inline]');
    if (existing) {
      existing.remove();
      return;
    }
    const parentUri = button.dataset.replyTo;
    const parentCid = button.dataset.replyCid;
    if (!parentUri || !parentCid) return;
    const form = makeReplyForm(thread, parentUri, parentCid);
    button.insertAdjacentElement('afterend', form);
    form.querySelector('textarea[name="content"]')?.focus();
  });
});

document.querySelectorAll('[data-forum-reply]').forEach((form) => {
  form.addEventListener('submit', (event) => submitForumReply(event, form));
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (form instanceof HTMLFormElement && form.matches('[data-forum-reply-inline]')) {
    void submitForumReply(event, form);
  }
});

async function submitForumReply(event, form) {
  event.preventDefault();
  const thread = form.closest('[data-forum-thread]');
  if (!(thread instanceof HTMLElement)) return;
  const button = form.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    const data = new FormData(form);
    const images = forumImages(form, 4);
    const root = { uri: thread.dataset.rootUri, cid: thread.dataset.rootCid };
    const parent = form.dataset.parentUri
      ? { uri: form.dataset.parentUri, cid: form.dataset.parentCid }
      : root;
    if (!root.uri || !root.cid || !parent.uri || !parent.cid) {
      throw new Error('The reply target could not be validated. Reload the discussion and try again.');
    }
    await requireForumDid();
    await forumAuth().createForumReply(root, parent, String(data.get('content') || ''), images);
    forumStatus(form, 'Your reply is published. Reloading…');
    window.location.reload();
  } catch (error) {
    showForumError(form, error);
    if (button) button.disabled = false;
  }
}

const voteContainers = Array.from(document.querySelectorAll('[data-forum-vote]'));
void (async () => {
  const did = await forumAuth().getDid();
  if (!did) return;
  const subjectUris = voteContainers.map((container) => container.dataset.subjectUri).filter(Boolean);
  const currentVotes = await forumAuth().getForumVotes(subjectUris);
  for (const container of voteContainers) {
    const current = currentVotes[container.dataset.subjectUri];
    container.querySelectorAll('[data-vote]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.vote === current));
    });
  }
})().catch((error) => console.error('Could not load forum vote state:', error));

voteContainers.forEach((container) => {
  const subjectUri = container.dataset.subjectUri;
  const subjectCid = container.dataset.subjectCid;
  if (!subjectUri || !subjectCid) return;
  const buttons = Array.from(container.querySelectorAll('[data-vote]'));
  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const direction = button.dataset.vote;
      if (direction !== 'up' && direction !== 'down') return;
      const score = container.querySelector('[data-vote-score]');
      const previous = buttons.find((item) => item.getAttribute('aria-pressed') === 'true')?.dataset.vote;
      const next = previous === direction ? undefined : direction;
      buttons.forEach((item) => { item.disabled = true; });
      try {
        await requireForumDid();
        await forumAuth().setForumVote({ uri: subjectUri, cid: subjectCid }, next);
        buttons.forEach((item) => item.setAttribute('aria-pressed', String(item.dataset.vote === next)));
        if (score) {
          const change = (next === 'up' ? 1 : next === 'down' ? -1 : 0)
            - (previous === 'up' ? 1 : previous === 'down' ? -1 : 0);
          score.textContent = String((Number(score.textContent) || 0) + change);
        }
      } catch (error) {
        showForumError(container.closest('article') || container, error);
      } finally {
        buttons.forEach((item) => { item.disabled = false; });
      }
    });
  });
});

document.querySelectorAll('[data-forum-moderation]').forEach((controls) => {
  const moderators = (controls.dataset.moderators || '').split(',').map((did) => did.toLowerCase());
  void (async () => {
    const did = await forumAuth().getDid();
    if (did && moderators.includes(did.toLowerCase())) controls.classList.add('is-visible');
  })().catch((error) => console.error('Could not check forum moderator permissions:', error));
  controls.querySelectorAll('[data-moderation-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const requestedAction = button.dataset.moderationAction;
      const actions = {
        pin: controls.dataset.pinned === 'true' ? 'unpin' : 'pin',
        lock: controls.dataset.locked === 'true' ? 'unlock' : 'lock',
        hide: controls.dataset.hidden === 'true' ? 'unhide' : 'hide',
        remove: 'remove',
      };
      const action = actions[requestedAction];
      const forumUri = controls.dataset.forumUri;
      const subjectUri = controls.dataset.subjectUri;
      const subjectCid = controls.dataset.subjectCid;
      if (!action || !forumUri || !subjectUri || !subjectCid) return;
      if (action === 'remove' && !window.confirm('Remove this forum post or reply?')) return;
      button.disabled = true;
      try {
        await requireForumDid();
        await forumAuth().createForumModeration(
          forumUri,
          { uri: subjectUri, cid: subjectCid },
          action,
          moderators,
        );
        window.location.reload();
      } catch (error) {
        showForumError(controls.closest('article') || controls, error);
        button.disabled = false;
      }
    });
  });
});
