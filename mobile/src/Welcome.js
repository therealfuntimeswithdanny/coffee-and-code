import React, { useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { C, styles } from './theme';
import { LegalSettings } from './legal';

export const WELCOME_KEY = 'coffee-and-code:welcomed:v1';

const tips = [
  {
    icon: 'person.crop.circle',
    title: 'Sign in for the best experience',
    body: 'Reading works without an account, but signing in with an AT Protocol account lets you like and comment, get notifications, and sync your saved stories across devices.',
  },
  {
    icon: 'bookmark',
    title: 'Save stories for later',
    body: 'Tap the bookmark on any story to read it later — even offline. Saved stories stay on this device and sync to your account when you sign in.',
  },
  {
    icon: 'network',
    title: 'Built on the AT Protocol',
    body: 'Your likes, saves, and comments are records in your own repository — portable across apps on the open network, never locked into Coffee & Code.',
  },
  {
    icon: 'bolt',
    title: 'Fast and decentralized',
    body: 'Coffee & Code is supercharged by Cloudflare’s global network for fast loading wherever you are. Your links, saves, and comments are stored in your own repository on an open network that works with hundreds of other apps.',
  },
  {
    icon: 'chevron.left.forwardslash.chevron.right',
    title: 'Hackable and open source',
    body: 'Every part of Coffee & Code can be self hosted, from the API to the CDN! Everything is open source and available for you to modify found on Github.',
  }
];

export default function Welcome({ onDone }) {
  const [agreed, setAgreed] = useState(false);
  const [legalDoc, setLegalDoc] = useState(null);

  if (legalDoc) return <View style={styles.welcomeScreen}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" onPress={() => setLegalDoc(null)} style={styles.backLink}>
        <Text style={styles.action}>‹  Back to Welcome</Text>
      </Pressable>
      <View style={styles.settingsCard}>
        <LegalSettings document={legalDoc} />
      </View>
    </ScrollView>
  </View>;

  return <View style={styles.welcomeScreen}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.launchTitle}>Coffee & Code</Text>
      <Text style={styles.launchSubtitle}>Thank you for downloading our mobile App!</Text>

      <View style={styles.rule} />
      <Text style={styles.welcomeHeading}>Welcome</Text>
      <Text style={styles.accountDescription}>
        Before you start reading, please review and agree to our Privacy Policy and Terms of Service.
        You can read them any time under Account → Settings → Legal.
      </Text>
      <View style={styles.settingsCard}>
        <Pressable accessibilityRole="button" onPress={() => setLegalDoc('privacy')} style={styles.settingsRow}>
          <View style={styles.settingsIcon}><SymbolView name="hand.raised.slash" size={17} tintColor={C.muted} /></View>
          <View style={styles.settingsCopy}><Text style={styles.authorName}>Privacy Policy</Text><Text style={styles.meta}>Read in app</Text></View>
          <SymbolView name="chevron.right" size={15} tintColor={C.muted} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setLegalDoc('terms')} style={styles.settingsRow}>
          <View style={styles.settingsIcon}><SymbolView name="doc.text" size={17} tintColor={C.muted} /></View>
          <View style={styles.settingsCopy}><Text style={styles.authorName}>Terms of Service</Text><Text style={styles.meta}>Read in app</Text></View>
          <SymbolView name="chevron.right" size={15} tintColor={C.muted} />
        </Pressable>
      </View>

      <Text style={styles.welcomeHeading}>Tips & tricks</Text>
      {tips.map((tip) => <View key={tip.icon} style={styles.welcomeTip}>
        <View style={styles.settingsIcon}><SymbolView name={tip.icon} size={17} tintColor={C.muted} /></View>
        <View style={styles.settingsCopy}><Text style={styles.authorName}>{tip.title}</Text><Text style={styles.accountDescription}>{tip.body}</Text></View>
      </View>)}

      <Text style={styles.welcomeHeading}>Feedback</Text>
      <Text style={styles.accountDescription}>
        Spotted a bug or have an idea? Email us or open an issue on the developer site
      </Text>
      <View style={styles.settingsCard}>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL('mailto:hello@coffeencode.cc')} style={styles.settingsRow}>
          <View style={styles.settingsIcon}><SymbolView name="envelope" size={17} tintColor={C.muted} /></View>
          <View style={styles.settingsCopy}><Text style={styles.authorName}>Email us</Text><Text style={styles.meta}>hello@coffeencode.cc</Text></View>
          <SymbolView name="arrow.up.right" size={15} tintColor={C.muted} />
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://developer.coffeencode.cc')} style={styles.settingsRow}>
          <View style={styles.settingsIcon}><SymbolView name="hammer" size={17} tintColor={C.muted} /></View>
          <View style={styles.settingsCopy}><Text style={styles.authorName}>Developer site</Text><Text style={styles.meta}>developer.coffeencode.cc</Text></View>
          <SymbolView name="arrow.up.right" size={15} tintColor={C.muted} />
        </Pressable>
      </View>
    </ScrollView>

    <View style={styles.welcomeFooter}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed((value) => !value)} style={styles.welcomeAgreeRow}>
        <View style={[styles.welcomeCheckbox, agreed && styles.welcomeCheckboxChecked]}>
          {agreed && <SymbolView name="checkmark" size={13} tintColor={C.bg} />}
        </View>
        <Text style={styles.welcomeAgreeText}>I agree to the <Text style={styles.inlineLink} onPress={() => setLegalDoc('terms')}>Terms of Service</Text> and <Text style={styles.inlineLink} onPress={() => setLegalDoc('privacy')}>Privacy Policy</Text></Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!agreed} onPress={onDone} style={[styles.primaryButton, !agreed && styles.disabledButton]}>
        <Text style={styles.primaryButtonText}>{agreed ? 'START READING' : 'AGREE TO CONTINUE'}</Text>
      </Pressable>
    </View>
  </View>;
}
