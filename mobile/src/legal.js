import React, { useEffect, useState } from 'react';
import { Linking, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApiBase } from './developer';
import { styles } from './theme';

// Legal documents (privacy policy + terms of service) are served by the worker
// from src/legal.json. Cached on device so the settings page works offline.
const CACHE_KEY = 'legal-cache-v1';

export async function loadLegal() {
  try {
    const response = await fetch(`${getApiBase()}/legal`, { cache: 'no-store' });
    if (response.ok) {
      const data = await response.json();
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => {});
      return data;
    }
  } catch {
    // fall through to cached copy
  }
  try {
    const cached = await AsyncStorage.getItem(CACHE_KEY);
    if (cached) return JSON.parse(cached);
  } catch {}
  return null;
}

const LINK_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)/g;

/** Split paragraph text into [{ text, url? }] segments for [label](url) links. */
export function parseInlineLinks(text) {
  const segments = [];
  let lastIndex = 0;
  let match;
  LINK_PATTERN.lastIndex = 0;
  while ((match = LINK_PATTERN.exec(text))) {
    if (match.index > lastIndex) segments.push({ text: text.slice(lastIndex, match.index) });
    segments.push({ text: match[1], url: match[2] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) segments.push({ text: text.slice(lastIndex) });
  return segments;
}

function LegalText({ text }) {
  return <Text style={styles.accountDescription}>
    {parseInlineLinks(text).map((segment, index) => segment.url
      ? <Text key={index} accessibilityRole="link" style={styles.inlineLink} onPress={() => Linking.openURL(segment.url)}>{segment.text}</Text>
      : <Text key={index}>{segment.text}</Text>)}
  </Text>;
}

export function LegalDocument({ doc }) {
  return <>
    <Text style={styles.accountProfileName}>{doc.title}</Text>
    <Text style={styles.accountDescription}>Last updated: {doc.updated}</Text>
    {doc.sections.map((section, sectionIndex) => <View key={sectionIndex}>
      {!!section.heading && <Text style={[styles.accountProfileName, { fontSize: 15 }]}>{section.heading}</Text>}
      {section.blocks.map((block, blockIndex) => block.type === 'list'
        ? block.items.map((item, itemIndex) => <LegalText key={`${blockIndex}-${itemIndex}`} text={`•  ${item}`} />)
        : <LegalText key={blockIndex} text={block.text} />)}
    </View>)}
  </>;
}

/** Load legal documents once and render a single document by key ('terms' | 'privacy'),
 * or both stacked when no key is given. */
export function LegalSettings({ document }) {
  const [legal, setLegal] = useState(null);
  useEffect(() => {
    let cancelled = false;
    loadLegal().then((data) => { if (!cancelled && data) setLegal(data); });
    return () => { cancelled = true; };
  }, []);
  if (!legal) return <Text style={styles.accountDescription}>Loading…</Text>;
  if (document) return <LegalDocument doc={legal[document]} />;
  return <>
    <LegalDocument doc={legal.terms} />
    <View style={styles.rule} />
    <LegalDocument doc={legal.privacy} />
  </>;
}
