import React, { useEffect, useState } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';
import SymbolView from './Icon';
import { C, styles } from './theme';
import { LegalSettings } from './legal';
import AuthCard from './AuthCard';

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

const signInReasons = [
  {
    icon: 'heart',
    title: 'Like, comment, and join the forum',
    body: 'React to stories, join the discussion, and post in the community forum',
  },
  {
    icon: 'bell',
    title: 'Get notified',
    body: 'Follow authors and tags, and get push notifications when they publish or when someone replies to you.',
  },
  {
    icon: 'arrow.triangle.2.circlepath',
    title: 'Sync across devices',
    body: 'Saved stories and reading history live in your own repository, so they follow you to any device or app.',
  },
  {
    icon: 'lock.open',
    title: 'Your data stays yours',
    body: 'Your data is yours, unlike big tech Coffee & Code is built on the ATProtocol meaning your data is portable and is not locked down to one app. ',
  },
];

export default function Welcome({ onDone, auth }) {
  const [agreed, setAgreed] = useState(false);
  const [legalDoc, setLegalDoc] = useState(null);
  const [step, setStep] = useState('legal');
  const [authView, setAuthView] = useState(null);

  // Signing in or creating an account lands on a confirmation screen.
  useEffect(() => {
    if (auth?.account) setStep('done');
  }, [auth?.account]);

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

  if (step === 'legal') return <View style={styles.welcomeScreen}>
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
    </ScrollView>

    <View style={styles.welcomeFooter}>
      <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: agreed }} onPress={() => setAgreed((value) => !value)} style={styles.welcomeAgreeRow}>
        <View style={[styles.welcomeCheckbox, agreed && styles.welcomeCheckboxChecked]}>
          {agreed && <SymbolView name="checkmark" size={13} tintColor={C.bg} />}
        </View>
        <Text style={styles.welcomeAgreeText}>I agree to the <Text style={styles.inlineLink} onPress={() => setLegalDoc('terms')}>Terms of Service</Text> and <Text style={styles.inlineLink} onPress={() => setLegalDoc('privacy')}>Privacy Policy</Text></Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={!agreed} onPress={() => setStep('tips')} style={[styles.primaryButton, !agreed && styles.disabledButton]}>
        <Text style={styles.primaryButtonText}>{agreed ? 'CONTINUE' : 'AGREE TO CONTINUE'}</Text>
      </Pressable>
    </View>
  </View>;

  if (step === 'tips') return <View style={styles.welcomeScreen}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" onPress={() => setStep('legal')} style={styles.backLink}>
        <Text style={styles.action}>‹  Back</Text>
      </Pressable>
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
      <Pressable accessibilityRole="button" onPress={() => setStep('signin')} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>CONTINUE</Text>
      </Pressable>
    </View>
  </View>;

  if (step === 'done') return <View style={styles.welcomeScreen}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.launchTitle}>Coffee & Code</Text>
      <View style={styles.rule} />
      <Text style={styles.welcomeHeading}>You're all good to go!</Text>
      <Text style={styles.accountDescription}>
        {auth?.account
          ? "You're signed in. Enjoy the full Coffee & Code — like, save, comment, and get notified about the stories and authors you follow."
          : "You may start reading! Signing in with an Account will add more fun features like saving stories, commenting, and getting notified about the stories and authors you follow."}
      </Text>
    </ScrollView>

    <View style={styles.welcomeFooter}>
      <Pressable accessibilityRole="button" onPress={onDone} style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>START READING</Text>
      </Pressable>
    </View>
  </View>;

  // step === 'signin'
  return <View style={styles.welcomeScreen}>
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Pressable accessibilityRole="button" onPress={() => setStep('tips')} style={styles.backLink}>
        <Text style={styles.action}>‹  Back</Text>
      </Pressable>
      <Text style={styles.welcomeHeading}>Why sign in?</Text>
      <Text style={styles.accountDescription}>
        Reading works without an account, this is the same account you use for Margin, Bluesky, Blacksy, Sprk, and many many more!
      </Text>
      {signInReasons.map((reason) => <View key={reason.icon} style={styles.welcomeTip}>
        <View style={styles.settingsIcon}><SymbolView name={reason.icon} size={17} tintColor={C.muted} /></View>
        <View style={styles.settingsCopy}><Text style={styles.authorName}>{reason.title}</Text><Text style={styles.accountDescription}>{reason.body}</Text></View>
      </View>)}
      {!!auth && (authView
        ? <>
            <AuthCard {...auth} view={authView} />
            <Pressable accessibilityRole="button" onPress={() => setAuthView(authView === 'signin' ? 'create' : 'signin')} style={styles.secondaryButton}>
              <Text style={styles.action}>{authView === 'signin' ? 'CREATE AN ACCOUNT INSTEAD' : 'I ALREADY HAVE AN ACCOUNT'}</Text>
            </Pressable>
          </>
        : <View style={styles.settingsCard}>
            <Pressable accessibilityRole="button" onPress={() => setAuthView('signin')} style={styles.settingsRow}>
              <View style={styles.settingsIcon}><SymbolView name="person.crop.circle" size={17} tintColor={C.muted} /></View>
              <View style={styles.settingsCopy}><Text style={styles.authorName}>Sign in</Text><Text style={styles.meta}>Use your existing AT Protocol account</Text></View>
              <SymbolView name="chevron.right" size={15} tintColor={C.muted} />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => setAuthView('create')} style={styles.settingsRow}>
              <View style={styles.settingsIcon}><SymbolView name="person.badge.plus" size={17} tintColor={C.muted} /></View>
              <View style={styles.settingsCopy}><Text style={styles.authorName}>Create account</Text><Text style={styles.meta}>Get a free account on the Coffee & Code PDS</Text></View>
              <SymbolView name="chevron.right" size={15} tintColor={C.muted} />
            </Pressable>
          </View>)}
    </ScrollView>

    <View style={styles.welcomeFooter}>
      <Pressable accessibilityRole="button" onPress={() => setStep('done')} style={styles.secondaryButton}>
        <Text style={styles.action}>CONTINUE WITHOUT AN ACCOUNT</Text>
      </Pressable>
    </View>
  </View>;
}
