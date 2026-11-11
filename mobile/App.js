import React, { useCallback, useEffect, useMemo, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { SymbolView } from 'expo-symbols';
import { restoreSession, signIn, signOut } from './oauth';
import {
  ActivityIndicator, Image, Linking, Pressable, SafeAreaView, ScrollView,
  StatusBar, StyleSheet, Text, TextInput, View, RefreshControl,
} from 'react-native';

const API = 'https://coffeencode.cc/api';
const IS_EXPO_GO = Constants.appOwnership === 'expo';
const SAVED_KEY = 'coffee-and-code:saved';
const SAVED_OWNER_KEY = 'coffee-and-code:saved-owner';
const SAVE_COLLECTION = 'cc.coffeencode.save';
const VIEW_COLLECTION = 'cc.coffeencode.interact.view';
const BLOCK_COLLECTION = 'cc.coffeencode.user.block';
const C = {
  bg: '#281914', panel: '#3b2a1d', panelLight: '#493426', ink: '#fffdf7',
  reading: '#f1eadc', muted: '#b2ac88', divider: '#806747', line: 'rgba(164,132,90,.28)',
  error: '#f1b9a8',
};

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function storyAuthor(story) {
  return story.author?.displayName || story.author?.handle || 'Coffee & Code';
}

async function listRepoRecords(agent, did, collection) {
  const records = [];
  const seenCursors = new Set();
  let cursor;
  do {
    const { data } = await agent.com.atproto.repo.listRecords({ repo: did, collection, limit: 100, ...(cursor ? { cursor } : {}) });
    records.push(...(data.records || []));
    if (!data.cursor || seenCursors.has(data.cursor)) break;
    seenCursors.add(data.cursor);
    cursor = data.cursor;
  } while (cursor);
  return records;
}

function storyRecordKey(uri) {
  return uri?.match(/^at:\/\/[^/]+\/[^/]+\/([^/]+)$/)?.[1];
}

async function resolvePdsEndpoint(did) {
  let documentUrl;
  if (did.startsWith('did:plc:')) {
    documentUrl = `https://plc.directory/${encodeURIComponent(did)}`;
  } else if (did.startsWith('did:web:')) {
    const [, , host, ...path] = did.split(':');
    if (!host) return '';
    const decodedPath = path.map((part) => {
      try { return decodeURIComponent(part); } catch { return part; }
    });
    documentUrl = decodedPath.length
      ? `https://${host}/${decodedPath.map(encodeURIComponent).join('/')}/did.json`
      : `https://${host}/.well-known/did.json`;
  } else return '';
  try {
    const response = await fetch(documentUrl);
    if (!response.ok) return '';
    const document = await response.json();
    return document.service?.find((service) => service.type === 'AtprotoPersonalDataServer')?.serviceEndpoint || '';
  } catch {
    return '';
  }
}

function storiesFromRecords(records, postByUri, cachedStories = []) {
  const cachedByUri = new Map(cachedStories.map((story) => [story.uri, story]));
  const unique = new Map();
  records
    .filter((record) => typeof record.value?.target?.document === 'string' && record.value.target.document.startsWith('at://'))
    .sort((a, b) => (Date.parse(b.value?.createdAt || '') || 0) - (Date.parse(a.value?.createdAt || '') || 0))
    .forEach((record) => {
      const uri = record.value.target.document;
      if (unique.has(uri)) return;
      const cached = cachedByUri.get(uri) || {};
      const published = postByUri.get(uri) || {};
      unique.set(uri, {
        ...published,
        ...cached,
        uri,
        title: cached.title || published.title || 'Saved story',
        publishedAt: cached.publishedAt || published.publishedAt || record.value.createdAt,
        savedAt: record.value.createdAt,
        cover: cached.cover || published.cover,
        path: cached.path || published.path,
      });
    });
  return [...unique.values()];
}

function plainMarkdown(value = '') {
  return value.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*_~`]/g, '').trim();
}

function InlineText({ text, style }) {
  const parts = [];
  const pattern = /(https?:\/\/[^\s)]+|\[[^\]]+\]\(https?:\/\/[^)]+\))/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    const link = match[0];
    const markdown = link.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    parts.push({ text: markdown ? markdown[1] : link, url: markdown ? markdown[2] : link });
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return <Text style={style}>{parts.map((part, i) => part.url
    ? <Text key={i} style={styles.inlineLink} onPress={() => Linking.openURL(part.url)}>{part.text}</Text>
    : <Text key={i}>{part.text}</Text>)}</Text>;
}

function ArticleBody({ markdown }) {
  const normalized = markdown.replace(/^---[\s\S]*?---\s*/, '').replace(/^# .+\n+/, '');
  const blocks = normalized.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean);
  return <View style={styles.prose}>{blocks.map((block, index) => {
    if (/^\s*([-*_])\1\1+\s*$/.test(block)) return <View key={index} style={styles.rule} />;
    const heading = block.match(/^(#{1,4})\s+(.+)$/s);
    if (heading) return <InlineText key={index} text={plainMarkdown(heading[2])} style={[styles.articleHeading, heading[1].length > 2 && styles.articleSubheading]} />;
    if (/^>\s?/.test(block)) return <InlineText key={index} text={plainMarkdown(block.replace(/^>\s?/gm, '').replace(/\n/g, ' '))} style={styles.quote} />;
    if (/^[-*+]\s/m.test(block) || /^\d+\.\s/m.test(block)) {
      const items = block.split('\n').filter(Boolean);
      return <View key={index} style={styles.listBlock}>{items.map((item, itemIndex) => {
        const content = item.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '');
        return <View key={itemIndex} style={styles.listItem}><Text style={styles.bullet}>{/^\d+\./.test(item) ? `${itemIndex + 1}.` : '•'}</Text><InlineText text={plainMarkdown(content)} style={styles.paragraph} /></View>;
      })}</View>;
    }
    if (/^```/.test(block)) return <Text key={index} style={styles.code}>{block.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')}</Text>;
    const image = block.match(/^!\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/);
    if (image) return <Image key={index} source={{ uri: image[2] }} accessibilityLabel={image[1]} style={styles.articleImage} resizeMode="cover" />;
    return <InlineText key={index} text={plainMarkdown(block.replace(/\n/g, ' '))} style={styles.paragraph} />;
  })}</View>;
}

function SectionBar({ title, detail }) {
  return <View style={styles.sectionBar}><Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>{!!detail && <Text style={styles.sectionDetail}>{detail}</Text>}</View>;
}

function StoryRow({ story, featured, compact, onPress }) {
  if (compact) return <Pressable accessibilityRole="button" accessibilityLabel={`Read ${story.title}`} onPress={onPress} style={styles.compactStory}>
    {story.cover ? <Image source={{ uri: story.cover }} style={styles.compactImage} resizeMode="cover" /> : <View style={styles.compactPlaceholder}><Text style={styles.placeholderMark}>C&amp;C</Text></View>}
    <View style={styles.compactCopy}><Text style={styles.compactTitle} numberOfLines={3}>{story.title}</Text><Text style={styles.compactSummary} numberOfLines={2}>{story.description || ''}</Text><Text style={styles.compactMeta} numberOfLines={1}>{formatDate(story.publishedAt)}  ·  {storyAuthor(story)}</Text></View>
  </Pressable>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Read ${story.title}`} onPress={onPress} style={styles.storyRow}>
    {!!story.cover && <Image source={{ uri: story.cover }} style={featured ? styles.heroImage : styles.storyImage} resizeMode="cover" />}
    <Text style={featured ? styles.heroTitle : styles.storyTitle}>{story.title}</Text>
    {!!story.description && <Text numberOfLines={featured ? 4 : 3} style={styles.summary}>{story.description}</Text>}
    <Text style={styles.meta}>{storyAuthor(story)}  ·  {formatDate(story.publishedAt)}</Text>
    <Text style={styles.read}>READ STORY  →</Text>
  </Pressable>;
}

function TabButton({ label, icon, active, onPress, imageUri }) {
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={styles.tabButton}>
    {imageUri ? <Image source={{ uri: imageUri }} accessibilityLabel="Your profile photo" style={[styles.tabProfileImage, active && styles.tabProfileImageActive]} /> : <SymbolView name={icon} size={21} tintColor={active ? C.ink : C.muted} type={active ? 'hierarchical' : 'monochrome'} />}
    <Text style={[styles.tabLabel, active && styles.tabActive]}>{label}</Text>
  </Pressable>;
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
  const [engagement, setEngagement] = useState(null);
  const [activeTag, setActiveTag] = useState('');
  const [archiveStories, setArchiveStories] = useState([]);
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [savedLoaded, setSavedLoaded] = useState(false);
  const [account, setAccount] = useState(null);
  const [accountProfile, setAccountProfile] = useState(null);
  const [accountPds, setAccountPds] = useState(null);
  const [viewedStories, setViewedStories] = useState([]);
  const [showAllViewed, setShowAllViewed] = useState(false);
  const [blockedAccounts, setBlockedAccounts] = useState([]);
  const [authorProfile, setAuthorProfile] = useState(null);
  const [accountDataLoading, setAccountDataLoading] = useState(false);
  const [accountDataError, setAccountDataError] = useState('');
  const [accountRefresh, setAccountRefresh] = useState(0);
  const [loginHandle, setLoginHandle] = useState('');
  const [commentDraft, setCommentDraft] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [articleLoading, setArticleLoading] = useState(false);
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
      setError(e.message || 'Could not load stories. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);
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
        setAuthorProfile(null);
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
      setAuthorProfile(null);
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
            return { ...post, uri, title: post.title || 'Viewed story', publishedAt: post.publishedAt, viewedAt: record.value.createdAt, markdownUrl: key ? `${API}/documents/${encodeURIComponent(key)}.md?uri=${encodeURIComponent(uri)}` : undefined };
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

        if (activeAccount.author) {
          try {
            const { data } = await activeAccount.agent.com.atproto.repo.getRecord({ repo: did, collection: 'cc.coffeencode.author.profile', rkey: 'self' });
            if (!cancelled) setAuthorProfile(data.value);
          } catch {
            if (!cancelled) setAuthorProfile(null);
          }
        } else setAuthorProfile(null);
      } catch (e) {
        if (!cancelled) setAccountDataError(e.message || 'Could not sync your account details.');
      } finally {
        if (!cancelled) setAccountDataLoading(false);
      }
    };
    loadAccountData();
    return () => { cancelled = true; };
  }, [account?.session?.did, savedLoaded, accountRefresh]);

  const openStory = useCallback(async (story) => {
    setSelected(story);
    setBody('');
    setError('');
    setArticleLoading(true);
    setComments([]);
    setEngagement(null);
    try {
      const storyUrl = story.markdownUrl || `${API}/documents/${encodeURIComponent(story.uri.split('/').pop())}.md?uri=${encodeURIComponent(story.uri)}`;
      const markdownResponse = await fetch(storyUrl).catch(() => null);
      const storyResponse = markdownResponse?.ok ? markdownResponse : await fetch(`${API}/documents/${encodeURIComponent(story.uri.split('/').pop())}?uri=${encodeURIComponent(story.uri)}`);
      if (!storyResponse.ok) throw new Error(`Story request failed (${storyResponse.status}). Please try again.`);
      const responseText = await storyResponse.text();
      if (!responseText.trim()) throw new Error('This story has no readable content.');
      try {
        const json = JSON.parse(responseText);
        if (json.error) throw new Error(json.error);
        setBody(json.content || '');
      } catch (parseError) {
        if (parseError instanceof SyntaxError) setBody(responseText);
        else throw parseError;
      }
      const [commentsResponse, engagementResponse] = await Promise.all([
        fetch(`${API}/comments?subject=${encodeURIComponent(story.uri)}&limit=40${account?.session?.did ? `&did=${encodeURIComponent(account.session.did)}` : ''}`).catch(() => null),
        fetch(`${API}/reactions?subject=${encodeURIComponent(story.uri)}${account?.session?.did ? `&did=${encodeURIComponent(account.session.did)}` : ''}`).catch(() => null),
      ]);
      if (commentsResponse?.ok) { const data = await commentsResponse.json(); setComments(data.records || []); }
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
  }, [account]);

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

  const sendComment = async () => {
    const text = commentDraft.trim();
    if (!account?.agent) { setTab('Account'); setError('Sign in to post a comment.'); return; }
    if (!text) return;
    setAccountBusy(true); setError('');
    try {
      await account.agent.com.atproto.repo.createRecord({ repo: account.session.did, collection: 'cc.coffeencode.comment', record: { $type: 'cc.coffeencode.comment', subject: { uri: selected.uri }, text, createdAt: new Date().toISOString() } });
      setCommentDraft('');
      const response = await fetch(`${API}/comments?subject=${encodeURIComponent(selected.uri)}&limit=40&did=${encodeURIComponent(account.session.did)}`);
      if (response.ok) setComments((await response.json()).records || []);
    } catch (e) { setError(e.message || 'Could not publish your comment.'); }
    finally { setAccountBusy(false); }
  };

  const toggleReaction = async (kind) => {
    if (!account?.agent) { setTab('Account'); setError('Sign in to react to this story.'); return; }
    const collection = `cc.coffeencode.interact.${kind}`;
    setAccountBusy(true); setError('');
    try {
      const { data } = await account.agent.com.atproto.repo.listRecords({ repo: account.session.did, collection, limit: 100 });
      const existing = data.records.find((item) => item.value?.document === selected.uri);
      if (existing) await account.agent.com.atproto.repo.deleteRecord({ repo: account.session.did, collection, rkey: existing.uri.split('/').pop() });
      else {
        const other = `cc.coffeencode.interact.${kind === 'like' ? 'dislike' : 'like'}`;
        const { data: opposite } = await account.agent.com.atproto.repo.listRecords({ repo: account.session.did, collection: other, limit: 100 });
        const previous = opposite.records.find((item) => item.value?.document === selected.uri);
        await account.agent.com.atproto.repo.createRecord({ repo: account.session.did, collection, record: { $type: collection, document: selected.uri, createdAt: new Date().toISOString() } });
        if (previous) await account.agent.com.atproto.repo.deleteRecord({ repo: account.session.did, collection: other, rkey: previous.uri.split('/').pop() });
      }
      const response = await fetch(`${API}/reactions?subject=${encodeURIComponent(selected.uri)}&did=${encodeURIComponent(account.session.did)}`);
      if (response.ok) setEngagement(await response.json());
    } catch (e) { setError(e.message || 'Could not update your reaction.'); }
    finally { setAccountBusy(false); }
  };

  const closeStory = () => { setSelected(null); setBody(''); setError(''); };
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
  const openContributor = (author) => { setActiveAuthor(author); setTab('Authors'); };

  const renderLatest = () => <ScrollView contentContainerStyle={styles.homeContent} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFeed(true)} tintColor={C.muted} /> }>
    <View style={styles.homeHeading}><View><Text style={styles.pageTitle}>Top Stories</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Search the archive" onPress={() => { setTab('Archive'); if (!archiveLoaded) loadArchive(); }} style={styles.archiveShortcut}><SymbolView name="magnifyingglass" size={20} tintColor={C.ink} /></Pressable></View>
    <SectionBar title="Latest" detail={`${feed?.totalAvailable ?? stories.length} STORIES`} />
    {error ? <View style={styles.empty}><Text style={styles.error}>{error}</Text><Pressable onPress={() => loadFeed()}><Text style={styles.action}>TRY AGAIN</Text></Pressable></View>
      : !stories.length ? <Text style={styles.emptyText}>No stories have been published yet. Please check back soon.</Text>
        : topStories.map((story, index) => <StoryRow key={story.uri || `${story.title}-${index}`} story={story} featured={index === 0} compact={index > 0} onPress={() => openStory(story)} />)}
    {!!pinnedStories.length && <><SectionBar title="Pinned" detail={`${pinnedStories.length} PICKS`} />{pinnedStories.map((story) => <StoryRow key={`pinned-${story.uri}`} story={story} compact onPress={() => openStory(story)} />)}</>}
    {!!remainingLatest.length && <><SectionBar title="More stories" detail={`${remainingLatest.length} STORIES`} />{remainingLatest.map((story) => <StoryRow key={`more-${story.uri}`} story={story} compact onPress={() => openStory(story)} />)}</>}
    {!!authors.length && <><SectionBar title="Authors" />{authors.map((author) => <Pressable key={author.did} style={styles.authorRow} onPress={() => openContributor(author)}>
      {author.avatar ? <Image source={{ uri: author.avatar }} accessibilityLabel={`${author.displayName || author.handle} profile photo`} style={styles.avatar} /> : <View style={styles.avatarPlaceholder}><Text style={styles.avatarInitial}>{(author.displayName || author.handle || 'C')[0].toUpperCase()}</Text></View>}
      <View style={styles.authorCopy}><Text style={styles.authorName}>{author.displayName || author.handle}</Text><Text style={styles.meta}>@{author.handle}  ·  {author.storyCount} {author.storyCount === 1 ? 'STORY' : 'STORIES'}</Text></View><Text style={styles.chevron}>›</Text>
    </Pressable>)}</>}
    {!!promotion && <Pressable style={styles.promotion} onPress={() => Linking.openURL(promotion.url)}><Text style={styles.promoTitle}>We're looking for writers</Text><Text style={styles.promoDescription}>Coffee &amp; Code is made possible thanks to you! One way you can contribute is to write for us!</Text><Text style={styles.action}>WRITE FOR US  ›</Text></Pressable>}
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

  const renderSaved = () => <ScrollView contentContainerStyle={styles.content}>
    <Text style={styles.pageTitle}>Saved stories</Text>
    {saved.length ? saved.map((story, index) => <StoryRow key={story.uri || index} compact story={story} onPress={() => openStory(story)} />) : <View style={styles.empty}><Text style={styles.emptyTitle}>Keep a story for later.</Text><Text style={styles.emptyText}>Tap the bookmark on any story to add it to your reading list. {account ? 'Your reading list syncs with your AT Protocol account and coffeencode.cc/account.' : 'Saved stories stay on this device until you sign in.'}</Text></View>}
  </ScrollView>;

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

  const renderAccount = () => <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={accountDataLoading} onRefresh={() => setAccountRefresh((value) => value + 1)} tintColor={C.muted} />}>
    <Text style={styles.pageTitle}>{account ? 'Your account' : 'Sign in'}</Text>
    {account ? <>
      <View style={styles.accountCard}>
        {accountProfile?.avatar ? <Image source={{ uri: accountProfile.avatar }} accessibilityLabel="Profile photo" style={styles.accountProfileAvatar} /> : <View style={styles.accountAvatar}><SymbolView name="person.fill" size={25} tintColor={C.ink} /></View>}
        <Text style={styles.accountProfileName}>{accountProfile?.displayName || accountProfile?.handle || 'Your account'}</Text>
        <View style={styles.accountIdentityDetails}>
          <Text style={styles.accountIdentityLabel}>HANDLE</Text><Text selectable style={styles.accountIdentityValue}>{accountProfile?.handle ? `@${accountProfile.handle}` : 'Unavailable'}</Text>
          <Text style={styles.accountIdentityLabel}>DID</Text><Text selectable style={styles.accountIdentityValue}>{account.session.did}</Text>
          <Text style={styles.accountIdentityLabel}>PDS</Text><Text selectable style={styles.accountIdentityValue}>{accountPds === null ? 'Resolving…' : accountPds || 'Unavailable'}</Text>
        </View>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`https://bsky.app/profile/${encodeURIComponent(accountProfile?.handle || account.session.did)}`)} style={styles.profileLink}><Text style={styles.action}>VIEW PROFILE  ↗</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={accountBusy} onPress={async () => { await signOut(account); setAccount(null); }} style={styles.secondaryButton}><Text style={styles.action}>SIGN OUT</Text></Pressable>
      </View>
      {!!accountDataError && <Text accessibilityRole="alert" style={[styles.error, { marginTop: 12 }]}>{accountDataError}</Text>}
      {accountDataLoading && <View style={styles.accountSyncing}><ActivityIndicator color={C.muted} /><Text style={styles.muted}>Syncing your account…</Text></View>}
      <SectionBar title="Posts you’ve viewed" detail={`${viewedStories.length} STORIES`} />
      {renderAccountStoryList(showAllViewed ? viewedStories : viewedStories.slice(0, 3), 'Posts you read while signed in will appear here.')}
      {viewedStories.length > 3 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showAllViewed }} onPress={() => setShowAllViewed((visible) => !visible)} style={styles.viewedExpandButton}>
        <Text style={styles.action}>{showAllViewed ? 'SHOW LESS' : `SHOW ALL ${viewedStories.length} POSTS`}</Text><SymbolView name={showAllViewed ? 'chevron.up' : 'chevron.down'} size={13} tintColor={C.muted} />
      </Pressable>}
      <SectionBar title="Reading list" detail={`${saved.length} STORIES`} />
      {renderAccountStoryList(saved, 'Stories you save will appear here. Your reading list syncs with coffeencode.cc/account.', true)}
      <SectionBar title="Blocked accounts" detail={`${blockedAccounts.length} ACCOUNTS`} />
      {blockedAccounts.length ? blockedAccounts.map((blocked) => <View key={blocked.did} style={styles.blockedAccountRow}>
        <View style={{ flex: 1 }}><Text style={styles.authorName}>{blocked.did}</Text><Text style={styles.meta}>Blocked {formatDate(blocked.createdAt)}</Text></View>
        <Pressable accessibilityRole="button" disabled={accountBusy} onPress={() => unblockAccount(blocked.did)} style={styles.accountRemoveButton}><Text style={styles.action}>UNBLOCK</Text></Pressable>
      </View>) : <Text style={styles.emptyText}>You have not blocked any accounts.</Text>}
      {account.author && <>
        <SectionBar title="Author profile" detail="COFFEE & CODE" />
        <View style={styles.accountCard}>
          <Text style={styles.authorName}>{authorProfile?.displayName || accountProfile?.displayName || 'Author profile'}</Text>
          {!!authorProfile?.pronouns && <Text style={styles.meta}>{authorProfile.pronouns}</Text>}
          {!!authorProfile?.description && <Text style={styles.accountDescription}>{authorProfile.description}</Text>}
          {!authorProfile && <Text style={styles.accountDescription}>Manage the author profile shown on your Coffee & Code author page.</Text>}
          <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://coffeencode.cc/account')} style={styles.profileLink}><Text style={styles.action}>MANAGE ON COFFEE & CODE  ↗</Text></Pressable>
        </View>
      </>}
    </> : <View style={styles.accountCard}>
      <Text style={styles.accountDescription}>Sign in with your AT Protocol account. Your provider handles the password and shows the permissions requested by Coffee & Code.</Text>
      {IS_EXPO_GO ? <Text style={styles.accountDescription}>Expo Go supports reading the live publication API. AT Protocol sign-in and member actions need the Coffee & Code development app because they use a native OAuth module.</Text> : <>
        <Text style={styles.fieldLabel}>HANDLE OR ACCOUNT PROVIDER</Text>
        <TextInput value={loginHandle} onChangeText={setLoginHandle} placeholder="name.bsky.social" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={handleLogin} style={styles.searchInput} accessibilityLabel="AT Protocol handle" />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={accountBusy} onPress={handleLogin} style={styles.primaryButton}>{accountBusy ? <ActivityIndicator color={C.bg} /> : <Text style={styles.primaryButtonText}>CONTINUE SECURELY  →</Text>}</Pressable>
        <Text style={styles.privacyNote}>Coffee & Code never asks for or stores your password.</Text>
      </>}
    </View>}
  </ScrollView>;

  return <SafeAreaView style={styles.safe}>
    <StatusBar barStyle="light-content" backgroundColor={C.bg} />
    <View style={styles.header}>
      {selected ? <Pressable accessibilityRole="button" accessibilityLabel="Back to stories" onPress={closeStory} style={styles.headerSide}><SymbolView name="chevron.left" size={20} tintColor={C.muted} /><Text style={styles.action}>BACK</Text></Pressable> : <View style={styles.headerSide} />}
      <Text style={styles.brand}>Coffee & Code</Text>
      <View style={styles.headerSide} />
    </View>
    {loading ? <View style={styles.center}><ActivityIndicator color={C.muted} /><Text style={styles.muted}>Loading the latest stories…</Text></View>
      : selected ? <ScrollView key={selected.uri || selected.title} contentContainerStyle={styles.article}>
        {!!selected.cover && <Image source={{ uri: selected.cover }} style={styles.cover} resizeMode="cover" />}
        <Text style={styles.articleTitle}>{selected.title}</Text>
        {!!selected.description && <Text style={styles.dek}>{selected.description}</Text>}
        <Text style={styles.meta}>{storyAuthor(selected)}  ·  {formatDate(selected.publishedAt)}</Text>
        <View style={styles.engagementRow}>
          <Text style={styles.engagementStat}>◉  {engagement?.views ?? '—'} reads</Text><Text style={styles.engagementStat}>▤  {comments.length || engagement?.comments || 0} comments</Text>
        </View>
        <View style={styles.reactionActions}>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(engagement?.liked) }} disabled={accountBusy} onPress={() => toggleReaction('like')} style={[styles.reactionButton, engagement?.liked && styles.reactionSelected]}><SymbolView name="hand.thumbsup" size={17} tintColor={engagement?.liked ? C.bg : C.muted} /><Text style={[styles.reactionButtonLabel, engagement?.liked && styles.reactionSelectedText]}>{engagement?.liked ? 'LIKED' : 'LIKE'}</Text><Text style={[styles.reactionButtonCount, engagement?.liked && styles.reactionSelectedText]}>{engagement?.likes ?? 0}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: saved.some((item) => item.uri === selected.uri) }} disabled={accountBusy} onPress={() => toggleSaved(selected)} style={[styles.reactionButton, saved.some((item) => item.uri === selected.uri) && styles.reactionSelected]}><SymbolView name="bookmark" size={17} tintColor={saved.some((item) => item.uri === selected.uri) ? C.bg : C.muted} /><Text style={[styles.reactionButtonLabel, saved.some((item) => item.uri === selected.uri) && styles.reactionSelectedText]}>{saved.some((item) => item.uri === selected.uri) ? 'SAVED' : 'SAVE'}</Text><Text style={[styles.reactionButtonCount, saved.some((item) => item.uri === selected.uri) && styles.reactionSelectedText]}>{engagement?.saves ?? 0}</Text></Pressable>
          <Pressable accessibilityRole="button" accessibilityState={{ selected: Boolean(engagement?.disliked) }} disabled={accountBusy} onPress={() => toggleReaction('dislike')} style={[styles.reactionButton, engagement?.disliked && styles.reactionSelected]}><SymbolView name="hand.thumbsdown" size={17} tintColor={engagement?.disliked ? C.bg : C.muted} /><Text style={[styles.reactionButtonLabel, engagement?.disliked && styles.reactionSelectedText]}>{engagement?.disliked ? 'DISLIKED' : 'DISLIKE'}</Text><Text style={[styles.reactionButtonCount, engagement?.disliked && styles.reactionSelectedText]}>{engagement?.dislikes ?? 0}</Text></Pressable>
        </View>
        <View style={styles.rule} />
        {articleLoading ? <ActivityIndicator color={C.muted} style={{ marginTop: 28 }} /> : error ? <Text style={styles.error}>{error}</Text> : <ArticleBody markdown={body} />}
        <SectionBar title="Conversation" detail={`${comments.length} COMMENTS`} />
        {comments.length ? comments.map((comment) => <View key={comment.uri} style={styles.comment}>
          <View style={styles.commentHeader}>{comment.avatar ? <Image source={{ uri: comment.avatar }} style={styles.commentAvatar} /> : <View style={styles.commentAvatarPlaceholder} />}<View><Text style={styles.commentAuthor}>{comment.displayName || comment.handle}</Text><Text style={styles.meta}>{formatDate(comment.createdAt)}</Text></View></View>
          <Text style={styles.commentText}>{comment.text}</Text>
        </View>) : <Text style={styles.emptyText}>No comments yet. Join the conversation on the Coffee & Code website.</Text>}
        <View style={styles.commentComposer}><Text style={styles.fieldLabel}>{account ? 'ADD TO THE CONVERSATION' : 'SIGN IN TO JOIN THE CONVERSATION'}</Text><TextInput value={commentDraft} onChangeText={setCommentDraft} editable={Boolean(account) && !accountBusy} placeholder={account ? 'Write a thoughtful comment…' : 'Sign in from the Account tab to comment'} placeholderTextColor={C.muted} multiline maxLength={3000} style={[styles.commentInput, !account && styles.disabledInput]} /><Pressable disabled={!account || accountBusy || !commentDraft.trim()} onPress={sendComment} style={[styles.primaryButton, (!account || !commentDraft.trim()) && styles.disabledButton]}><Text style={styles.primaryButtonText}>{accountBusy ? 'PUBLISHING…' : 'PUBLISH COMMENT'}</Text></Pressable></View>
        <Pressable onPress={() => Linking.openURL(`https://coffeencode.cc${selected.path || '/' }#comments`)} style={styles.outbound}><Text style={styles.action}>OPEN DISCUSSION ON THE WEBSITE  ↗</Text></Pressable>
        <Pressable onPress={closeStory} style={styles.returnButton}><Text style={styles.action}>BACK TO LATEST STORIES</Text></Pressable>
      </ScrollView>
      : tab === 'Latest' ? renderLatest() : tab === 'Archive' ? renderSearch() : tab === 'Saved' ? renderSaved() : tab === 'Authors' ? renderAuthors() : renderAccount()}
    {!selected && !loading && <View style={styles.tabBar}>
      <TabButton label="Today" icon="newspaper.fill" active={tab === 'Latest' || tab === 'Authors'} onPress={() => { setTab('Latest'); setActiveAuthor(null); }} />
      <TabButton label="Archive" icon="magnifyingglass" active={tab === 'Archive'} onPress={() => { setTab('Archive'); setActiveAuthor(null); if (!archiveLoaded) loadArchive(); }} />
      <TabButton label="Saved" icon="bookmark.fill" active={tab === 'Saved'} onPress={() => { setTab('Saved'); setActiveAuthor(null); }} />
      <TabButton label="Account" icon="person.crop.circle.fill" imageUri={accountProfile?.avatar} active={tab === 'Account'} onPress={() => { setTab('Account'); setActiveAuthor(null); }} />
    </View>}
  </SafeAreaView>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: { minHeight: 58, paddingHorizontal: 18, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSide: { width: 72, minHeight: 42, justifyContent: 'center', flexDirection: 'row', alignItems: 'center', gap: 5 }, headerTrailing: { alignItems: 'flex-end' },
  brand: { color: C.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 23, letterSpacing: -1 },
  refresh: { color: C.muted, fontSize: 27, textAlign: 'right' }, action: { color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2 },
  content: { paddingHorizontal: 18, paddingBottom: 32 }, homeContent: { paddingHorizontal: 18, paddingBottom: 24 }, homeHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 17 }, archiveShortcut: { width: 42, height: 42, borderRadius: 21, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center', marginTop: 17 },
  intro: { paddingTop: 19, paddingBottom: 8 }, introText: { color: C.muted, fontFamily: 'Georgia', fontSize: 16, lineHeight: 23 },
  sectionBar: { borderTopWidth: 3, borderTopColor: C.divider, borderBottomWidth: 1, borderBottomColor: C.line, marginTop: 18, marginBottom: 2, paddingVertical: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: C.ink, fontWeight: '800', fontSize: 11, letterSpacing: 1.5 }, sectionDetail: { color: C.muted, fontSize: 9, letterSpacing: 1.1 },
  storyRow: { borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 20 }, heroImage: { width: '100%', height: 218, marginBottom: 19, backgroundColor: C.panel }, storyImage: { width: '100%', height: 162, marginBottom: 17, backgroundColor: C.panel },
  compactStory: { minHeight: 106, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center', gap: 13 }, compactImage: { width: 94, height: 82, borderRadius: 7, backgroundColor: C.panel }, compactPlaceholder: { width: 94, height: 82, borderRadius: 7, backgroundColor: C.panel, alignItems: 'center', justifyContent: 'center' }, placeholderMark: { color: C.muted, fontFamily: 'Georgia', fontSize: 15, fontWeight: '700' }, compactCopy: { flex: 1, justifyContent: 'center' }, compactTitle: { color: C.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 16, lineHeight: 20 }, compactSummary: { color: C.muted, fontSize: 11, lineHeight: 15, marginTop: 4 }, compactMeta: { color: C.muted, fontSize: 9, marginTop: 6 },
  heroTitle: { color: C.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 33, lineHeight: 39, marginBottom: 9 },
  storyTitle: { color: C.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 23, lineHeight: 29, marginBottom: 8 }, summary: { color: C.muted, fontSize: 15, lineHeight: 23, marginBottom: 8 }, meta: { color: C.muted, fontSize: 11, lineHeight: 17, marginTop: 5 }, read: { color: C.muted, fontSize: 10, fontWeight: '800', letterSpacing: 1.2, marginTop: 14 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }, muted: { color: C.muted, fontSize: 14 }, empty: { paddingVertical: 30 }, emptyTitle: { color: C.ink, fontFamily: 'Georgia', fontSize: 22 }, emptyText: { color: C.muted, paddingVertical: 18, lineHeight: 24 }, error: { color: C.error, lineHeight: 23, marginBottom: 12 },
  article: { paddingHorizontal: 22, paddingTop: 21, paddingBottom: 46 }, cover: { width: '100%', height: 218, marginBottom: 23, backgroundColor: C.panel }, articleTitle: { color: C.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 35, lineHeight: 41, marginBottom: 13 }, dek: { color: C.muted, fontFamily: 'Georgia', fontSize: 19, lineHeight: 28, marginBottom: 13 }, rule: { borderBottomWidth: 1, borderBottomColor: C.line, marginVertical: 20 },
  prose: { paddingTop: 2 }, paragraph: { color: C.reading, fontSize: 17, lineHeight: 28, marginBottom: 19 }, articleHeading: { color: C.ink, fontFamily: 'Georgia', fontSize: 26, lineHeight: 33, fontWeight: '700', marginTop: 9, marginBottom: 14 }, articleSubheading: { fontSize: 21, lineHeight: 28 }, quote: { color: C.reading, fontFamily: 'Georgia', fontSize: 19, lineHeight: 29, borderLeftWidth: 2, borderLeftColor: C.muted, paddingLeft: 15, marginBottom: 19 }, listBlock: { marginBottom: 8 }, listItem: { flexDirection: 'row', alignItems: 'flex-start', paddingLeft: 3 }, bullet: { width: 24, color: C.muted, fontSize: 17, lineHeight: 28 }, code: { color: C.reading, backgroundColor: C.panel, padding: 14, fontFamily: 'Menlo', fontSize: 13, lineHeight: 20, marginBottom: 18 }, articleImage: { width: '100%', height: 220, marginBottom: 20, backgroundColor: C.panel }, inlineLink: { color: C.muted, textDecorationLine: 'underline' }, returnButton: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 18, paddingVertical: 22 },
  pageTitle: { color: C.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 34, lineHeight: 40, marginTop: 24, marginBottom: 16 }, searchInput: { minHeight: 49, borderWidth: 1, borderColor: C.line, color: C.ink, paddingHorizontal: 14, fontSize: 15, backgroundColor: C.panel, marginBottom: 10 },
  tagStrip: { flexGrow: 0, marginVertical: 5 }, tagContent: { paddingRight: 8 }, tagChip: { borderWidth: 1, borderColor: C.line, borderRadius: 18, paddingHorizontal: 13, paddingVertical: 8, marginRight: 7 }, tagChipActive: { backgroundColor: C.muted, borderColor: C.muted }, tagText: { color: C.muted, fontSize: 11 }, tagTextActive: { color: C.bg, fontWeight: '700' },
  engagementRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: 13 }, engagementStat: { color: C.muted, fontSize: 11, marginRight: 13, marginVertical: 5 },
  reactionActions: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 3 }, reactionButton: { flex: 1, minHeight: 76, borderWidth: 1, borderColor: C.line, flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 3 }, reactionButtonLabel: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.6 }, reactionButtonCount: { color: C.ink, fontSize: 16, fontWeight: '700', lineHeight: 19 }, reactionSelected: { backgroundColor: C.muted, borderColor: C.muted }, reactionSelectedText: { color: C.bg },
  comment: { borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 15 }, commentHeader: { flexDirection: 'row', alignItems: 'center' }, commentAvatar: { width: 34, height: 34, borderRadius: 17, marginRight: 10 }, commentAvatarPlaceholder: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.panel, marginRight: 10 }, commentAuthor: { color: C.ink, fontWeight: '700', fontSize: 13 }, commentText: { color: C.reading, fontSize: 15, lineHeight: 22, marginTop: 10 }, outbound: { paddingVertical: 17, alignItems: 'center', backgroundColor: C.panel, marginTop: 14 },
  commentComposer: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 16, paddingTop: 17 }, fieldLabel: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.2, marginBottom: 9 }, commentInput: { minHeight: 92, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, color: C.ink, padding: 12, textAlignVertical: 'top', fontSize: 15, marginBottom: 10 }, disabledInput: { opacity: 0.7 },
  promotion: { marginTop: 22, padding: 19, borderRadius: 12, backgroundColor: C.panel }, promoTitle: { color: C.ink, fontFamily: 'Georgia', fontSize: 22, lineHeight: 27, fontWeight: '700' }, promoDescription: { color: C.muted, fontSize: 13, lineHeight: 19, marginVertical: 9 },
  accountCard: { backgroundColor: C.panel, borderRadius: 14, padding: 20, marginTop: 8 }, accountAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: C.panelLight, alignItems: 'center', justifyContent: 'center', marginBottom: 15 }, accountProfileAvatar: { width: 58, height: 58, borderRadius: 29, backgroundColor: C.panelLight, marginBottom: 15 }, accountProfileName: { color: C.ink, fontFamily: 'Georgia', fontSize: 24, lineHeight: 30, fontWeight: '700' }, accountDid: { color: C.muted, fontSize: 10, marginTop: 1, marginBottom: 12 }, accountIdentityDetails: { borderTopWidth: 1, borderTopColor: C.line, marginTop: 14, paddingTop: 13 }, accountIdentityLabel: { color: C.muted, fontSize: 9, fontWeight: '800', letterSpacing: 1.1, marginBottom: 4 }, accountIdentityValue: { color: C.ink, fontSize: 12, lineHeight: 17, marginBottom: 11 }, accountDescription: { color: C.muted, fontSize: 14, lineHeight: 21, marginBottom: 15 }, profileLink: { alignSelf: 'flex-start', borderWidth: 1, borderColor: C.line, paddingHorizontal: 12, paddingVertical: 10, marginTop: 5 }, accountSyncing: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 15 }, accountSavedRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, accountSavedCopy: { flex: 1 }, accountRecordDate: { color: C.muted, fontSize: 10, marginLeft: 94, marginTop: -6, marginBottom: 8 }, viewedExpandButton: { minHeight: 43, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14, marginTop: 6, marginBottom: 16, borderWidth: 1, borderColor: C.line, borderRadius: 22 }, accountRemoveButton: { minHeight: 36, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: C.line }, blockedAccountRow: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: C.line, paddingVertical: 13 }, primaryButton: { minHeight: 48, borderRadius: 8, backgroundColor: C.muted, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 15 }, primaryButtonText: { color: C.bg, fontSize: 11, fontWeight: '900', letterSpacing: 1 }, disabledButton: { opacity: 0.5 }, secondaryButton: { minHeight: 44, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', marginTop: 18 }, privacyNote: { color: C.muted, fontSize: 11, textAlign: 'center', marginTop: 15, lineHeight: 16 },
  authorRow: { minHeight: 83, borderBottomWidth: 1, borderBottomColor: C.line, flexDirection: 'row', alignItems: 'center', paddingVertical: 13 }, avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.panel }, avatarPlaceholder: { width: 48, height: 48, borderRadius: 24, backgroundColor: C.panelLight, alignItems: 'center', justifyContent: 'center' }, avatarInitial: { color: C.muted, fontFamily: 'Georgia', fontSize: 22 }, authorCopy: { flex: 1, paddingLeft: 13 }, authorName: { color: C.ink, fontFamily: 'Georgia', fontSize: 19, fontWeight: '700' }, chevron: { color: C.muted, fontSize: 26, paddingHorizontal: 5 }, handle: { color: C.muted, marginTop: -10, marginBottom: 14, fontSize: 13 }, backLink: { marginTop: 24, marginBottom: 12 },
  footer: { marginTop: 25, backgroundColor: C.panel, padding: 18 }, footerBrand: { color: C.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 19 }, footerText: { color: C.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  tabBar: { minHeight: 60, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.bg, flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' }, tabButton: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 7 }, tabIcon: { color: C.muted, fontSize: 21, lineHeight: 23 }, tabProfileImage: { width: 23, height: 23, borderRadius: 12, borderWidth: 1, borderColor: C.line }, tabProfileImageActive: { borderColor: C.ink, borderWidth: 2 }, tabLabel: { color: C.muted, fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginTop: 2 }, tabActive: { color: C.ink },
});
