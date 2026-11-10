import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView,
  StatusBar, StyleSheet, Text, View, RefreshControl,
} from 'react-native';

const API = 'https://coffeencode.cc/api';
const COLORS = { bg: '#281914', panel: '#3b2a1d', ink: '#fff', muted: '#b2ac88', line: 'rgba(178,172,136,.42)' };

function formatDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function paragraphs(markdown = '') {
  return markdown
    .replace(/^---[\s\S]*?---\s*/, '')
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#{1,6}\s+/, '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\*(.*?)\*/g, '$1').replace(/`([^`]+)`/g, '$1').trim())
    .filter(Boolean);
}

export default function App() {
  const [feed, setFeed] = useState(null);
  const [selected, setSelected] = useState(null);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const loadFeed = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API}/home`);
      if (!response.ok) throw new Error('Coffee & Code is temporarily unavailable. Please try again.');
      setFeed(await response.json());
    } catch (e) {
      setError(e.message || 'Could not load stories. Check your connection and try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  async function openStory(story) {
    setSelected(story);
    setBody('');
    setError('');
    try {
      const response = await fetch(story.markdownUrl);
      if (!response.ok) throw new Error('This story could not be opened.');
      setBody(await response.text());
    } catch (e) {
      setError(e.message || 'This story could not be opened.');
    }
  }

  const stories = feed ? [feed.hero, ...(feed.latest || []), ...(feed.pinned || []), ...(feed.more || [])].filter(Boolean) : [];
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />
      <View style={styles.header}>
        {selected ? <Pressable accessibilityRole="button" onPress={() => { setSelected(null); setBody(''); setError(''); }}><Text style={styles.back}>‹  LATEST</Text></Pressable> : <View style={styles.headerLabel}><Text style={styles.kicker}>INDEPENDENT TECHNOLOGY JOURNALISM</Text></View>}
        <Text style={styles.brand}>Coffee & Code</Text>
        {selected ? <Text style={styles.headerSpacer} /> : <Pressable accessibilityRole="button" onPress={() => loadFeed(true)}><Text style={styles.refresh}>↻</Text></Pressable>}
      </View>
      {loading ? <View style={styles.center}><ActivityIndicator color={COLORS.muted} /><Text style={styles.muted}>Loading the latest stories…</Text></View> : selected ? (
        <ScrollView contentContainerStyle={styles.article}>
          {selected.cover ? <Image source={{ uri: selected.cover }} style={styles.cover} /> : null}
          <Text style={styles.kicker}>STORY</Text>
          <Text style={styles.title}>{selected.title}</Text>
          {!!selected.description && <Text style={styles.dek}>{selected.description}</Text>}
          <Text style={styles.meta}>{selected.author?.displayName || selected.author?.handle || 'Coffee & Code'}  ·  {formatDate(selected.publishedAt)}</Text>
          <View style={styles.rule} />
          {!body && !error ? <ActivityIndicator color={COLORS.muted} style={{ marginTop: 28 }} /> : null}
          {error ? <Text style={styles.error}>{error}</Text> : paragraphs(body).map((p, i) => <Text key={i} style={styles.paragraph}>{p}</Text>)}
          <Pressable onPress={() => setSelected(null)} style={styles.returnButton}><Text style={styles.returnText}>BACK TO LATEST STORIES</Text></Pressable>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadFeed(true)} tintColor={COLORS.muted} />}>
          <View style={styles.section}><Text style={styles.sectionText}>LATEST</Text><Text style={styles.count}>{feed?.totalAvailable ?? 0} STORIES</Text></View>
          {error ? <View style={styles.empty}><Text style={styles.error}>{error}</Text><Pressable onPress={() => loadFeed()}><Text style={styles.link}>TRY AGAIN</Text></Pressable></View> : stories.length === 0 ? <Text style={styles.emptyText}>No stories have been published yet. Please check back soon.</Text> : stories.map((story, index) => (
            <Pressable accessibilityRole="button" accessibilityLabel={`Read ${story.title}`} key={story.uri || `${story.title}-${index}`} onPress={() => openStory(story)} style={styles.story}>
              {index === 0 && story.cover ? <Image source={{ uri: story.cover }} style={styles.heroImage} /> : null}
              <Text style={styles.kicker}>{index === 0 ? 'MOST RECENT' : 'COFFEE & CODE'}</Text>
              <Text style={index === 0 ? styles.heroTitle : styles.storyTitle}>{story.title}</Text>
              {!!story.description && <Text numberOfLines={index === 0 ? 4 : 3} style={styles.summary}>{story.description}</Text>}
              <Text style={styles.meta}>{story.author?.displayName || story.author?.handle || 'Coffee & Code'}  ·  {formatDate(story.publishedAt)}</Text>
              <Text style={styles.read}>READ STORY  →</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg },
  header: { minHeight: 76, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: COLORS.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLabel: { width: 54 }, headerSpacer: { width: 54 },
  kicker: { color: COLORS.muted, fontSize: 10, fontWeight: '700', letterSpacing: 1.5, marginBottom: 8 },
  brand: { color: COLORS.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 24, letterSpacing: -1 },
  back: { color: COLORS.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1 }, refresh: { color: COLORS.muted, fontSize: 26, width: 32, textAlign: 'right' },
  list: { paddingHorizontal: 20, paddingBottom: 36 },
  section: { borderTopWidth: 3, borderTopColor: COLORS.ink, borderBottomWidth: 1, borderBottomColor: COLORS.line, marginTop: 22, marginBottom: 4, paddingVertical: 11, flexDirection: 'row', justifyContent: 'space-between' },
  sectionText: { color: COLORS.ink, fontWeight: '800', fontSize: 11, letterSpacing: 1.5 }, count: { color: COLORS.muted, fontSize: 10, letterSpacing: 1 },
  story: { borderBottomWidth: 1, borderBottomColor: COLORS.line, paddingVertical: 22 }, heroImage: { width: '100%', height: 220, marginBottom: 20, backgroundColor: COLORS.panel },
  heroTitle: { color: COLORS.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 34, lineHeight: 39, marginBottom: 10 },
  storyTitle: { color: COLORS.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 23, lineHeight: 29, marginBottom: 8 },
  summary: { color: COLORS.muted, fontSize: 16, lineHeight: 24, marginBottom: 12 }, meta: { color: COLORS.muted, fontSize: 12, lineHeight: 18, marginTop: 5 }, read: { color: COLORS.muted, fontSize: 11, fontWeight: '800', letterSpacing: 1.2, marginTop: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }, muted: { color: COLORS.muted, fontSize: 14 }, empty: { paddingVertical: 30 }, emptyText: { color: COLORS.muted, paddingVertical: 30, lineHeight: 24 }, error: { color: '#f1b9a8', lineHeight: 23, marginBottom: 12 }, link: { color: COLORS.muted, fontWeight: '700', marginTop: 8 },
  article: { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 50 }, cover: { width: '100%', height: 220, marginBottom: 25, backgroundColor: COLORS.panel },
  title: { color: COLORS.ink, fontFamily: 'Georgia', fontWeight: '700', fontSize: 36, lineHeight: 41, marginBottom: 14 }, dek: { color: COLORS.muted, fontFamily: 'Georgia', fontSize: 20, lineHeight: 29, marginBottom: 18 }, rule: { borderBottomWidth: 1, borderBottomColor: COLORS.line, marginVertical: 20 },
  paragraph: { color: '#f1eadc', fontSize: 18, lineHeight: 30, marginBottom: 20 }, returnButton: { borderTopWidth: 1, borderTopColor: COLORS.line, marginTop: 20, paddingVertical: 22 }, returnText: { color: COLORS.muted, letterSpacing: 1, fontSize: 11, fontWeight: '700' },
});
