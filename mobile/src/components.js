import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Linking, PanResponder, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { WebView } from 'react-native-webview';
import { C, styles } from './theme';
import { formatDate, storyAuthor } from './utils';
import { getCachedUri } from './imageCache';
import { imageUrlForPreset, cdnBlobImageUrl } from './imageUrls';
import { registerImageUrl } from './developer';

export function SkeletonImage({ source, imagePreset, style, ...props }) {
  const uri = source?.uri;
  const optimizedUri = imageUrlForPreset(uri, imagePreset);
  const [resolved, setResolved] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const pulse = useRef(new Animated.Value(0.4)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    setResolved(null);
    setLoaded(false);
    setFailed(false);
    fade.setValue(0);
    if (!optimizedUri) return undefined;
    getCachedUri(optimizedUri).then((local) => { if (active) setResolved(local || optimizedUri); });
    return () => { active = false; };
  }, [optimizedUri, fade]);

  useEffect(() => {
    if (loaded || failed) return undefined;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [loaded, failed, pulse]);

  return <View style={[style, { overflow: 'hidden', backgroundColor: C.panelLight }]}>
    {!loaded && <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: C.panelLight, opacity: failed ? 0.6 : pulse }]} />}
    {!failed && !!resolved && <Animated.Image
      {...props}
      source={{ uri: resolved }}
      style={[StyleSheet.absoluteFill, { opacity: fade }]}
      onLoad={() => {
        setLoaded(true);
        Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      }}
      onError={() => {
        if (resolved !== optimizedUri && resolved !== uri) setResolved(optimizedUri);
        else if (optimizedUri !== uri && resolved !== uri) setResolved(uri);
        else setFailed(true);
      }}
    />}
  </View>;
}

export function InlineText({ text, style }) {
  return <Text style={style}>{text}</Text>;
}

function ArticleEmbed({ data }) {
  let embed;
  try {
    embed = typeof data === 'string' ? JSON.parse(decodeURIComponent(data)) : data;
  } catch {
    return null;
  }
  if (!embed || typeof embed !== 'object') return null;
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

function FacetedText({ text, facets = [], style }) {
  const characters = Array.from(text);
  const byteOffsets = [0];
  characters.forEach((character) => {
    const codePoint = character.codePointAt(0);
    byteOffsets.push(byteOffsets[byteOffsets.length - 1] + (codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4));
  });
  const ranges = facets.flatMap((facet) => {
    const start = facet?.index?.byteStart;
    const end = facet?.index?.byteEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) return [];
    const features = Array.isArray(facet.features) ? facet.features : [];
    return [{ start, end, features }];
  });
  if (!ranges.length) return <Text style={style}>{text}</Text>;

  const boundaries = [...new Set([0, byteOffsets[byteOffsets.length - 1], ...ranges.flatMap(({ start, end }) => [start, end])])]
    .filter((offset) => offset >= 0 && offset <= byteOffsets[byteOffsets.length - 1])
    .sort((a, b) => a - b);
  const segments = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = boundaries[index + 1];
    const startIndex = byteOffsets.indexOf(start);
    const endIndex = byteOffsets.indexOf(end);
    if (startIndex < 0 || endIndex < 0 || endIndex <= startIndex) continue;
    const active = ranges.filter((range) => range.start <= start && range.end >= end);
    const features = active.flatMap((range) => range.features);
    const link = features.find((feature) => typeof feature?.uri === 'string' && /^https?:\/\//i.test(feature.uri));
    const types = features.map((feature) => feature?.$type || '');
    segments.push({
      text: characters.slice(startIndex, endIndex).join(''),
      link: link?.uri,
      strong: types.some((type) => type.endsWith('#strong') || type.endsWith('#bold')),
      em: types.some((type) => type.endsWith('#em') || type.endsWith('#italic')),
    });
  }
  return <Text style={style}>{segments.map((segment, index) => <Text
    key={index}
    style={[segment.link && styles.inlineLink, segment.strong && styles.markdownStrong, segment.em && styles.markdownEm]}
    onPress={segment.link ? () => Linking.openURL(segment.link) : undefined}
  >{segment.text}</Text>)}</Text>;
}

function documentImageUrl(image, fallbackDid) {
  const ref = image?.ref || image;
  const did = ref?.did || image?.did || fallbackDid;
  const cid = ref?.$link;
  if (typeof did === 'string' && /^did:[a-z0-9]+:[a-zA-Z0-9._:%-]+$/.test(did)
    && typeof cid === 'string' && cid.length > 0) {
    return cdnBlobImageUrl(did, cid, 'large');
  }
  const url = typeof image?.url === 'string' ? image.url : '';
  return /^https:\/\//i.test(url) ? imageUrlForPreset(url, 'large') : undefined;
}

function StructuredImage({ image, did, index }) {
  const uri = documentImageUrl(image?.image || image, did);
  if (!uri) return null;
  const ratio = image?.aspectRatio;
  const width = Number.isFinite(ratio?.width) && ratio.width > 0 ? ratio.width : 16;
  const height = Number.isFinite(ratio?.height) && ratio.height > 0 ? ratio.height : 9;
  const alt = typeof image?.alt === 'string' ? image.alt.trim() : typeof image?.title === 'string' ? image.title.trim() : '';
  return <View key={index}>
    <SkeletonImage source={{ uri }} imagePreset="large" accessibilityLabel={alt || 'Article image'} style={[styles.articleImage, { aspectRatio: width / height, height: undefined, marginBottom: 0 }]} resizeMode="cover" />
    {!!alt && <Text style={styles.imageAlt}>{alt}</Text>}
    {!!image?.caption && <Text style={styles.paragraph}>{image.caption}</Text>}
  </View>;
}

function ImageCarousel({ images, did }) {
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollRef = useRef(null);
  const validImages = images.filter((image) => documentImageUrl(image?.image || image, did));
  if (!validImages.length) return null;

  const selectImage = (index) => {
    setActiveIndex(index);
    scrollRef.current?.scrollTo({ x: width * index, animated: true });
  };
  return <View style={styles.imageCarousel} onLayout={(event) => setWidth(event.nativeEvent.layout.width)}>
    <ScrollView
      ref={scrollRef}
      horizontal
      pagingEnabled
      showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={(event) => {
        if (width > 0) setActiveIndex(Math.min(validImages.length - 1, Math.round(event.nativeEvent.contentOffset.x / width)));
      }}
      accessibilityLabel="Image gallery"
    >
      {validImages.map((image, index) => <View key={index} style={{ width }}>
        <StructuredImage image={image} did={did} index={index} />
      </View>)}
    </ScrollView>
    <View style={styles.imageCarouselFooter}>
      <View style={styles.imageCarouselDots}>
        {validImages.map((image, index) => <Pressable
          key={index}
          accessibilityRole="button"
          accessibilityLabel={`Show image ${index + 1} of ${validImages.length}${image.alt ? `: ${image.alt}` : ''}`}
          accessibilityState={{ selected: activeIndex === index }}
          onPress={() => selectImage(index)}
          style={styles.imageCarouselDotButton}
        ><View style={[styles.imageCarouselDot, activeIndex === index && styles.imageCarouselDotActive]} /></Pressable>)}
      </View>
      <Text style={styles.imageCarouselCount}>{activeIndex + 1} / {validImages.length}</Text>
    </View>
  </View>;
}

function StructuredArticleBody({ content, did }) {
  const contentItems = Array.isArray(content?.items)
    ? content.items.map((item) => ({
      block: typeof item === 'string'
        ? { $type: 'pub.leaflet.blocks.text', plaintext: item }
        : { ...item, $type: item?.$type || 'pub.leaflet.blocks.text' },
    }))
    : [];
  const pages = Array.isArray(content?.pages)
    ? content.pages
    : [{ blocks: Array.isArray(content?.blocks) ? content.blocks : contentItems }];
  const blocks = pages.flatMap((page) => Array.isArray(page?.blocks) ? page.blocks : []);
  return <View style={styles.prose}>{blocks.map((wrapper, index) => {
    const block = wrapper?.block || wrapper;
    const type = block?.$type || '';
    const text = typeof block?.plaintext === 'string' ? block.plaintext : typeof block?.text === 'string' ? block.text : typeof block?.title === 'string' ? block.title : '';
    if (type.endsWith('.heading') || type.endsWith('.title')) {
      return <InlineText key={index} text={text} style={block.level > 2 ? styles.articleSubheading : styles.articleHeading} />;
    }
    if (type.endsWith('.text')) return <FacetedText key={index} text={text} facets={block.facets} style={styles.paragraph} />;
    if (type.endsWith('.blockquote')) return <FacetedText key={index} text={text} facets={block.facets} style={styles.quote} />;
    if (type.endsWith('.image')) return <StructuredImage key={index} image={block} did={did} index={index} />;
    if (type.endsWith('.imageGallery')) {
      const images = Array.isArray(block.images) ? block.images : [];
      return <ImageCarousel key={index} images={images} did={did} />;
    }
    if (type.endsWith('.horizontalRule')) return <View key={index} style={styles.rule} />;
    if (type.endsWith('.iframe') || type.endsWith('.html')) return <ArticleEmbed key={index} data={{ src: block.url, srcdoc: block.html, title: block.title || block.alt, height: block.height }} />;
    if (text) return <InlineText key={index} text={text} style={styles.paragraph} />;
    return null;
  })}</View>;
}

export function ArticleBody({ record, uri }) {
  let content = record?.content || record?.textContent || record?.content?.textContent
    || (Array.isArray(record?.blocks) ? { blocks: record.blocks } : null);
  if (typeof content === 'string' && (record.contentFormat === 'leaflet' || record.format === 'leaflet')) {
    try {
      const parsed = JSON.parse(content);
      if (!parsed || typeof parsed !== 'object') throw new Error('Leaflet content must be a JSON object.');
      content = parsed;
    } catch {
      return <Text style={styles.error}>This story contains invalid structured content.</Text>;
    }
  }
  if (typeof content === 'string') {
    for (const match of content.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)) registerImageUrl(match[1]);
    return <Text style={styles.paragraph}>{content}</Text>;
  }
  const structured = content && typeof content === 'object'
    && (content.$type === 'pub.leaflet.content' || Array.isArray(content.pages) || Array.isArray(content.blocks) || Array.isArray(content.items));
  if (structured) {
    const did = uri?.match(/^at:\/\/(did:[^/]+)\//)?.[1];
    return <StructuredArticleBody content={content} did={did} />;
  }
  return <Text style={styles.error}>This story uses a content format the app cannot display.</Text>;
}

export function SectionBar({ title, detail }) {
  return <View style={styles.sectionBar}><Text style={styles.sectionTitle}>{title.toUpperCase()}</Text>{!!detail && <Text style={styles.sectionDetail}>{detail}</Text>}</View>;
}

export function StoryRow({ story, featured, compact, onPress }) {
  if (story.cover) registerImageUrl(story.cover);
  if (compact) return <Pressable accessibilityRole="button" accessibilityLabel={`Read ${story.title}`} onPress={onPress} style={styles.compactStory}>
    {story.cover ? <SkeletonImage source={{ uri: story.cover }} imagePreset="feed_thumb" style={styles.compactImage} resizeMode="cover" /> : <View style={styles.compactPlaceholder}><Text style={styles.placeholderMark}>C&amp;C</Text></View>}
    <View style={styles.compactCopy}><Text style={styles.compactTitle} numberOfLines={3}>{story.title}</Text><Text style={styles.compactSummary} numberOfLines={2}>{story.description || ''}</Text><Text style={styles.compactMeta} numberOfLines={1}>{formatDate(story.publishedAt)}  ·  {storyAuthor(story)}</Text></View>
  </Pressable>;
  return <Pressable accessibilityRole="button" accessibilityLabel={`Read ${story.title}`} onPress={onPress} style={styles.storyRow}>
    {!!story.cover && <SkeletonImage source={{ uri: story.cover }} imagePreset={featured ? 'wide_medium' : 'feed_medium'} style={featured ? styles.heroImage : styles.storyImage} resizeMode="cover" />}
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
    <Animated.View style={[styles.tabIconWrap, { transform: [{ scale: iconScale }] }]}>{imageUri ? <Image source={{ uri: imageUrlForPreset(imageUri, 'avatar_thumb') }} accessibilityLabel="Your profile photo" style={[styles.tabProfileImage, active && styles.tabProfileImageActive]} /> : <SymbolView name={icon} size={21} tintColor={active ? C.ink : C.muted} type={active ? 'hierarchical' : 'monochrome'} />}{badgeCount > 0 && <View style={styles.notificationTabBadge}><Text style={styles.notificationTabBadgeText}>{badgeCount > 99 ? '99+' : badgeCount}</Text></View>}</Animated.View>
    <Animated.Text style={[styles.tabLabel, active && styles.tabActive, { opacity: labelOpacity, height: labelHeight }]}>{label}</Animated.Text>
  </Pressable>;
}
const SWIPE_ACTION_WIDTH = 96;
const SWIPE_OPEN_OFFSET = 44;
const SWIPE_DELETE_OFFSET = 150;

export function SwipeableDeleteRow({ children, onDelete, accessibilityLabel = 'Remove' }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const resting = useRef(0);
  const [open, setOpen] = useState(false);

  const settle = (toValue, isOpen) => {
    resting.current = toValue;
    setOpen(isOpen);
    Animated.spring(translateX, { toValue, useNativeDriver: true, bounciness: 0, speed: 20 }).start();
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;
  // PanResponder is created once, so props it touches must go through refs —
  // otherwise onDelete stays bound to the story from the first render and a
  // swipe removes the wrong row after the list reorders.
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  const isHorizontalSwipe = (_, g) => Math.abs(g.dx) > 8 && Math.abs(g.dx) > Math.abs(g.dy) * 1.2;
  const pan = useRef(PanResponder.create({
    // Capture phase: the row's own Pressable children (StoryRow) become the
    // responder on touch-down, which blocks the bubble-phase shouldSet below.
    // The capture handler runs before the child commits, so a horizontal swipe
    // steals the gesture and prevents the tap that was opening the story.
    onMoveShouldSetPanResponderCapture: isHorizontalSwipe,
    onMoveShouldSetPanResponder: isHorizontalSwipe,
    onPanResponderMove: (_, g) => {
      const next = Math.max(-SWIPE_DELETE_OFFSET - 60, Math.min(0, resting.current + g.dx));
      translateX.setValue(next);
    },
    onPanResponderRelease: (_, g) => {
      const at = resting.current + g.dx;
      if (at <= -SWIPE_DELETE_OFFSET || g.vx < -1.2) {
        Animated.timing(translateX, { toValue: -600, duration: 160, useNativeDriver: true }).start(() => onDeleteRef.current?.());
      } else if (at < -SWIPE_OPEN_OFFSET || g.vx < -0.5) {
        settleRef.current(-SWIPE_ACTION_WIDTH, true);
      } else {
        settleRef.current(0, false);
      }
    },
    onPanResponderTerminate: () => settleRef.current(resting.current, resting.current !== 0),
    onPanResponderTerminationRequest: () => true,
    onShouldBlockNativeResponder: () => false,
  })).current;

  return <View style={styles.swipeableWrap}>
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onDelete} style={styles.swipeDeleteAction}>
      <SymbolView name="trash" size={17} tintColor={C.bg} />
      <Text style={styles.swipeDeleteText}>REMOVE</Text>
    </Pressable>
    <Animated.View style={[styles.swipeableContent, { transform: [{ translateX }] }]} {...pan.panHandlers}>
      {children}
      {open && <Pressable accessibilityLabel="Close" onPress={() => settle(0, false)} style={StyleSheet.absoluteFill} />}
    </Animated.View>
  </View>;
}

// A single, non-wrapping row of tag chips. Chips are measured off-screen on
// first render; only as many as fit in the row are shown, and any remainder
// collapses into a "+N" chip that activates the first hidden tag.
const OVERFLOW_CHIP_WIDTH = 54;
const TAG_GAP = 7;

export function ArticleTagRow({ tags = [], followedTags = [], onPressTag }) {
  const [rowWidth, setRowWidth] = useState(0);
  const [measuredCount, setMeasuredCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const widths = useRef({});

  const isFollowed = (tag) => followedTags.some((followed) => followed.toLocaleLowerCase() === tag.toLocaleLowerCase());
  const chip = (tag, hidden = false) => (
    <Pressable
      key={hidden ? `measure-${tag}` : tag}
      accessibilityRole={hidden ? 'none' : 'button'}
      accessibilityLabel={hidden ? undefined : `${tag}${isFollowed(tag) ? ', followed' : ''}. Filter the archive by this tag`}
      disabled={hidden}
      onLayout={hidden ? (event) => {
        const key = tag.toLocaleLowerCase();
        if (!widths.current[key]) {
          widths.current[key] = event.nativeEvent.layout.width;
          setMeasuredCount((count) => count + 1);
        }
      } : undefined}
      onPress={hidden ? undefined : () => onPressTag?.(tag)}
      style={[styles.tagChip, styles.articleTagChip, isFollowed(tag) && styles.tagChipActive]}
    >
      <Text style={[styles.tagText, isFollowed(tag) && styles.tagTextActive]}>{tag}</Text>
    </Pressable>
  );

  let visibleCount = tags.length;
  if (rowWidth > 0 && measuredCount >= tags.length) {
    let used = 0;
    for (let index = 0; index < tags.length; index += 1) {
      const chipWidth = widths.current[tags[index].toLocaleLowerCase()] || 0;
      const remaining = tags.length - index - 1;
      const reserve = remaining > 0 ? OVERFLOW_CHIP_WIDTH + TAG_GAP : 0;
      if (used + chipWidth + reserve > rowWidth) { visibleCount = index; break; }
      used += chipWidth + TAG_GAP;
    }
  } else {
    visibleCount = 0;
  }
  const hiddenTags = expanded ? [] : tags.slice(visibleCount);
  const shownTags = expanded ? tags : tags.slice(0, visibleCount);

  return (
    <View style={[styles.articleTagRow, expanded && styles.articleTagRowExpanded]} onLayout={(event) => setRowWidth(event.nativeEvent.layout.width)}>
      {measuredCount < tags.length && (
        <View style={styles.articleTagMeasure} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {tags.map((tag) => chip(tag, true))}
        </View>
      )}
      {shownTags.map((tag) => chip(tag))}
      {hiddenTags.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Show ${hiddenTags.length} more ${hiddenTags.length === 1 ? 'tag' : 'tags'}: ${hiddenTags.join(', ')}`}
          onPress={() => setExpanded(true)}
          style={[styles.tagChip, styles.articleTagChip]}
        >
          <Text style={styles.tagText}>+{hiddenTags.length}</Text>
        </Pressable>
      )}
    </View>
  );
}
