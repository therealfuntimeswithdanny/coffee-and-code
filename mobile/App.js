import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { SymbolView } from 'expo-symbols';
import { createAccount, restoreSession, signIn, signOut } from './oauth';
import { C, styles, TAB_BAR_HEIGHT } from './src/theme';
import { formatDate, storyAuthor } from './src/utils';
import { ArticleBody, SectionBar, StoryRow, TabButton } from './src/components';
import { listRepoRecords, resolvePdsEndpoint, storiesFromRecords, storyRecordKey } from './src/recordStore';
import AccountSettings, { accountSettingsPages, SettingsRow } from './src/AccountSettings';
import {
  ActivityIndicator, Image, Linking, Pressable, SafeAreaView, ScrollView,
  StatusBar, Text, TextInput, View, RefreshControl,
} from 'react-native';

const API = 'https://coffeencode.cc/api';
const IS_EXPO_GO = Constants.appOwnership === 'expo';
const SAVED_KEY = 'coffee-and-code:saved';
const SAVED_OWNER_KEY = 'coffee-and-code:saved-owner';
const SAVE_COLLECTION = 'cc.coffeencode.save';
const VIEW_COLLECTION = 'cc.coffeencode.interact.view';
const BLOCK_COLLECTION = 'cc.coffeencode.user.block';
const LIKE_COLLECTION = 'cc.coffeencode.interact.like';
const DISLIKE_COLLECTION = 'cc.coffeencode.interact.dislike';
const NOTIFICATION_READ_COLLECTION = 'cc.coffeencode.notifications.read';

function profileBlobUrl(blob, did, pdsEndpoint) {
  const cid = blob?.ref?.$link;
  if (typeof cid !== 'string' || !pdsEndpoint) return undefined;
  return `${pdsEndpoint}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
}

async function readNotificationMarker(agent, did) {
  try {
    const { data } = await agent.com.atproto.repo.getRecord({
      repo: did,
      collection: NOTIFICATION_READ_COLLECTION,
      rkey: 'self',
    });
    const lastRead = data.value?.lastRead;
    return {
      exists: true,
      lastRead: typeof lastRead === 'string' && Number.isFinite(Date.parse(lastRead)) ? lastRead : undefined,
    };
  } catch (error) {
    const status = error.status || error.statusCode;
    if (status === 404 || (status === 400 && error.error === 'RecordNotFound')) {
      return { exists: false, lastRead: undefined };
    }
    if (status === 401 || status === 403) {
      throw new Error('Your account needs notification read access. Sign out and sign in again to approve the updated permissions.');
    }
    throw new Error(`Could not load your notification read status${status ? ` (${status})` : ''}.`);
  }
}

function relativeNotificationTime(value) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 60) return 'now';
  if (elapsedSeconds < 3600) return `${Math.floor(elapsedSeconds / 60)}m`;
  if (elapsedSeconds < 86400) return `${Math.floor(elapsedSeconds / 3600)}h`;
  if (elapsedSeconds < 604800) return `${Math.floor(elapsedSeconds / 86400)}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function App() {
  const [feed, setFeed] = useState(null);
  const [selected, setSelected] = useState(null);
  const [body, setBody] = useState('');
  const [tab, setTab] = useState('Latest');
  const [query, setQuery] = useState('');
  const [activeAuthor, setActiveAuthor] = useState(null);
  const [saved, setSaved] = useState([]);
  const [comments, setComments] = useState([]);
  const [commentLoading, setCommentLoading] = useState(false);
  const [commentCursor, setCommentCursor] = useState(null);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentError, setCommentError] = useState('');
  const [replyTarget, setReplyTarget] = useState(null);
  const [engagement, setEngagement] = useState(null);
  const [authorProfile, setAuthorProfile] = useState(null);
  const [activeTag, setActiveTag] = useState('');
  const [archiveStories, setArchiveStories] = useState([]);
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [savedRefreshing, setSavedRefreshing] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [notificationsUnreadCount, setNotificationsUnreadCount] = useState(0);
  const [notificationsReadAt, setNotificationsReadAt] = useState(undefined);
  const [notificationsLoadedAt, setNotificationsLoadedAt] = useState(null);
  const [notificationMarkerExists, setNotificationMarkerExists] = useState(false);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [notificationsRefreshing, setNotificationsRefreshing] = useState(false);
  const [notificationsMarkingRead, setNotificationsMarkingRead] = useState(false);
  const [notificationsError, setNotificationsError] = useState('');
  const [account, setAccount] = useState(null);
  const [accountProfile, setAccountProfile] = useState(null);
  const [accountPds, setAccountPds] = useState(null);
  const refreshSaved = useCallback(async () => {
    setSavedRefreshing(true);
    try {
      if (!account?.agent) {
        const stored = await AsyncStorage.getItem(SAVED_KEY);
        setSaved(stored ? JSON.parse(stored) : []);
        return;
      }
      const did = account.session.did;
      const [records, postsResponse] = await Promise.all([
        listRepoRecords(account.agent, did, SAVE_COLLECTION),
        fetch(`${API}/account/posts`, { cache: 'no-store' }).catch(() => null),
      ]);
      const publishedPosts = postsResponse?.ok ? await postsResponse.json().catch(() => []) : [];
      const postByUri = new Map((Array.isArray(publishedPosts) ? publishedPosts : []).map((post) => [post.uri, post]));
      const syncedSaved = storiesFromRecords(records, postByUri, saved);
      setSaved(syncedSaved);
      await Promise.all([
        AsyncStorage.setItem(SAVED_KEY, JSON.stringify(syncedSaved)),
        AsyncStorage.setItem(SAVED_OWNER_KEY, did),
      ]);
    } catch (e) {
      console.error('Error refreshing saved stories:', e);
    } finally {
      setSavedRefreshing(false);
    }
  }, [account, saved]);
  const [viewedStories, setViewedStories] = useState([]);
  const [showAllViewed, setShowAllViewed] = useState(false);
  const [blockedAccounts, setBlockedAccounts] = useState([]);
  const [coffeeProfile, setCoffeeProfile] = useState(null);
  const [accountDataLoading, setAccountDataLoading] = useState(false);
  const [accountDataError, setAccountDataError] = useState('');
  const [accountRefresh, setAccountRefresh] = useState(0);
  const [settingsPage, setSettingsPage] = useState(null);
  const [loginHandle, setLoginHandle] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [articleLoading, setArticleLoading] = useState(false);
  const navCompactProgress = useRef(new Animated.Value(0)).current;
  const navCollapsedRef = useRef(false);
  const lastArticleScrollY = useRef(0);
  const articleTouchStart = useRef(null);
  const commentsRequestId = useRef(0);
  const notificationsRequestId = useRef(0);
  const notificationInitialLoadDid = useRef(null);
  const notificationAutoMarkAttemptedAt = useRef(null);
  const [error, setError] = useState('');

  const loadFeed = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true); else setLoading(true);
    setError('');
    try {
      let payload;
      try {
        const response = await fetch(`${API}/home`);
        if (response.ok) payload = await response.json().catch(() => null);
      } catch { /* Try the archive endpoint below if the home feed is unavailable. */ }
      if (!Array.isArray(payload?.latest) || !Array.isArray(payload?.pinned)) {
        const response = await fetch(`${API}/documents?limit=100`);
        if (!response.ok) throw new Error('Coffee & Code is temporarily unavailable. Please try again.');
        const archive = await response.json();
        const documents = Array.isArray(archive.documents) ? archive.documents : [];
        payload = { hero: documents[0] || null, latest: documents.slice(1, 5), pinned: [], more: documents.slice(5), totalAvailable: archive.totalAvailable || documents.length, authors: [] };
      }
      setFeed(payload);
    } catch (e) {
      setError(e.message || 'Failed to load stories. Check your internet connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  const loadNotifications = useCallback(async (refresh = false) => {
    if (!account?.agent) return;
    const requestId = ++notificationsRequestId.current;
    const did = account.session.did;
    if (refresh) setNotificationsRefreshing(true);
    else setNotificationsLoading(true);
    setNotificationsLoadedAt(null);
    setNotificationsError('');
    try {
      const marker = await readNotificationMarker(account.agent, did);
      const params = new URLSearchParams({ did, limit: '100' });
      const countParams = new URLSearchParams({ did, count: '1' });
      if (marker.lastRead) countParams.set('lastRead', marker.lastRead);
      if (refresh) {
        params.set('refresh', '1');
        countParams.set('refresh', '1');
      }
      const response = await fetch(`${API}/notifications?${params}`, { cache: 'no-store' });
      if (!response.ok) throw new Error('Notifications are temporarily unavailable. Please try again.');
      const payload = await response.json();
      if (!Array.isArray(payload.notifications)) throw new Error('The notifications service returned an invalid response.');
      const countResponse = await fetch(`${API}/notifications?${countParams}`, { cache: 'no-store' });
      if (!countResponse.ok) throw new Error('Could not load the unread notification count.');
      const countPayload = await countResponse.json();
      if (!Number.isInteger(countPayload.unreadCount) || countPayload.unreadCount < 0) {
        throw new Error('The notifications service returned an invalid unread count.');
      }
      if (requestId !== notificationsRequestId.current) return;
      setNotifications(payload.notifications);
      setNotificationsUnreadCount(countPayload.unreadCount);
      setNotificationsReadAt(marker.lastRead);
      setNotificationMarkerExists(marker.exists);
      setNotificationsLoadedAt(Date.now());
    } catch (loadError) {
      if (requestId === notificationsRequestId.current) {
        setNotificationsError(loadError.message || 'Could not load notifications.');
      }
    } finally {
      if (requestId === notificationsRequestId.current) {
        setNotificationsLoading(false);
        setNotificationsRefreshing(false);
      }
    }
  }, [account]);

  useEffect(() => { loadFeed(); }, [loadFeed]);
  useEffect(() => {
    if (tab === 'Notifications' && account?.agent) void loadNotifications();
    else notificationsRequestId.current += 1;
  }, [tab, account, loadNotifications]);
  useEffect(() => {
    if (!account?.agent) {
      notificationInitialLoadDid.current = null;
      setNotifications([]);
      setNotificationsUnreadCount(0);
      setNotificationsReadAt(undefined);
      setNotificationMarkerExists(false);
      setNotificationsLoadedAt(null);
      return;
    }
    const did = account.session.did;
    if (tab === 'Notifications' || notificationInitialLoadDid.current === did) return;
    notificationInitialLoadDid.current = did;
    void loadNotifications();
  }, [tab, account, loadNotifications]);
  useEffect(() => {
    AsyncStorage.getItem(SAVED_KEY)
      .then((value) => setSaved(value ? JSON.parse(value) : []))
      .catch(() => {})
      .finally(() => setSavedLoaded(true));
  }, []);
  useEffect(() => { restoreSession().then(setAccount).catch(() => {}); }, []);

  const stories = useMemo(() => {
    if (!feed) return [];
    const unique = new Map();
    [feed.hero, ...(feed.latest || []), ...(feed.pinned || []), ...(feed.more || [])].filter(Boolean).forEach((story) => {
      if (!unique.has(story.uri || story.title)) unique.set(story.uri || story.title, story);
    });
    return [...unique.values()];
  }, [feed]);

  useEffect(() => {
    if (!account?.agent || !savedLoaded) {
      if (!account) {
        setAccountDataLoading(false);
        setAccountDataError('');
        setAccountProfile(null);
        setAccountPds(null);
        setViewedStories([]);
        setBlockedAccounts([]);
        setCoffeeProfile(null);
      }
      return;
    }
    let cancelled = false;
    const activeAccount = account;
    const did = account.session.did;
    const loadAccountData = async () => {
      setAccountProfile(null);
      setAccountPds(null);
      setViewedStories([]);
      setShowAllViewed(false);
      setBlockedAccounts([]);
      setCoffeeProfile(null);
      setAccountDataLoading(true);
      setAccountDataError('');
      try {
        const [profileResponse, postsResponse, viewRecords, blockRecords, ownerValue, pdsEndpoint] = await Promise.all([
          fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(did)}`).catch(() => null),
          fetch(`${API}/account/posts`, { cache: 'no-store' }).catch(() => null),
          listRepoRecords(activeAccount.agent, did, VIEW_COLLECTION),
          listRepoRecords(activeAccount.agent, did, BLOCK_COLLECTION),
          AsyncStorage.getItem(SAVED_OWNER_KEY),
          resolvePdsEndpoint(did),
        ]);
        if (cancelled) return;
        if (profileResponse?.ok) setAccountProfile(await profileResponse.json());
        setAccountPds(pdsEndpoint);
        const publishedPosts = postsResponse?.ok ? await postsResponse.json() : [];
        const postByUri = new Map((Array.isArray(publishedPosts) ? publishedPosts : []).map((post) => [post.uri, post]));
        const viewSeen = new Set();
        const viewed = [...viewRecords]
          .filter((record) => typeof record.value?.document === 'string' && record.value.document.startsWith('at://'))
          .sort((a, b) => (Date.parse(b.value?.createdAt || '') || 0) - (Date.parse(a.value?.createdAt || '') || 0))
          .filter((record) => {
            const uri = record.value.document;
            if (viewSeen.has(uri)) return false;
            viewSeen.add(uri);
            return true;
          })
          .slice(0, 50)
          .map((record) => {
            const uri = record.value.document;
            const post = postByUri.get(uri) || {};
            const key = storyRecordKey(uri);
            return { ...post, uri, title: post.title || 'Viewed story', publishedAt: post.publishedAt, viewedAt: record.value.createdAt, markdownUrl: `${API}/documents?uri=${encodeURIComponent(uri)}` };
          });
        setViewedStories(viewed);
        setBlockedAccounts(blockRecords
          .filter((record) => typeof record.uri === 'string' && typeof record.value?.subject === 'string')
          .map((record) => ({ rkey: record.uri.split('/').pop(), did: record.value.subject, createdAt: record.value.createdAt })));

        const storedSaved = await AsyncStorage.getItem(SAVED_KEY);
        const cachedSaved = storedSaved ? JSON.parse(storedSaved) : [];
        const existingSaveRecords = await listRepoRecords(activeAccount.agent, did, SAVE_COLLECTION);
        const canImportDeviceSaves = !ownerValue || ownerValue === did;
        const savedUris = new Set(existingSaveRecords.map((record) => record.value?.target?.document).filter(Boolean));
        if (canImportDeviceSaves) {
          for (const story of cachedSaved) {
            if (!story?.uri || savedUris.has(story.uri)) continue;
            const record = { $type: SAVE_COLLECTION, target: { document: story.uri }, createdAt: new Date().toISOString() };
            const result = await activeAccount.agent.com.atproto.repo.createRecord({ repo: did, collection: SAVE_COLLECTION, record });
            existingSaveRecords.push({ uri: result.data.uri, value: record });
            savedUris.add(story.uri);
          }
        }
        if (cancelled) return;
        const syncedSaved = storiesFromRecords(existingSaveRecords, postByUri, cachedSaved);
        setSaved(syncedSaved);
        await Promise.all([
          AsyncStorage.setItem(SAVED_KEY, JSON.stringify(syncedSaved)),
          AsyncStorage.setItem(SAVED_OWNER_KEY, did),
        ]);

        try {
          const { data } = await activeAccount.agent.com.atproto.repo.getRecord({ repo: did, collection: 'cc.coffeencode.profile', rkey: 'self' });
          if (!cancelled && data.value?.$type === 'cc.coffeencode.profile') {
            setCoffeeProfile({
              ...data.value,
              avatarUrl: profileBlobUrl(data.value.avatar, did, pdsEndpoint),
              bannerUrl: profileBlobUrl(data.value.banner, did, pdsEndpoint),
            });
          }
        } catch {
          if (!cancelled) setCoffeeProfile(null);
        }
      } catch (e) {
        if (!cancelled) setAccountDataError(e.message || 'Could not sync your account details.');
      } finally {
        if (!cancelled) setAccountDataLoading(false);
      }
    };
    loadAccountData();
    return () => { cancelled = true; };
  }, [account?.session?.did, savedLoaded, accountRefresh]);

  const loadComments = useCallback(async (storyUri, cursor = null, append = false) => {
    const requestId = append ? commentsRequestId.current : ++commentsRequestId.current;
    setCommentLoading(true);
    setCommentError('');
    try {
      const params = new URLSearchParams({ subject: storyUri, limit: '40' });
      if (account?.session?.did) params.set('did', account.session.did);
      if (cursor) params.set('cursor', cursor);
      const response = await fetch(`${API}/comments?${params.toString()}`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Comments are temporarily unavailable.');
      if (!Array.isArray(payload.records)) throw new Error('The comments response was incomplete.');
      if (requestId !== commentsRequestId.current) return;
      const records = payload.records;
      setComments((current) => {
        if (!append) return records;
        const byUri = new Map(current.map((comment) => [comment.uri, comment]));
        records.forEach((comment) => byUri.set(comment.uri, comment));
        return [...byUri.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      });
      setCommentCursor(typeof payload.cursor === 'string' && payload.cursor ? payload.cursor : null);
      setCommentTotal(Number.isFinite(Number(payload.total)) ? Number(payload.total) : records.length);
      return records;
    } catch (e) {
      if (requestId === commentsRequestId.current) setCommentError(e.message || 'Could not load comments.');
      return null;
    } finally {
      if (requestId === commentsRequestId.current) setCommentLoading(false);
    }
  }, [account?.session?.did]);

  const animateArticleNav = useCallback((collapsed) => {
    if (navCollapsedRef.current === collapsed) return;
    navCollapsedRef.current = collapsed;
    Animated.timing(navCompactProgress, {
      toValue: collapsed ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [navCompactProgress]);

  const onArticleScroll = useCallback((event) => {
    const offset = event.nativeEvent.contentOffset.y;
    const delta = offset - lastArticleScrollY.current;
    if (offset <= 8) {
      animateArticleNav(false);
      lastArticleScrollY.current = offset;
      return;
    }
    if (Math.abs(delta) < 8) return;
    animateArticleNav(delta > 0);
    lastArticleScrollY.current = offset;
  }, [animateArticleNav]);

  const openStory = useCallback(async (story) => {
    setSelected(story);
    setBody('');
    setError('');
    setArticleLoading(true);
    setComments([]);
    setCommentTotal(0);
    setCommentCursor(null);
    setCommentError('');
    setReplyTarget(null);
    navCollapsedRef.current = false;
    navCompactProgress.setValue(0);
    lastArticleScrollY.current = 0;
    void loadComments(story.uri);
    setEngagement(null);
        setAuthorProfile(null);
    const authorDid = story.author?.did;
    if (authorDid) {
      (async () => {
        let bsky = null;
        let coffee = null;
        try {
          const r = await fetch(`https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(authorDid)}`);
          if (r.ok) bsky = await r.json();
        } catch {}
        try {
          const pds = await resolvePdsEndpoint(authorDid);
          if (pds) {
            const r = await fetch(`${pds}/xrpc/com.atproto.repo.getRecord?repo=${encodeURIComponent(authorDid)}&collection=cc.coffeencode.profile&rkey=self`);
            if (r.ok) {
              const { value } = await r.json();
              coffee = { ...value, avatarUrl: profileBlobUrl(value?.avatar, authorDid, pds) };
            }
          }
        } catch {}
        setAuthorProfile((current) => current === null ? { did: authorDid, bsky, coffee, uri: story.uri } : current);
      })();
    }
    try {
      const storyResponse = await fetch(`${API}/documents?uri=${encodeURIComponent(story.uri)}`, { cache: 'no-store' });
      if (!storyResponse.ok) throw new Error(`Story request failed (${storyResponse.status}). Please try again.`);
      const responseText = await storyResponse.text();
      if (!responseText.trim()) throw new Error('This story has no readable content.');
      try {
        const json = JSON.parse(responseText);
        if (json.error) throw new Error(json.error);
        if (Array.isArray(json.documents) && typeof json.content !== 'string') {
          throw new Error('The article API returned the story list without its content. Deploy the latest Coffee & Code API Worker, then reopen this post.');
        }
        if (typeof json.content !== 'string' || !json.content.trim()) {
          throw new Error('The post metadata loaded, but the API returned no article text. Please try again after the API is updated.');
        }
        setBody(json.content);
      } catch (parseError) {
        if (parseError instanceof SyntaxError) setBody(responseText);
        else throw parseError;
      }
      const [engagementResponse] = await Promise.all([
        fetch(`${API}/reactions?subject=${encodeURIComponent(story.uri)}${account?.session?.did ? `&did=${encodeURIComponent(account.session.did)}` : ''}`).catch(() => null),
      ]);
      if (engagementResponse?.ok) setEngagement(await engagementResponse.json());
      if (account?.agent) {
        account.agent.com.atproto.repo.createRecord({ repo: account.session.did, collection: VIEW_COLLECTION, record: { $type: VIEW_COLLECTION, document: story.uri, createdAt: new Date().toISOString() } })
          .then(() => setViewedStories((current) => [story, ...current.filter((item) => item.uri !== story.uri)].slice(0, 50)))
          .catch(() => {});
      }
    } catch (e) {
      setError(e.message || 'This story could not be opened.');
    } finally {
      setArticleLoading(false);
    }
  }, [account, loadComments]);

  const loadArchive = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API}/documents?limit=100`);
      if (!response.ok) throw new Error('The archive is temporarily unavailable.');
      const data = await response.json();
      setArchiveStories(data.documents || []);
      setArchiveLoaded(true);
    } catch (e) { setError(e.message || 'Could not load the archive.'); }
    finally { setLoading(false); }
  }, []);

  const toggleSaved = async (story) => {
    if (!story?.uri || accountBusy) return;
    setAccountBusy(true);
    setError('');
    try {
      let currentlySaved = saved.some((item) => item.uri === story.uri);
      if (account?.agent) {
        const records = await listRepoRecords(account.agent, account.session.did, SAVE_COLLECTION);
        const matching = records.filter((item) => item.value?.target?.document === story.uri);
        currentlySaved = matching.length > 0;
        if (matching.length) {
          for (const item of matching) {
            await account.agent.com.atproto.repo.deleteRecord({ repo: account.session.did, collection: SAVE_COLLECTION, rkey: item.uri.split('/').pop() });
          }
        } else {
          await account.agent.com.atproto.repo.createRecord({ repo: account.session.did, collection: SAVE_COLLECTION, record: { $type: SAVE_COLLECTION, target: { document: story.uri }, createdAt: new Date().toISOString() } });
        }
      }
      const next = currentlySaved ? saved.filter((item) => item.uri !== story.uri) : [story, ...saved];
      setSaved(next);
      await AsyncStorage.setItem(SAVED_KEY, JSON.stringify(next));
      if (account?.session?.did) await AsyncStorage.setItem(SAVED_OWNER_KEY, account.session.did);
      if (account?.agent && selected?.uri === story.uri) {
        const response = await fetch(`${API}/reactions?subject=${encodeURIComponent(story.uri)}&did=${encodeURIComponent(account.session.did)}`).catch(() => null);
        if (response?.ok) setEngagement(await response.json());
      }
    } catch (e) {
      setError(e.message || 'Could not sync this story to your account.');
    } finally {
      setAccountBusy(false);
    }
  };

  const unblockAccount = async (blockedDid) => {
    if (!account?.agent || !blockedDid || accountBusy) return;
    const blocked = blockedAccounts.find((item) => item.did === blockedDid);
    if (!blocked?.rkey) return;
    setAccountBusy(true);
    setAccountDataError('');
    try {
      await account.agent.com.atproto.repo.deleteRecord({ repo: account.session.did, collection: BLOCK_COLLECTION, rkey: blocked.rkey });
      setBlockedAccounts((current) => current.filter((item) => item.did !== blockedDid));
    } catch (e) {
      setAccountDataError(e.message || 'Could not unblock this account.');
    } finally {
      setAccountBusy(false);
    }
  };

  const handleLogin = async () => {
    if (!loginHandle.trim()) { setError('Enter your AT Protocol handle to continue.'); return; }
    setAccountBusy(true); setError('');
    try {
      const response = await fetch(`${API}/authors/check?handle=${encodeURIComponent(loginHandle.trim())}`);
      const data = response.ok ? await response.json() : {};
      setAccount(await signIn(loginHandle.trim(), Boolean(data.isAuthor)));
      setLoginHandle('');
    } catch (e) { setError(e.message || 'Sign-in could not be completed.'); }
    finally { setAccountBusy(false); }
  };

  const getInviteCode = async () => {
    if (inviteLoading) return;
    setInviteLoading(true);
    setInviteError('');
    try {
      const response = await fetch(`${API}/invite-code`, { cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'An invite code is temporarily unavailable. Please try again.');
      if (typeof payload.code !== 'string' || !payload.code.trim()) throw new Error('The invite service returned an invalid code.');
      setInviteCode(payload.code.trim());
    } catch (e) {
      setInviteError(e.message || 'Could not get an invite code.');
    } finally {
      setInviteLoading(false);
    }
  };

  const continueAccountCreation = async () => {
    if (!inviteCode || accountBusy) return;
    setAccountBusy(true);
    setError('');
    try {
      setAccount(await createAccount());
    } catch (e) {
      setError(e.message || 'Account creation could not be started.');
    } finally {
      setAccountBusy(false);
    }
  };

  const sendComment = async () => {
    const text = commentDraft.trim();
    if (!account?.agent) { setSelected(null); setTab('Account'); setError('Sign in to post a comment.'); return; }
    if (!text || accountBusy) return;
    setAccountBusy(true); setError(''); setCommentError('');
    try {
      const createdAt = new Date().toISOString();
      const record = {
        $type: 'cc.coffeencode.comment',
        subject: { uri: selected.uri },
        ...(replyTarget ? { reply: { parent: { uri: replyTarget.uri } } } : {}),
        text,
        createdAt,
      };
      const result = await account.agent.com.atproto.repo.createRecord({ repo: account.session.did, collection: 'cc.coffeencode.comment', record });
      const optimisticComment = {
        uri: result.data.uri,
        did: account.session.did,
        handle: accountProfile?.handle || account.session.did,
        displayName: accountProfile?.displayName,
        avatar: accountProfile?.avatar,
        text,
        createdAt,
        parentUri: replyTarget?.uri,
        likeCount: 0,
        liked: false,
      };
      setComments((current) => [...current, optimisticComment].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
      setCommentTotal((current) => current + 1);
      setCommentDraft('');
      setReplyTarget(null);
    } catch (e) { setCommentError(e.message || 'Could not publish your comment.'); }
    finally { setAccountBusy(false); }
  };

  const markNotificationsRead = async () => {
    if (!account?.agent || notificationsMarkingRead) return;
    setNotificationsMarkingRead(true);
    setNotificationsError('');
    const lastRead = new Date().toISOString();
    const record = { $type: NOTIFICATION_READ_COLLECTION, lastRead };
    try {
      const request = {
        repo: account.session.did,
        collection: NOTIFICATION_READ_COLLECTION,
        rkey: 'self',
        record,
      };
      if (notificationMarkerExists) {
        await account.agent.com.atproto.repo.putRecord(request);
      } else {
        await account.agent.com.atproto.repo.createRecord(request);
      }
      setNotificationMarkerExists(true);
      setNotificationsReadAt(lastRead);
      setNotificationsUnreadCount(0);
    } catch (markError) {
      setNotificationsError(markError.message || 'Could not save your notification read status.');
    } finally {
      setNotificationsMarkingRead(false);
    }
  };

  useEffect(() => {
    if (tab !== 'Notifications' || !account?.agent || !notificationsLoadedAt || notificationsLoading) return undefined;
    const cutoff = notificationsReadAt ? Date.parse(notificationsReadAt) : Number.NEGATIVE_INFINITY;
    const hasUnread = notifications.some((item) => {
      const timestamp = Date.parse(item.createdAt || '');
      return !Number.isFinite(timestamp) || timestamp > cutoff;
    });
    if (!hasUnread || notificationsMarkingRead || notificationAutoMarkAttemptedAt.current === notificationsLoadedAt) return undefined;
    const timeout = setTimeout(() => {
      notificationAutoMarkAttemptedAt.current = notificationsLoadedAt;
      void markNotificationsRead();
    }, 5000);
    return () => clearTimeout(timeout);
  }, [tab, account, notificationsLoadedAt, notificationsLoading, notificationsMarkingRead, notifications, notificationsReadAt]);

  const toggleCommentLike = async (comment) => {
    if (!account?.agent) { setSelected(null); setTab('Account'); setError('Sign in to like a comment.'); return; }
    if (accountBusy) return;
    setAccountBusy(true);
    setCommentError('');
    try {
      const collection = 'cc.coffeencode.comment.like';
      if (comment.liked) {
        let rkey = comment.likeRkey;
        if (!rkey) {
          const records = await listRepoRecords(account.agent, account.session.did, collection);
          rkey = records.find((record) => record.value?.subject?.uri === comment.uri)?.uri.split('/').pop();
        }
        if (!rkey) throw new Error('Could not find your comment like. Refresh comments and try again.');
        await account.agent.com.atproto.repo.deleteRecord({ repo: account.session.did, collection, rkey });
        setComments((current) => current.map((item) => item.uri === comment.uri ? { ...item, liked: false, likeCount: Math.max(0, (item.likeCount || 0) - 1), likeRkey: undefined } : item));
      } else {
        const result = await account.agent.com.atproto.repo.createRecord({ repo: account.session.did, collection, record: { $type: collection, subject: { uri: comment.uri }, createdAt: new Date().toISOString() } });
        const rkey = result.data.uri.split('/').pop();
        setComments((current) => current.map((item) => item.uri === comment.uri ? { ...item, liked: true, likeCount: (item.likeCount || 0) + 1, likeRkey: rkey } : item));
      }
    } catch (e) { setCommentError(e.message || 'Could not update your comment like.'); }
    finally { setAccountBusy(false); }
  };

  const toggleReaction = async (kind) => {
    if (!account?.agent) { setSelected(null); setTab('Account'); setError('Sign in to react to this story.'); return; }
    const collection = `cc.coffeencode.interact.${kind}`;
    setAccountBusy(true); setError('');
    try {
      const oppositeKind = kind === 'like' ? 'dislike' : 'like';
      let oppositeWasActive = false;
      const records = await listRepoRecords(account.agent, account.session.did, collection);
      const existing = records.find((item) => item.value?.document === selected.uri);
      if (existing) await account.agent.com.atproto.repo.deleteRecord({ repo: account.session.did, collection, rkey: existing.uri.split('/').pop() });
      else {
        const other = `cc.coffeencode.interact.${kind === 'like' ? 'dislike' : 'like'}`;
        const oppositeRecords = await listRepoRecords(account.agent, account.session.did, other);
        const previous = oppositeRecords.find((item) => item.value?.document === selected.uri);
        oppositeWasActive = Boolean(previous);
        await account.agent.com.atproto.repo.createRecord({ repo: account.session.did, collection, record: { $type: collection, document: selected.uri, createdAt: new Date().toISOString() } });
        if (previous) await account.agent.com.atproto.repo.deleteRecord({ repo: account.session.did, collection: other, rkey: previous.uri.split('/').pop() });
      }
      const wasActive = Boolean(existing);
      const localState = (current) => current && ({
        ...current,
        [`${kind}d`]: !wasActive,
        [`${kind}s`]: Math.max(0, (current[`${kind}s`] || 0) + (wasActive ? -1 : 1)),
        ...(oppositeWasActive ? {
          [`${oppositeKind}d`]: false,
          [`${oppositeKind}s`]: Math.max(0, (current[`${oppositeKind}s`] || 0) - 1),
        } : {}),
      });
      setEngagement(localState);
      const response = await fetch(`${API}/reactions?subject=${encodeURIComponent(selected.uri)}&did=${encodeURIComponent(account.session.did)}`, { cache: 'no-store' }).catch(() => null);
      if (response?.ok) {
        const indexed = await response.json();
        setEngagement((current) => current && ({
          ...indexed,
          // The backlink index can lag behind a successful repo write. Keep
          // this account's just-written state and optimistic count until it catches up.
          [`${kind}d`]: !wasActive,
          [`${kind}s`]: indexed[`${kind}d`] === !wasActive ? indexed[`${kind}s`] : current[`${kind}s`],
          ...(oppositeWasActive ? {
            [`${oppositeKind}d`]: false,
            [`${oppositeKind}s`]: indexed[`${oppositeKind}d`] === false ? indexed[`${oppositeKind}s`] : current[`${oppositeKind}s`],
          } : {}),
        }));
      }
    } catch (e) { setError(e.message || 'Could not update your reaction.'); }
    finally { setAccountBusy(false); }
  };

    const articleAuthor = selected?.author?.did ? {
    did: selected.author.did,
    handle: authorProfile?.bsky?.handle || selected.author.handle,
    name: authorProfile?.coffee?.displayName || authorProfile?.bsky?.displayName || selected.author.displayName || selected.author.handle || storyAuthor(selected),
    avatar: authorProfile?.coffee?.avatarUrl || authorProfile?.bsky?.avatar || selected.author.avatar,
    bio: authorProfile?.coffee?.description || authorProfile?.bsky?.description || selected.author.description || '',
  } : null;
  const openAuthorProfile = () => Linking.openURL(`https://bsky.app/profile/${encodeURIComponent(articleAuthor.handle || articleAuthor.did)}`);
  const closeStory = () => { commentsRequestId.current += 1; setCommentLoading(false); setSelected(null); setBody(''); setError(''); setReplyTarget(null); animateArticleNav(false); lastArticleScrollY.current = 0; };
  const allArchiveStories = archiveLoaded ? archiveStories : stories;
  const tags = [...new Set(allArchiveStories.flatMap((story) => story.tags || []))].sort((a, b) => a.localeCompare(b));
  const visibleStories = allArchiveStories.filter((story) => {
    const matchesAuthor = !activeAuthor || story.author?.did === activeAuthor.did;
    const haystack = `${story.title} ${story.description || ''} ${storyAuthor(story)}`.toLocaleLowerCase();
    const matchesTag = !activeTag || story.tags?.some((tag) => tag.toLocaleLowerCase() === activeTag.toLocaleLowerCase());
    return matchesAuthor && matchesTag && haystack.includes(query.trim().toLocaleLowerCase());
  });
  const authors = feed?.authors || [];
  const promotion = feed?.promotion;
  const recentStories = [feed?.hero, ...(feed?.latest || [])].filter(Boolean);
  const topStories = recentStories.slice(0, 3);
  const remainingLatest = [...recentStories.slice(3), ...(feed?.more || [])];
  const pinnedStories = feed?.pinned || [];
  const notificationBadgeCount = account?.agent ? notificationsUnreadCount : 0;
  const openContributor = (author) => { setActiveAuthor(author); setTab('Authors'); };
  const selectMainTab = (destination) => { commentsRequestId.current += 1; setCommentLoading(false); setSelected(null); setReplyTarget(null); setTab(destination); setActiveAuthor(null); if (destination === 'Account') setSettingsPage(null); animateArticleNav(false); };

  const onArticleTouchStart = (event) => {
    const touch = event.nativeEvent.touches?.[0] || event.nativeEvent;
    articleTouchStart.current = { x: touch.pageX, y: touch.pageY };
  };
  const onArticleTouchEnd = (event) => {
    const start = articleTouchStart.current;
    articleTouchStart.current = null;
    if (!start) return;
    const touch = event.nativeEvent.changedTouches?.[0] || event.nativeEvent;
    const dx = touch.pageX - start.x;
    const dy = touch.pageY - start.y;
    if (Math.abs(dy) > 110 && Math.abs(dx) < 70 && dy > 0 && lastArticleScrollY.current <= 8) {
      closeStory();
      return;
    }
    if (Math.abs(dx) < 88 || Math.abs(dx) < Math.abs(dy) * 1.35) return;
    const collection = [...topStories, ...pinnedStories, ...remainingLatest];
    const index = collection.findIndex((story) => story.uri === selected?.uri);
    if (dx > 0) {
      if (index > 0) openStory(collection[index - 1]);
      else closeStory();
    } else if (index >= 0 && index < collection.length - 1) {
      openStory(collection[index + 1]);
    }
  };

  const renderLatest = () => <ScrollView contentContainerStyle={styles.homeContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFeed(true)} tintColor={C.muted} /> }>
    <SectionBar title="Latest" detail={`${feed?.totalAvailable ?? stories.length} STORIES`} />
    {error ? <View style={styles.empty}><Text style={styles.error}>{error}</Text><Pressable onPress={() => loadFeed()}><Text style={styles.action}>TRY AGAIN</Text></Pressable></View>
      : !stories.length ? <Text style={styles.emptyText}>No stories have been published yet. Please check back soon.</Text>
        : topStories.map((story, index) => <StoryRow key={story.uri || `${story.title}-${index}`} story={story} featured={index === 0} compact={index > 0} onPress={() => openStory(story)} />)}
    {!!pinnedStories.length && <><SectionBar title="Pinned" detail={`${pinnedStories.length} PICKS`} />{pinnedStories.map((story) => <StoryRow key={`pinned-${story.uri}`} story={story} compact onPress={() => openStory(story)} />)}</>}
    {!!promotion && <Pressable style={styles.promotion} onPress={() => Linking.openURL(promotion.url)}><Text style={styles.promoTitle}>We're looking for writers</Text><Text style={styles.promoDescription}>Coffee &amp; Code is made possible thanks to you! One way you can contribute is to write for us!</Text><Text style={styles.action}>WRITE FOR US  ›</Text></Pressable>}
    {!!remainingLatest.length && <><SectionBar title="More stories" detail={`${remainingLatest.length} STORIES`} />{remainingLatest.map((story) => <StoryRow key={`more-${story.uri}`} story={story} compact onPress={() => openStory(story)} />)}</>}
    {!!authors.length && <><SectionBar title="Authors" />{authors.map((author) => <Pressable key={author.did} style={styles.authorRow} onPress={() => openContributor(author)}>
      {author.avatar ? <Image source={{ uri: author.avatar }} accessibilityLabel={`${author.displayName || author.handle} profile photo`} style={styles.avatar} /> : <View style={styles.avatarPlaceholder}><Text style={styles.avatarInitial}>{(author.displayName || author.handle || 'C')[0].toUpperCase()}</Text></View>}
      <View style={styles.authorCopy}><Text style={styles.authorName}>{author.displayName || author.handle}</Text><Text style={styles.meta}>@{author.handle}  ·  {author.storyCount} {author.storyCount === 1 ? 'STORY' : 'STORIES'}</Text></View><Text style={styles.chevron}>›</Text>
    </Pressable>)}</>}
  </ScrollView>;

  const renderSearch = () => <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFeed(true)} tintColor={C.muted} />}>
    <Text style={styles.pageTitle}>Find a story</Text>
    <TextInput value={query} onChangeText={setQuery} placeholder="Search headlines, authors, topics" placeholderTextColor={C.muted} autoCapitalize="none" returnKeyType="search" style={styles.searchInput} accessibilityLabel="Search stories" />
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tagStrip} contentContainerStyle={styles.tagContent}>
      {['', ...tags].map((tag) => <Pressable key={tag || 'all'} onPress={() => setActiveTag(tag)} style={[styles.tagChip, activeTag === tag && styles.tagChipActive]}><Text style={[styles.tagText, activeTag === tag && styles.tagTextActive]}>{tag || 'All topics'}</Text></Pressable>)}
    </ScrollView>
    <SectionBar title={query ? 'Search results' : 'All stories'} detail={`${visibleStories.length} SHOWN`} />
    {visibleStories.length ? visibleStories.map((story, index) => <StoryRow key={story.uri || `${story.title}-${index}`} story={story} compact onPress={() => openStory(story)} />)
      : <Text style={styles.emptyText}>{query ? 'No stories match that search. Try another title, topic, or author.' : 'Stories will appear here as they are published.'}</Text>}
  </ScrollView>;

  const renderSaved = () => <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={savedRefreshing} onRefresh={refreshSaved} tintColor={C.muted} />}>
    <Text style={styles.pageTitle}>Saved stories</Text>
    {saved.length ? saved.map((story, index) => <StoryRow key={story.uri || index} compact story={story} onPress={() => openStory(story)} />) : <View style={styles.empty}><Text style={styles.emptyTitle}>Save a story for later</Text><Text style={styles.emptyText}>Tap the bookmark on any story to add it to your saved list. {account ? 'Your saved list syncs with your Coffee & Code account.' : 'Saved stories stay on this device until you sign in.'}</Text></View>}
  </ScrollView>;

  const renderNotificationItem = (item) => {
    const message = item.type === 'comment.like' ? 'liked your reply'
      : item.type === 'post.like' ? 'liked your story'
        : item.type === 'post.view' ? 'viewed your story'
        : item.type === 'comment.reply' ? 'replied to your comment on'
          : 'commented on';
    const story = stories.find((candidate) => candidate.uri === item.documentUri)
      || { uri: item.documentUri, title: item.documentTitle || 'Story' };
    const time = item.createdAt ? relativeNotificationTime(item.createdAt) : '';
    return <Pressable key={item.uri} accessibilityRole="button" accessibilityLabel={`${item.actorName || item.actorHandle || 'Someone'} ${message} ${item.documentTitle || 'a story'}`} onPress={() => openStory(story)} style={styles.notificationRow}>
      {item.actorAvatar
        ? <Image source={{ uri: item.actorAvatar }} accessibilityLabel={`${item.actorName || 'User'} profile photo`} style={styles.notificationAvatar} />
        : <View style={styles.notificationAvatarPlaceholder}><Text style={styles.notificationAvatarInitial}>{(item.actorName || item.actorHandle || '?')[0].toUpperCase()}</Text></View>}
      <View style={styles.notificationCopy}>
        <Text style={styles.notificationSummary}><Text style={styles.notificationActor}>{item.actorName || item.actorHandle || item.actorDid}</Text>{` ${message} `}<Text style={styles.notificationStory}>{item.documentTitle || 'a story'}</Text></Text>
        {!!(item.text || item.targetText) && <Text numberOfLines={3} style={styles.notificationQuote}>“{item.type === 'comment.like' ? item.targetText : item.text}”</Text>}
        {!!time && <Text style={styles.notificationTime}>{time}</Text>}
      </View>
      <SymbolView name={item.type.includes('like') ? 'heart.fill' : item.type === 'post.view' ? 'eye' : 'bubble.left'} size={15} tintColor={item.type.includes('like') ? C.error : C.muted} />
    </Pressable>;
  };

  const renderNotifications = () => {
    if (!account?.agent) return <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.pageTitle}>Notifications</Text>
      <View style={styles.empty}>
        <Text style={styles.emptyTitle}>Your inbox is waiting</Text>
        <Text style={styles.emptyText}>Sign in to see comments on your stories and likes on those comments.</Text>
        <Pressable accessibilityRole="button" onPress={() => selectMainTab('Account')} style={styles.notificationSignIn}><Text style={styles.primaryButtonText}>GO TO SIGN IN</Text></Pressable>
      </View>
    </ScrollView>;

    const cutoff = notificationsReadAt ? Date.parse(notificationsReadAt) : Number.NEGATIVE_INFINITY;
    const unread = notifications.filter((item) => {
      const timestamp = Date.parse(item.createdAt || '');
      return !Number.isFinite(timestamp) || timestamp > cutoff;
    });
    const read = notifications.filter((item) => {
      const timestamp = Date.parse(item.createdAt || '');
      return Number.isFinite(timestamp) && timestamp <= cutoff;
    });
    const renderSection = (title, items, emptyText) => <View>
      <SectionBar title={title} detail={String(items.length)} />
      {items.length ? items.map(renderNotificationItem) : <Text style={styles.notificationEmpty}>{emptyText}</Text>}
    </View>;

    return <ScrollView contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={notificationsRefreshing} onRefresh={() => loadNotifications(true)} tintColor={C.muted} />}>
      <Text style={styles.pageTitle}>Notifications</Text>
      <Text style={styles.pageSubtitle}>Comments on your stories and likes on those comments.</Text>
      {!!notificationsError && <View><Text accessibilityRole="alert" style={styles.error}>{notificationsError}</Text><Pressable accessibilityRole="button" onPress={() => loadNotifications()}><Text style={styles.action}>TRY AGAIN</Text></Pressable></View>}
      {notificationsLoading
        ? <ActivityIndicator color={C.muted} style={{ marginVertical: 28 }} />
        : <>
          {renderSection('Unread', unread, 'No unread notifications.')}
          {renderSection('Read', read, 'No read notifications yet.')}
        </>}
    </ScrollView>;
  };

  const renderAuthors = () => <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFeed(true)} tintColor={C.muted} />}>
    {activeAuthor ? <Pressable onPress={() => setActiveAuthor(null)} style={styles.backLink}><Text style={styles.action}>‹  ALL CONTRIBUTORS</Text></Pressable> : <Pressable onPress={() => { setTab('Latest'); setActiveAuthor(null); }} style={styles.backLink}><Text style={styles.action}>‹  BACK TO HOME</Text></Pressable>}
    <Text style={[styles.pageTitle, { marginTop: 0 }]}>{activeAuthor?.displayName || 'Authors'}</Text>
    {activeAuthor && <Text style={styles.handle}>@{activeAuthor.handle}</Text>}
    {!activeAuthor ? authors.length ? authors.map((author) => <Pressable key={author.did} style={styles.authorRow} onPress={() => setActiveAuthor(author)}>
      {author.avatar ? <Image source={{ uri: author.avatar }} style={styles.avatar} /> : <View style={styles.avatarPlaceholder}><Text style={styles.avatarInitial}>{(author.displayName || author.handle || 'C')[0].toUpperCase()}</Text></View>}
      <View style={styles.authorCopy}><Text style={styles.authorName}>{author.displayName || author.handle}</Text><Text style={styles.meta}>@{author.handle}  ·  {author.storyCount} {author.storyCount === 1 ? 'STORY' : 'STORIES'}</Text></View><Text style={styles.chevron}>›</Text>
    </Pressable>) : <Text style={styles.emptyText}>Contributor profiles will appear here.</Text>
      : <><SectionBar title="Stories" detail={`${visibleStories.length} STORIES`} />{visibleStories.length ? visibleStories.map((story, index) => <StoryRow key={story.uri || `${story.title}-${index}`} story={story} onPress={() => openStory(story)} />) : <Text style={styles.emptyText}>No stories from this contributor are in the current edition.</Text>}</>}
  </ScrollView>;

  const renderAccountStoryList = (items, emptyText, allowRemove = false) => items.length
    ? items.map((story, index) => <View key={`${story.uri}-${index}`} style={allowRemove ? styles.accountSavedRow : undefined}>
      <View style={allowRemove ? styles.accountSavedCopy : undefined}><StoryRow story={story} compact onPress={() => openStory(story)} /><Text style={styles.accountRecordDate}>{allowRemove ? 'Saved' : 'Viewed'} {formatDate(allowRemove ? story.savedAt : story.viewedAt) || 'recently'}</Text></View>
      {allowRemove && <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${story.title} from your reading list`} disabled={accountBusy} onPress={() => toggleSaved(story)} style={styles.accountRemoveButton}><Text style={styles.action}>REMOVE</Text></Pressable>}
    </View>)
    : <Text style={styles.emptyText}>{emptyText}</Text>;

  const renderCommentThread = (comment, depth = 0, ancestors = new Set()) => {
    if (ancestors.has(comment.uri)) return null;
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(comment.uri);
    const replies = comments.filter((item) => item.parentUri === comment.uri);
    return <React.Fragment key={comment.uri}>
      <View style={[styles.comment, depth > 0 && styles.commentReply]}>
        <View style={styles.commentHeader}>
          {comment.avatar ? <Image source={{ uri: comment.avatar }} accessibilityLabel={`${comment.displayName || comment.handle} profile photo`} style={styles.commentAvatar} /> : <View style={styles.commentAvatarPlaceholder}><SymbolView name="person.fill" size={14} tintColor={C.muted} /></View>}
          <View style={{ flex: 1 }}><Text style={styles.commentAuthor}>{comment.displayName || comment.handle}</Text><Text style={styles.meta}>{formatDate(comment.createdAt)}</Text></View>
        </View>
        {!!comment.parentUri && <Text style={styles.commentReplyLabel}>REPLY</Text>}
        <Text style={styles.commentText}>{comment.text}</Text>
        <View style={styles.commentActions}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(comment.liked) }} disabled={accountBusy} onPress={() => toggleCommentLike(comment)}><Text style={[styles.commentAction, comment.liked && styles.commentActionActive]}>{comment.liked ? 'LIKED' : 'LIKE'}  ·  {comment.likeCount || 0}</Text></Pressable>
          <Pressable accessibilityRole="button" disabled={accountBusy} onPress={() => { setReplyTarget(comment); setCommentDraft(''); }}><Text style={styles.commentAction}>REPLY</Text></Pressable>
        </View>
      </View>
      {replies.map((reply) => renderCommentThread(reply, depth + 1, nextAncestors))}
    </React.Fragment>;
  };

  const renderAccount = () => settingsPage && account ? <AccountSettings
    key={settingsPage}
    account={account}
    accountProfile={accountProfile}
    coffeeProfile={coffeeProfile}
    accountPds={accountPds}
    blockedAccounts={blockedAccounts}
    savedCount={saved.length}
    viewedCount={viewedStories.length}
    accountBusy={accountBusy}
    initialPage={settingsPage}
    onBack={() => setSettingsPage(null)}
    onUnblock={unblockAccount}
    onSignOut={async () => { await signOut(account); setAccount(null); setSettingsPage(null); }}
  /> : <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={accountDataLoading} onRefresh={() => setAccountRefresh((value) => value + 1)} tintColor={C.muted} />}>
    <Text style={styles.pageTitle}>{account ? 'Your account' : 'Sign in'}</Text>
    {account ? <>
      <View style={styles.accountCard}>
        {!!coffeeProfile?.bannerUrl && <Image source={{ uri: coffeeProfile.bannerUrl }} accessibilityLabel="Coffee & Code profile banner" resizeMode="cover" style={{ width: '100%', height: 120, borderRadius: 10, marginBottom: 14, backgroundColor: C.panelLight }} />}
        {!!coffeeProfile?.avatarUrl || !!accountProfile?.avatar ? <Image source={{ uri: coffeeProfile?.avatarUrl || accountProfile.avatar }} accessibilityLabel="Profile photo" style={styles.accountProfileAvatar} /> : <View style={styles.accountAvatar}><SymbolView name="person.fill" size={25} tintColor={C.ink} /></View>}
        <Text style={styles.accountProfileName}>{coffeeProfile?.displayName || accountProfile?.displayName || accountProfile?.handle || 'Your account'}</Text>
        {!!coffeeProfile?.pronouns && <Text style={styles.meta}>{coffeeProfile.pronouns}</Text>}
        <View style={styles.accountIdentityDetails}>
          <Text style={styles.accountIdentityLabel}>HANDLE</Text><Text selectable style={styles.accountIdentityValue}>{accountProfile?.handle ? `@${accountProfile.handle}` : 'Unavailable'}</Text>
          <Text style={styles.accountIdentityLabel}>DID</Text><Text selectable style={styles.accountIdentityValue}>{account.session.did}</Text>
          <Text style={styles.accountIdentityLabel}>PDS</Text><Text selectable style={styles.accountIdentityValue}>{accountPds === null ? 'Resolving…' : accountPds || 'Unavailable'}</Text>
        </View>
        {!!coffeeProfile?.description && <Text style={styles.accountDescription}>{coffeeProfile.description}</Text>}
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`https://bsky.app/profile/${encodeURIComponent(accountProfile?.handle || account.session.did)}`)} style={styles.profileLink}><Text style={styles.action}>VIEW PROFILE  ↗</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={accountBusy} onPress={async () => { await signOut(account); setAccount(null); setSettingsPage(null); }} style={styles.secondaryButton}><Text style={styles.action}>SIGN OUT</Text></Pressable>
      </View>
      <SectionBar title="Settings" />
      <View style={styles.settingsCard}>
        {accountSettingsPages.map((page) => <SettingsRow key={page.id} {...page} onPress={() => setSettingsPage(page.id)} />)}
      </View>
      {!!accountDataError && <Text accessibilityRole="alert" style={[styles.error, { marginTop: 12 }]}>{accountDataError}</Text>}
      {accountDataLoading && <View style={styles.accountSyncing}><ActivityIndicator color={C.muted} /><Text style={styles.muted}>Syncing your account…</Text></View>}
      <SectionBar title="Read posts" detail={`${viewedStories.length} STORIES`} />
      {renderAccountStoryList(showAllViewed ? viewedStories : viewedStories.slice(0, 3), 'Posts you read while signed in will appear here.')}
      {viewedStories.length > 3 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAllViewed }} onPress={() => setShowAllViewed((visible) => !visible)} style={styles.viewedExpandButton}>
        <Text style={styles.action}>{showAllViewed ? 'SHOW LESS' : `SHOW ALL ${viewedStories.length} POSTS`}</Text><SymbolView name={showAllViewed ? 'chevron.up' : 'chevron.down'} size={13} tintColor={C.muted} />
      </Pressable>}
      <SectionBar title="Saved list" detail={`${saved.length} STORIES`} />
      {renderAccountStoryList(saved, 'Stories you save will appear here. Your saved list syncs with your Coffee & Code account.', true)}
      <SectionBar title="Blocked accounts" detail={`${blockedAccounts.length} ACCOUNTS`} />
      {blockedAccounts.length ? blockedAccounts.map((blocked) => <View key={blocked.did} style={styles.blockedAccountRow}>
        <View style={{ flex: 1 }}><Text style={styles.authorName}>{blocked.did}</Text><Text style={styles.meta}>Blocked {formatDate(blocked.createdAt)}</Text></View>
        <Pressable accessibilityRole="button" disabled={accountBusy} onPress={() => unblockAccount(blocked.did)} style={styles.accountRemoveButton}><Text style={styles.action}>UNBLOCK</Text></Pressable>
      </View>) : <Text style={styles.emptyText}>You have not blocked any accounts on Coffee & Code.</Text>}
      {account.author && <>
        <SectionBar title="Author profile" detail="COFFEE & CODE" />
        <View style={styles.accountCard}>
          <Text style={styles.authorName}>{coffeeProfile?.displayName || accountProfile?.displayName || 'Author profile'}</Text>
          {!!coffeeProfile?.pronouns && <Text style={styles.meta}>{coffeeProfile.pronouns}</Text>}
          {!coffeeProfile && <Text style={styles.accountDescription}>Manage the author profile shown on your Coffee & Code author page.</Text>}
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://coffeencode.cc/account')} style={styles.profileLink}><Text style={styles.action}>MANAGE ON COFFEE & CODE  ↗</Text></Pressable>
        </View>
      </>}
    </> : <View style={styles.accountCard}>
      <Text style={styles.accountDescription}>Sign in with your AT Protocol account. Your provider handles the password and shows the permissions requested by Coffee & Code.</Text>
      {IS_EXPO_GO ? <Text style={styles.accountDescription}>Expo Go supports reading the live publication API. AT Protocol sign-in and member actions need the Coffee & Code development app because they use a native OAuth module.</Text> : <>
        <Text style={styles.fieldLabel}>Typically what you use to sign into orther At proto apps, Bluesky, Pckt, Leaflet, Anisota, rpg.actor, etc</Text>
        <TextInput value={loginHandle} onChangeText={setLoginHandle} placeholder="john-doe.coffeencode.cc or johndoe.com." placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={handleLogin} style={styles.searchInput} accessibilityLabel="AT Protocol handle" />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={accountBusy} onPress={handleLogin} style={styles.primaryButton}>{accountBusy ? <ActivityIndicator color={C.bg} /> : <Text style={styles.primaryButtonText}>Sign in</Text>}</Pressable>
        <Text style={styles.privacyNote}>Coffee & Code never asks for or stores your password.</Text>
      </>}
      <View style={styles.createAccountCard}>
          <Text style={styles.accountProfileName}>New to Coffee & Code?</Text>
          <Text style={styles.accountDescription}>Create an account on our PDS (your gateway to thounds of apps, including Bluesky).</Text>
          {IS_EXPO_GO && <Text style={styles.accountDescription}>You can get the code here, then continue signup in the Coffee & Code development app.</Text>}
          {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
          {!!inviteError && <Text accessibilityRole="alert" style={styles.error}>{inviteError}</Text>}
          {!inviteCode ? <Pressable accessibilityRole="button" disabled={inviteLoading} onPress={getInviteCode} style={styles.secondaryButton}>
            {inviteLoading ? <ActivityIndicator color={C.muted} /> : <Text style={styles.action}>CREATE ACCOUNT</Text>}
          </Pressable> : <>
            <Text style={styles.fieldLabel}>Copy this code, you will need this to continue your signup. We do this to prevent abuse and bot attacks</Text>
            <Text selectable style={styles.inviteCode}>{inviteCode}</Text>
            <Pressable accessibilityRole="button" disabled={accountBusy} onPress={continueAccountCreation} style={[styles.primaryButton, styles.inviteContinue]}>
              {accountBusy ? <ActivityIndicator color={C.bg} /> : <Text style={styles.primaryButtonText}>CONTINUE TO SIGNUP  →</Text>}
            </Pressable>
          </>}
      </View>
    </View>}
  </ScrollView>;

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content" backgroundColor={C.bg} />
    <View style={styles.header}>
      {selected ? <Pressable accessibilityRole="button" accessibilityLabel="Back to stories" onPress={closeStory} style={styles.headerSide}><SymbolView name="chevron.left" size={20} tintColor={C.muted} /><Text style={styles.action}>BACK</Text></Pressable> : <View style={styles.headerSide} />}
      <Text style={styles.brand}>Coffee & Code</Text>
      <View style={styles.headerSide} />
    </View>
    {loading ? <View style={styles.launchLoading}>
        <Image source={require('./assets/SplashScreen.png')} accessibilityLabel="Coffee & Code splash screen" style={styles.launchMark} resizeMode="contain" />
        <Text style={styles.launchTitle}>Coffee & Code</Text>
        <Text style={styles.launchSubtitle}>by daniel morrisey</Text>
        <ActivityIndicator color={C.muted} size="small" style={styles.launchSpinner} />
        <Text style={styles.launchStatus}>Loading...</Text>
      </View>
      : selected ? <ScrollView key={selected.uri || selected.title} contentContainerStyle={styles.article} onScroll={onArticleScroll} scrollEventThrottle={16} onTouchStart={onArticleTouchStart} onTouchEnd={onArticleTouchEnd} onTouchCancel={() => { articleTouchStart.current = null; }}>
        {!!selected.cover && <Image source={{ uri: selected.cover }} style={styles.cover} resizeMode="cover" />}
        <Text style={styles.articleTitle}>{selected.title}</Text>
        {!!selected.description && <Text style={styles.dek}>{selected.description}</Text>}
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          {articleAuthor?.avatar
            ? <Image source={{ uri: articleAuthor.avatar }} accessibilityLabel={`${articleAuthor.name} profile photo`} style={{ width: 22, height: 22, borderRadius: 11, marginRight: 8, backgroundColor: C.panelLight }} />
            : null}
          <Text style={[styles.meta, { flexShrink: 1 }]} numberOfLines={1}>{articleAuthor?.name || storyAuthor(selected)}  ·  {formatDate(selected.publishedAt)}</Text>
        </View>
        <View style={styles.engagementRow}>
          <Text style={styles.engagementStat}>◉  {engagement?.views ?? '—'} reads</Text><Text style={styles.engagementStat}>▤  {commentTotal || engagement?.comments || comments.length || 0} comments</Text>
        </View>
        <View style={styles.reactionActions}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(engagement?.liked) }} accessibilityLabel={`Like, ${engagement?.likes ?? 0}`} disabled={accountBusy} onPress={() => toggleReaction('like')} style={[styles.reactionButton, engagement?.liked && styles.reactionSelected]}><SymbolView name="hand.thumbsup" size={14} tintColor={engagement?.liked ? C.bg : C.muted} /><Text style={[styles.reactionButtonLabel, engagement?.liked && styles.reactionSelectedText]}>{engagement?.liked ? 'LIKED' : 'LIKE'}</Text><Text style={[styles.reactionButtonCount, engagement?.liked && styles.reactionSelectedText]}>{engagement?.likes ?? 0}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: saved.some((item) => item.uri === selected.uri) }} accessibilityLabel={`Save, ${engagement?.saves ?? 0}`} disabled={accountBusy} onPress={() => toggleSaved(selected)} style={[styles.reactionButton, saved.some((item) => item.uri === selected.uri) && styles.reactionSelected]}><SymbolView name="bookmark" size={14} tintColor={saved.some((item) => item.uri === selected.uri) ? C.bg : C.muted} /><Text style={[styles.reactionButtonLabel, saved.some((item) => item.uri === selected.uri) && styles.reactionSelectedText]}>{saved.some((item) => item.uri === selected.uri) ? 'SAVED' : 'SAVE'}</Text><Text style={[styles.reactionButtonCount, saved.some((item) => item.uri === selected.uri) && styles.reactionSelectedText]}>{engagement?.saves ?? 0}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(engagement?.disliked) }} accessibilityLabel={`Dislike, ${engagement?.dislikes ?? 0}`} disabled={accountBusy} onPress={() => toggleReaction('dislike')} style={[styles.reactionButton, engagement?.disliked && styles.reactionSelected]}><SymbolView name="hand.thumbsdown" size={14} tintColor={engagement?.disliked ? C.bg : C.muted} /><Text style={[styles.reactionButtonLabel, engagement?.disliked && styles.reactionSelectedText]}>{engagement?.disliked ? 'DISLIKED' : 'DISLIKE'}</Text><Text style={[styles.reactionButtonCount, engagement?.disliked && styles.reactionSelectedText]}>{engagement?.dislikes ?? 0}</Text></Pressable>
        </View>
        <View style={styles.rule} />
        {articleLoading ? <ActivityIndicator color={C.muted} style={{ marginTop: 28 }} /> : error ? <Text style={styles.error}>{error}</Text> : <ArticleBody markdown={body} />}
                {!!articleAuthor && !articleLoading && !error && <>
          <SectionBar title="About the author" />
          <View style={styles.accountCard}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {articleAuthor.avatar
                ? <Image source={{ uri: articleAuthor.avatar }} accessibilityLabel={`${articleAuthor.name} profile photo`} style={{ width: 56, height: 56, borderRadius: 28, marginRight: 12, backgroundColor: C.panelLight }} />
                : <View style={[styles.avatarPlaceholder, { marginRight: 12 }]}><Text style={styles.avatarInitial}>{(articleAuthor.name || 'C')[0].toUpperCase()}</Text></View>}
              <View style={{ flex: 1 }}>
                <Text style={styles.authorName}>{articleAuthor.name}</Text>
                {!!articleAuthor.handle && <Text style={styles.meta}>@{articleAuthor.handle}</Text>}
              </View>
            </View>
            {!!articleAuthor.bio && <Text style={styles.accountDescription}>{articleAuthor.bio}</Text>}
            <Pressable accessibilityRole="link" onPress={openAuthorProfile} style={styles.secondaryButton}><Text style={styles.action}>VIEW PROFILE  ↗</Text></Pressable>
          </View>
        </>}
        <SectionBar title="Conversation" detail={`${commentTotal || comments.length} COMMENTS`} />
        {commentLoading && !comments.length && <ActivityIndicator color={C.muted} style={{ marginVertical: 18 }} />}
        {!!commentError && <Text accessibilityRole="alert" style={styles.error}>{commentError}</Text>}
        {comments.length ? comments.filter((comment) => !comment.parentUri || !comments.some((parent) => parent.uri === comment.parentUri)).map((comment) => renderCommentThread(comment)) : !commentLoading && !commentError && <Text style={styles.emptyText}>No comments yet. Start the conversation.</Text>}
        {commentLoading && !!comments.length && <ActivityIndicator color={C.muted} style={{ marginVertical: 12 }} />}
        {!!commentCursor && <Pressable accessibilityRole="button" disabled={commentLoading} onPress={() => loadComments(selected.uri, commentCursor, true)} style={styles.loadCommentsButton}><Text style={styles.action}>{commentLoading ? 'LOADING…' : 'LOAD MORE COMMENTS'}</Text></Pressable>}
        <View style={styles.commentComposer}>
          {!!replyTarget && <View style={styles.replyingTo}><View style={{ flex: 1 }}><Text style={styles.fieldLabel}>REPLYING TO</Text><Text style={styles.commentAuthor}>{replyTarget.displayName || replyTarget.handle}</Text></View><Pressable accessibilityRole="button" onPress={() => setReplyTarget(null)}><Text style={styles.action}>CANCEL</Text></Pressable></View>}
          <Text style={styles.fieldLabel}>{account ? replyTarget ? 'WRITE A REPLY' : 'ADD TO THE CONVERSATION' : 'SIGN IN TO JOIN THE CONVERSATION'}</Text>
          <TextInput value={commentDraft} onChangeText={setCommentDraft} editable={Boolean(account) && !accountBusy} placeholder={account ? replyTarget ? 'Write a reply…' : 'Write a thoughtful comment…' : 'Sign in from the Account tab to comment'} placeholderTextColor={C.muted} multiline maxLength={3000} style={[styles.commentInput, !account && styles.disabledInput]} />
          <Pressable disabled={accountBusy || Boolean(account && !commentDraft.trim())} onPress={sendComment} style={[styles.primaryButton, (accountBusy || Boolean(account && !commentDraft.trim())) && styles.disabledButton]}><Text style={styles.primaryButtonText}>{accountBusy ? 'PUBLISHING…' : !account ? 'SIGN IN TO COMMENT' : replyTarget ? 'PUBLISH REPLY' : 'PUBLISH COMMENT'}</Text></Pressable>
        </View>
        <Pressable onPress={closeStory} style={styles.returnButton}><Text style={styles.action}>BACK TO LATEST STORIES</Text></Pressable>
      </ScrollView>
      : tab === 'Latest' ? renderLatest() : tab === 'Archive' ? renderSearch() : tab === 'Notifications' ? renderNotifications() : tab === 'Saved' ? renderSaved() : tab === 'Authors' ? renderAuthors() : renderAccount()}
    <Animated.View style={[styles.tabBar, selected && styles.articleTabBar, selected && { height: navCompactProgress.interpolate({ inputRange: [0, 1], outputRange: [TAB_BAR_HEIGHT, 42] }) }]}>
      <TabButton label="Today" icon="newspaper.fill" active={tab === 'Latest' || tab === 'Authors'} onPress={() => selectMainTab('Latest')} compactProgress={selected ? navCompactProgress : null} />
      <TabButton label="Archive" icon="magnifyingglass" active={tab === 'Archive'} onPress={() => { selectMainTab('Archive'); if (!archiveLoaded) loadArchive(); }} compactProgress={selected ? navCompactProgress : null} />
      <TabButton label="Notifications" icon="bell.fill" active={tab === 'Notifications'} onPress={() => selectMainTab('Notifications')} compactProgress={selected ? navCompactProgress : null} badgeCount={notificationBadgeCount} />
      <TabButton label="Saved" icon="bookmark.fill" active={tab === 'Saved'} onPress={() => selectMainTab('Saved')} compactProgress={selected ? navCompactProgress : null} />
      <TabButton label="Account" icon="person.crop.circle.fill" imageUri={accountProfile?.avatar} active={tab === 'Account'} onPress={() => selectMainTab('Account')} compactProgress={selected ? navCompactProgress : null} />
    </Animated.View>
  </SafeAreaView>;
}
