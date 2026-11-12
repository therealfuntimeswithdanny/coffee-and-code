import React from 'react';
import { Animated, Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { WebView } from 'react-native-webview';
import { C, styles } from './theme';
import { formatDate, storyAuthor } from './utils';

export function InlineText({ text, style }) {
  const parts = [];
  const pattern = /(\[[^\]]+\]\(https?:\/\/[^)]+\)|https?:\/\/[^\s)]+|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    const token = match[0];
    const markdownLink = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if (markdownLink) parts.push({ text: markdownLink[1], url: markdownLink[2] });
    else if (/^https?:\/\//.test(token)) parts.push({ text: token, url: token });
    else if (/^\*\*/.test(token) || /^__/.test(token)) parts.push({ text: token.slice(2, -2), format: 'strong' });
    else if (/^~~/.test(token)) parts.push({ text: token.slice(2, -2), format: 'strike' });
    else if (/^`/.test(token)) parts.push({ text: token.slice(1, -1), format: 'code' });
    else parts.push({ text: token.slice(1, -1), format: 'em' });
    cursor = pattern.lastIndex;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return <Text style={style}>{parts.map((part, i) => part.url
    ? <Text key={i} style={styles.inlineLink} onPress={() => Linking.openURL(part.url)}>{part.text}</Text>
    : <Text key={i} style={part.format === 'strong' ? styles.markdownStrong : part.format === 'em' ? styles.markdownEm : part.format === 'strike' ? styles.markdownStrike : part.format === 'code' ? styles.markdownInlineCode : undefined}>{part.text}</Text>)}</Text>;
}

function ArticleEmbed({ data }) {
  let embed;
  try {
    embed = JSON.parse(decodeURIComponent(data));
  } catch {
    return null;
  }
  const title = typeof embed.title === 'string' && embed.title.trim() ? embed.title.trim() : 'Embedded content';
  const height = Number.isInteger(embed.height) ? Math.max(180, Math.min(900, embed.height)) : 250;
  const safeSrc = typeof embed.src === 'string' && /^https:\/\//i.test(embed.src) ? embed.src : '';
  const srcdoc = typeof embed.srcdoc === 'string' ? embed.srcdoc : '';
  if (!safeSrc && !srcdoc) return null;
  const escapeAttribute = (value) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  const iframe = `<iframe title="${escapeAttribute(title)}"${safeSrc ? ` src="${escapeAttribute(safeSrc)}"` : ''}${srcdoc ? ` srcdoc="${escapeAttribute(srcdoc)}"` : ''} sandbox="allow-scripts allow-forms allow-presentation" referrerpolicy="no-referrer" allow="fullscreen; picture-in-picture; encrypted-media" allowfullscreen style="width:100%;height:${height}px;border:0"></iframe>`;
  const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"></head><body style="margin:0;background:transparent;overflow:hidden">${iframe}</body></html>`;
  return <View style={styles.embedFrame}><WebView source={{ html, baseUrl: 'https://coffeencode.cc' }} style={{ height, backgroundColor: 'transparent' }} javaScriptEnabled domStorageEnabled={false} originWhitelist={['https://*']} mixedContentMode="never" allowFileAccess={false} allowUniversalAccessFromFileURLs={false} setSupportMultipleWindows={false} allowsInlineMediaPlayback mediaPlaybackRequiresUserAction /></View>;
}

export function ArticleBody({ markdown }) {
  const normalized = markdown.replace(/^---[\s\S]*?---\s*/, '').replace(/^# .+\n+/, '');
  const lines = normalized.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length;) {
    if (!lines[index].trim()) { index += 1; continue; }
    if (/^\s*:::cc-embed\s+/.test(lines[index])) { blocks.push(lines[index++].trim()); continue; }
    if (/^\s*```/.test(lines[index])) {
      const code = [lines[index++]];
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) code.push(lines[index++]);
      blocks.push(code.join('\n'));
      continue;
    }
    if (/^\s*>/.test(lines[index])) {
      const quote = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) quote.push(lines[index++]);
      blocks.push(quote.join('\n'));
      continue;
    }
    if (/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(lines[index])) {
      const list = [];
      while (index < lines.length && (/^\s*(?:[-*+]\s|\d+[.)]\s)/.test(lines[index]) || /^\s{2,}\S/.test(lines[index]))) list.push(lines[index++]);
      blocks.push(list.join('\n'));
      continue;
    }
    if (/^\s*#{1,6}\s|^\s*([-*_])\1\1+\s*$|^\s*!\[[^\]]*\]\(https?:\/\/[^)]+\)\s*$/.test(lines[index])) {
      blocks.push(lines[index++].trim());
      continue;
    }
    const paragraph = [];
    while (index < lines.length && lines[index].trim() && !/^\s*(?:```|>|#{1,6}\s|[-*+]\s|\d+[.)]\s|([-*_])\1\1+\s*$|!\[[^\]]*\]\(https?:\/\/[^)]+\)\s*$)/.test(lines[index])) paragraph.push(lines[index++]);
    if (paragraph.length) blocks.push(paragraph.join('\n').trim());
  }
  return <View style={styles.prose}>{blocks.map((block, index) => {
    const embed = block.match(/^:::cc-embed\s+(.+)$/);
    if (embed) return <ArticleEmbed key={index} data={embed[1]} />;
    if (/^\s*([-*_])\1\1+\s*$/.test(block)) return <View key={index} style={styles.rule} />;
    const heading = block.match(/^(#{1,6})\s+(.+)$/s);
    if (heading) return <InlineText key={index} text={heading[2]} style={[styles.articleHeading, heading[1].length > 2 && styles.articleSubheading]} />;
    if (/^>\s?/.test(block)) return <InlineText key={index} text={block.replace(/^\s*>\s?/gm, '').replace(/\n/g, ' ')} style={styles.quote} />;
    if (/^\s*(?:[-*+]\s|\d+[.)]\s)/m.test(block)) {
      const items = block.split('\n').filter(Boolean);
      return <View key={index} style={styles.listBlock}>{items.map((item, itemIndex) => {
        const content = item.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '');
        const marker = item.match(/^\s*(\d+)[.)]\s+/);
        const nested = /^\s{2,}/.test(item);
        return <View key={itemIndex} style={[styles.listItem, nested && styles.nestedListItem]}><Text style={styles.bullet}>{marker?.[1] || '•'}</Text><InlineText text={content} style={styles.paragraph} /></View>;
      })}</View>;
    }
    if (/^```/.test(block)) return <Text key={index} style={styles.code}>{block.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')}</Text>;
    const image = block.match(/^!\[([^\]]*)\]\((https?:\/\/[^)]+)\)$/);
    if (image) return <Image key={index} source={{ uri: image[2] }} accessibilityLabel={image[1]} style={styles.articleImage} resizeMode="cover" />;
    const tableRows = block.split('\n').filter((row) => /^\s*\|/.test(row));
    if (tableRows.length >= 2 && /^\s*\|?\s*:?-{3,}/.test(tableRows[1])) {
      const rows = tableRows.filter((row) => !/^\s*\|?\s*:?-{3,}/.test(row)).map((row) => row.replace(/^\s*\||\|\s*$/g, '').split('|').map((cell) => cell.trim()));
      return <ScrollView key={index} horizontal showsHorizontalScrollIndicator style={styles.tableScroll}><View>{rows.map((row, rowIndex) => <View key={rowIndex} style={[styles.tableRow, rowIndex === 0 && styles.tableHeaderRow]}>{row.map((cell, cellIndex) => <View key={cellIndex} style={styles.tableCell}><InlineText text={cell} style={[styles.tableCellText, rowIndex === 0 && styles.tableHeaderText]} /></View>)}</View>)}</View></ScrollView>;
    }
    return <InlineText key={index} text={block.replace(/\n/g, ' ')} style={styles.paragraph} />;
  })}</View>;
}

export function SectionBar({ title, detail }) {
  return <View style={styles.sectionBar}><Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>{!!detail && <Text style={styles.sectionDetail}>{detail}</Text>}</View>;
}

export function StoryRow({ story, featured, compact, onPress }) {
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

export function TabButton({ label, icon, active, onPress, imageUri, compactProgress, badgeCount = 0 }) {
  const iconScale = compactProgress?.interpolate({ inputRange: [0, 1], outputRange: [1, 0.84] }) || 1;
  const labelOpacity = compactProgress?.interpolate({ inputRange: [0, 0.55, 1], outputRange: [1, 0.2, 0] }) || 1;
  const labelHeight = compactProgress?.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) || 12;
  return <Pressable accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={onPress} style={styles.tabButton}>
    <Animated.View style={[styles.tabIconWrap, { transform: [{ scale: iconScale }] }]}>{imageUri ? <Image source={{ uri: imageUri }} accessibilityLabel="Your profile photo" style={[styles.tabProfileImage, active && styles.tabProfileImageActive]} /> : <SymbolView name={icon} size={21} tintColor={active ? C.ink : C.muted} type={active ? 'hierarchical' : 'monochrome'} />}{badgeCount > 0 && <View style={styles.notificationTabBadge}><Text style={styles.notificationTabBadgeText}>{badgeCount > 99 ? '99+' : badgeCount}</Text></View>}</Animated.View>
    <Animated.Text style={[styles.tabLabel, active && styles.tabActive, { opacity: labelOpacity, height: labelHeight }]}>{label}</Animated.Text>
  </Pressable>;
}
