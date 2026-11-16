// Android has no SF Symbols. Render the closest Font Awesome 6 Free solid
// glyph instead — the same font the web worker serves (cdnjs 6.7.2), bundled
// as assets/fonts/fa-solid-900.ttf so it works offline.
import React, { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import * as Font from 'expo-font';

const FONT_FAMILY = 'FontAwesome6Solid';
let fontLoaded = false;
const fontPromise = Font.loadAsync({
  [FONT_FAMILY]: require('../assets/fonts/fa-solid-900.ttf'),
}).then(() => { fontLoaded = true; }).catch(() => {});

// SF Symbol name -> Font Awesome codepoint.
const GLYPHS = {
  'arrow.down': '',
  'arrow.triangle.2.circlepath': '',
  'arrow.up': '',
  'arrow.up.right': '',
  'bag': '',
  'bell': '',
  'bell.fill': '',
  'bolt': '',
  'book': '',
  'bookmark': '',
  'bookmark.fill': '',
  'bubble.left': '',
  'bubble.left.and.bubble.right.fill': '',
  'checkmark': '',
  'chevron.down': '',
  'chevron.left': '',
  'chevron.left.forwardslash.chevron.right': '',
  'chevron.right': '',
  'chevron.up': '',
  'doc.text': '',
  'envelope': '',
  'eye': '',
  'hammer': '',
  'hand.raised': '',
  'hand.raised.slash': '',
  'hand.thumbsdown': '',
  'hand.thumbsup': '',
  'heart': '',
  'heart.fill': '',
  'info.circle': '',
  'lock.open': '',
  'magnifyingglass': '',
  'network': '',
  'newspaper.fill': '',
  'person.badge.plus': '',
  'person.crop.circle': '',
  'person.crop.circle.fill': '',
  'person.fill': '',
  'photo': '',
  'sparkles': '',
  'tag': '',
  'text.bubble': '',
  'trash': '',
  'tray.full': '',
  'viewport': '',
  'waveform.path.ecg': '',
};

// SymbolView-compatible API: name, size, tintColor, style. `type`, `weight`
// and other SF-specific props are accepted and ignored on Android.
export default function SymbolView({ name, size = 16, tintColor = '#ffffff', style }) {
  const [ready, setReady] = useState(fontLoaded);
  useEffect(() => {
    if (!ready) fontPromise.then(() => setReady(true));
  }, [ready]);
  const glyph = GLYPHS[name];
  if (!ready || !glyph) {
    return <View style={[{ width: size, height: size }, style]} />;
  }
  return (
    <Text
      style={[
        {
          fontFamily: FONT_FAMILY,
          fontSize: size,
          color: tintColor,
          width: size,
          height: size,
          lineHeight: size,
          textAlign: 'center',
        },
        style,
      ]}
    >
      {glyph}
    </Text>
  );
}
