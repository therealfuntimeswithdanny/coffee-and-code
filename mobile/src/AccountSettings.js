import React, { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DevSettings, Image, Linking, Pressable, ScrollView, Share, Text, TextInput, View } from 'react-native';
import { WELCOME_KEY, FEEDBACK_URL } from './Welcome';
import SymbolView from './Icon';
import { C, styles } from './theme';
import { formatDate } from './utils';
import {
  clearImageCacheRegistry, clearLogs, clearPostCache, DEFAULT_API_BASE, formatBytes as devFormatBytes,
  getApiBase, getLogEntries, getLogStats, getLogText, imageCacheStats, postCacheStats, refreshImageCache,
  setApiBase,
} from './developer';
import { cacheStats as imageDiskStats, clearImageCache } from './imageCache';
import { LegalSettings } from './legal';

export const accountSettingsPages = [
  { id: 'account', title: 'Manage Identity', subtitle: 'Manage your identity and perform destructive actions', icon: 'person.crop.circle' },
  { id: 'reading', title: 'Public activity', subtitle: 'View and delete public records. Likes, views, saves, etc.', icon: 'book' },
  { id: 'follows', title: 'Following', subtitle: 'Tags you follow for new-story notifications', icon: 'tag' },
  { id: 'blocked', title: 'Moderation', subtitle: 'Manage your blocked accounts and moderation preferences', icon: 'hand.raised' },
  { id: 'ads', title: 'Ads and Marketing', subtitle: 'Manage your ads and marketing preferences', icon: 'bag' },
  { id: 'legal', title: 'Legal', subtitle: 'Terms of service and Privacy Policy', icon: 'hand.raised.slash' },
  { id: 'feedback', title: 'Feedback', subtitle: 'Bug reports and feature requests', icon: 'bubble.left' },
  { id: 'about', title: 'About', subtitle: 'App version and publication details', icon: 'info.circle' },
  { id: 'developer', title: 'Developer', subtitle: 'On-device logs and caches for debugging', icon: 'hammer' },
];

export const publicSettingsPageIds = ['ads', 'legal', 'feedback', 'about', 'developer'];

export function SettingsRow({ icon, title, subtitle, onPress, destructive = false }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.settingsRow}>
    <View style={styles.settingsIcon}><SymbolView name={icon} size={17} tintColor={destructive ? C.error : C.muted} /></View>
    <View style={styles.settingsCopy}><Text style={[styles.authorName, destructive && { color: C.error }]}>{title}</Text>{!!subtitle && <Text style={styles.meta}>{subtitle}</Text>}</View>
    <SymbolView name="chevron.right" size={15} tintColor={C.muted} />
  </Pressable>;
}

const developerSections = [
  { id: 'logs', title: 'App Logs', subtitle: 'On-device event log', icon: 'doc.text' },
  { id: 'images', title: 'Image Cache', subtitle: 'Downloaded images on this device', icon: 'photo' },
  { id: 'posts', title: 'Post Cache', subtitle: 'Offline copies of opened stories', icon: 'tray.full' },
  { id: 'api', title: 'API', subtitle: 'Endpoint the app sends requests to', icon: 'network' },
  { id: 'welcome', title: 'Welcome Screen', subtitle: 'Show the launch tutorial and agreement again', icon: 'sparkles' },
  { id: 'status', title: 'Status', subtitle: 'status.coffeencode.cc', icon: 'waveform.path.ecg', href: 'https://status.coffeencode.cc' },
];

function DeveloperSettings() {
  const [section, setSection] = useState(null);
  const [logStats, setLogStats] = useState({ bytes: 0, count: 0, maxBytes: 0 });
  const [logEntries, setLogEntries] = useState([]);
  const [imageStats, setImageStats] = useState({ tracked: 0, maxTracked: 0 });
  const [imageDisk, setImageDisk] = useState({ bytes: 0, count: 0, maxBytes: 0 });
  const [postStats, setPostStats] = useState({ bytes: 0, count: 0, maxBytes: 0 });
  const [refreshingImages, setRefreshingImages] = useState(false);
  const [apiBaseInput, setApiBaseInput] = useState(getApiBase());
  const [apiMessage, setApiMessage] = useState('');
  const [welcomeMessage, setWelcomeMessage] = useState('');

  const reload = useCallback(async () => {
    setLogStats(getLogStats());
    setLogEntries(getLogEntries(200));
    setPostStats(postCacheStats());
    setImageStats(imageCacheStats());
    setImageDisk(await imageDiskStats());
  }, []);
  useEffect(() => { reload(); }, [reload, section]);

  const shareLogs = async () => {
    try { await Share.share({ message: getLogText() || 'No log entries.' }); } catch {}
  };
  const refreshImages = async () => {
    setRefreshingImages(true);
    try { await refreshImageCache(); } finally { setRefreshingImages(false); await reload(); }
  };
  const clearAndReload = (action) => { action(); reload(); };
  const clearImages = async () => {
    clearImageCacheRegistry();
    await clearImageCache();
    await reload();
  };
  const saveApiBase = () => {
    try {
      setApiBase(apiBaseInput);
      setApiBaseInput(getApiBase());
      setApiMessage(`Saved. Requests now go to ${getApiBase()}`);
    } catch (error) {
      setApiMessage(error.message || 'Invalid URL.');
    }
  };
  const resetApiBase = () => {
    setApiBase('');
    setApiBaseInput(DEFAULT_API_BASE);
    setApiMessage(`Reset to ${DEFAULT_API_BASE}`);
  };

  const selected = developerSections.find((item) => item.id === section);
  if (!selected) {
    return <View style={styles.settingsCard}>
      {developerSections.map((item) => <SettingsRow key={item.id} {...item} onPress={() => item.href ? Linking.openURL(item.href) : setSection(item.id)} />)}
    </View>;
  }
  return <View style={styles.settingsCard}>
    <Pressable accessibilityRole="button" onPress={() => setSection(null)} style={styles.backLink}>
      <Text style={styles.action}>‹  Developer</Text>
    </Pressable>
    {section === 'logs' && <>
      <Text style={styles.accountDescription}>App events recorded on this device. Nothing is sent anywhere.</Text>
      <Text style={styles.settingsMetric}>{devFormatBytes(logStats.bytes)}<Text style={styles.meta}>  OF {devFormatBytes(logStats.maxBytes)} USED</Text></Text>
      <Text style={styles.meta}>{logStats.count} ENTRIES</Text>
      <Pressable accessibilityRole="button" onPress={shareLogs} style={styles.secondaryButton}><Text style={styles.action}>SHARE</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => clearAndReload(clearLogs)} style={styles.secondaryButton}><Text style={styles.action}>CLEAR</Text></Pressable>
      <ScrollView style={{ maxHeight: 320, marginTop: 12 }}>
        {logEntries.length ? logEntries.map((entry, index) => <Text key={index} selectable style={{ fontFamily: 'Menlo', fontSize: 12, color: C.muted, marginBottom: 6 }}>
          [{entry.level}] {entry.ts} {entry.message}{entry.detail ? `\n${entry.detail}` : ''}
        </Text>) : <Text style={styles.emptyText}>No log entries yet.</Text>}
      </ScrollView>
    </>}
    {section === 'images' && <>
      <Text style={styles.accountDescription}>Images the app downloads are stored on this device, up to {devFormatBytes(imageDisk.maxBytes)}. The oldest images are removed automatically when the limit is reached.</Text>
      <Text style={styles.settingsMetric}>{devFormatBytes(imageDisk.bytes)}<Text style={styles.meta}>  OF {devFormatBytes(imageDisk.maxBytes)} USED</Text></Text>
      <Text style={styles.meta}>{imageDisk.count} CACHED IMAGES</Text>
      <Text style={styles.meta}>{imageStats.tracked} TRACKED IMAGE URLS</Text>
      <Text style={styles.accountDescription}>Clearing removes every downloaded image. Images will be downloaded again as you browse, which may slow the app down until the cache refills.</Text>
      <Pressable accessibilityRole="button" disabled={refreshingImages} onPress={refreshImages} style={styles.secondaryButton}><Text style={styles.action}>{refreshingImages ? 'REFRESHING…' : 'REFRESH'}</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={clearImages} style={styles.secondaryButton}><Text style={styles.action}>CLEAR IMAGE CACHE</Text></Pressable>
    </>}
    {section === 'posts' && <>
      <Text style={styles.accountDescription}>Stories you open are kept on this device so they stay readable offline.</Text>
      <Text style={styles.settingsMetric}>{devFormatBytes(postStats.bytes)}<Text style={styles.meta}>  OF {devFormatBytes(postStats.maxBytes)} USED</Text></Text>
      <Text style={styles.meta}>{postStats.count} CACHED POSTS</Text>
      <Pressable accessibilityRole="button" onPress={reload} style={styles.secondaryButton}><Text style={styles.action}>REFRESH NOW</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={() => clearAndReload(clearPostCache)} style={styles.secondaryButton}><Text style={styles.action}>CLEAR POST CACHE</Text></Pressable>
    </>}
    {section === 'welcome' && <>
      <Text style={styles.accountDescription}>The welcome screen asks new users to agree to the Privacy Policy and Terms of Service, and shows tips for using the app. It only appears once after install.</Text>
      <Text style={styles.accountDescription}>Reset it to review the tutorial and agreement on the next app launch.</Text>
      {!!welcomeMessage && <Text style={styles.meta}>{welcomeMessage}</Text>}
      <Pressable accessibilityRole="button" onPress={async () => {
        try { await AsyncStorage.removeItem(WELCOME_KEY); setWelcomeMessage('Done. The welcome screen will show on next launch.'); }
        catch { setWelcomeMessage('Could not reset the welcome screen.'); }
      }} style={styles.secondaryButton}><Text style={styles.action}>SHOW ON NEXT LAUNCH</Text></Pressable>
      <Text style={styles.accountDescription}>Refreshing reloads the app bundle immediately — handy for seeing the welcome screen or picking up changes without restarting the app yourself.</Text>
      <Pressable accessibilityRole="button" onPress={() => {
        try {
          if (typeof DevSettings?.reload === 'function') DevSettings.reload();
          else setWelcomeMessage('App reload is not available in this build.');
        } catch { setWelcomeMessage('Could not refresh the app.'); }
      }} style={styles.secondaryButton}><Text style={styles.action}>REFRESH APP</Text></Pressable>
    </>}
    {section === 'api' && <>
      <Text style={styles.accountDescription}>All app requests are sent to this endpoint. It uses the exact same routes and URL parameters as the official API, so you can point the app at your own server if you host one.</Text>
      <Text style={styles.meta}>CURRENT: {getApiBase()}</Text>
      <TextInput value={apiBaseInput} onChangeText={setApiBaseInput} placeholder={DEFAULT_API_BASE} placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.searchInput} accessibilityLabel="API base URL" />
      {!!apiMessage && <Text style={styles.meta}>{apiMessage}</Text>}
      <Pressable accessibilityRole="button" onPress={saveApiBase} style={styles.secondaryButton}><Text style={styles.action}>SAVE</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={resetApiBase} style={styles.secondaryButton}><Text style={styles.action}>RESET TO DEFAULT</Text></Pressable>
    </>}
  </View>;
}

export default function AccountSettings({ account, accountProfile, coffeeProfile, accountPds, blockedAccounts, tagFollows = [], savedCount, viewedCount, accountBusy, initialPage, onBack, onUnblock, onToggleTagFollow, onSignOut }) {
  const [page, setPage] = useState(initialPage);
  const pages = account ? accountSettingsPages : accountSettingsPages.filter((item) => publicSettingsPageIds.includes(item.id));
  const selected = pages.find((item) => item.id === page);
  return <ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" onPress={selected ? initialPage ? onBack : () => setPage(null) : onBack} style={styles.backLink}>
      <Text style={styles.action}>‹  Back to Settings</Text>
    </Pressable>
    <Text style={[styles.pageTitle, { marginTop: 0 }]}>{selected?.title || 'Settings'}</Text>
    <Text style={styles.pageSubtitle}>{selected?.subtitle || 'Manage your account and app settings'}</Text>
    {selected ? <>
      {page === 'account' && !!account && <View style={styles.accountCard}>
        <Text style={styles.accountProfileName}>Deactivate Account</Text>
        <Text style={styles.accountDescription}>Deactivate your repostory on the network, your account/identity will still exist and be visable to the network but records won't be, and will be hidden by most apps and appviews. All current OAuth seesions and App Passowords will be revoked. You can always reactivate your account at any time.</Text>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(`https://account.coffeencode.cc/accoount/u/${accountProfile.handle}/manage`)} style={styles.profileLink}><Text style={styles.action}>VISIT COFFEE & CODE  ↗</Text></Pressable>

        <Text style={styles.accountProfileName}>Migrate Account</Text>
        <Text style={styles.accountDescription}>Migrate your repository to a new Personal Data Server (PDS). This will move your account and all records to a new PDS, and revoke all current OAuth sessions and App Passwords. This will update your did doc and request an update to the plc.direcotry to resolve your identity to the new PDS. Only do this if you know what you're doing, there is a small chance of data loss.</Text>

        <View style={styles.accountIdentityDetails}>
          <Text style={styles.accountIdentityLabel}>HANDLE</Text><Text selectable style={styles.accountIdentityValue}>{accountProfile?.handle ? `@${accountProfile.handle}` : 'Unavailable'}</Text>
          <Text style={styles.accountIdentityLabel}>DID</Text><Text selectable style={styles.accountIdentityValue}>{account.session.did}</Text>
          <Text style={styles.accountIdentityLabel}>PDS</Text><Text selectable style={styles.accountIdentityValue}>{accountPds || 'Unavailable'}</Text>
        </View>
        <Pressable accessibilityRole="button" disabled={accountBusy} onPress={onSignOut} style={styles.secondaryButton}><Text style={styles.action}>{accountBusy ? 'PLEASE WAIT…' : 'SIGN OUT'}</Text></Pressable>
      </View>}
      {page === 'reading' && <View style={styles.settingsCard}>
        <Text style={styles.accountDescription}>Your reading history and saved stories belong to your account and sync when you sign in.</Text>
        <Text style={styles.settingsMetric}>{viewedCount}<Text style={styles.meta}>  STORIES READ</Text></Text>
        <View style={styles.rule} />
        <Text style={styles.settingsMetric}>{savedCount}<Text style={styles.meta}>  SAVED STORIES</Text></Text>
      </View>}
      {page === 'follows' && <View style={styles.settingsCard}>
        <Text style={styles.accountDescription}>Stories published under tags you follow appear in your notifications. Follow a tag from the search tab.</Text>
        {tagFollows.length ? tagFollows.map((follow) => <View key={follow.rkey || follow.tag} style={styles.blockedAccountRow}>
          <View style={{ flex: 1 }}><Text style={styles.accountIdentityValue}>{follow.tag}</Text><Text style={styles.meta}>Following since {formatDate(follow.createdAt) || 'recently'}</Text></View>
          <Pressable accessibilityRole="button" disabled={accountBusy} onPress={() => onToggleTagFollow?.(follow.tag)} style={styles.accountRemoveButton}><Text style={styles.action}>UNFOLLOW</Text></Pressable>
        </View>) : <Text style={styles.emptyText}>You are not following any tags.</Text>}
      </View>}
      {page === 'blocked' && <View style={styles.settingsCard}>
        <Text style={styles.accountDescription}>Comments and forum posts from Blocked accounts will be hidden on Coffee & Code. Unless specified, the user will still be visable on Bluesky.</Text>
        {blockedAccounts.length ? blockedAccounts.map((blocked) => <View key={blocked.did} style={styles.blockedAccountRow}>
          <View style={{ flex: 1 }}><Text style={styles.accountIdentityValue}>{blocked.did}</Text><Text style={styles.meta}>Blocked {formatDate(blocked.createdAt)}</Text></View>
          <Pressable accessibilityRole="button" disabled={accountBusy} onPress={() => onUnblock(blocked.did)} style={styles.accountRemoveButton}><Text style={styles.action}>UNBLOCK</Text></Pressable>
        </View>) : <Text style={styles.emptyText}>You have not blocked any accounts</Text>}
      </View>}
      {page === 'ads' && <View style={styles.settingsCard}>
        <Text style={styles.accountDescription}>Ads and marketing preferences will appear here.</Text>
      </View>}
      {page === 'developer' && <DeveloperSettings />}
      {page === 'feedback' && <View style={styles.settingsCard}>
        <Text style={styles.accountDescription}>Spotted a bug or have an idea? Share it on the feedback board — bug reports and feature requests both welcome.</Text>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(FEEDBACK_URL)} style={styles.profileLink}><Text style={styles.action}>OPEN FEEDBACK BOARD  ↗</Text></Pressable>
        <Text style={styles.accountDescription}>Prefer email?</Text>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL('mailto:hello@coffeencode.cc')} style={styles.profileLink}><Text style={styles.action}>EMAIL HELLO@COFFEENCODE.CC  ↗</Text></Pressable>
      </View>}
      {page === 'legal' && <View style={styles.settingsCard}>
        <LegalSettings />
      </View>}
      {page === 'about' && <View style={styles.settingsCard}>
        <Text style={styles.accountProfileName}>Coffee & Code</Text>
        <Text style={styles.accountDescription}>Independent technology journalism, built on the AT Protocol.</Text>
        {!!account && <>
          <Text style={styles.accountIdentityLabel}>SIGNED IN AS</Text><Text style={styles.accountIdentityValue}>@{accountProfile?.handle || 'Unknown'}</Text>
          <Text style={styles.accountIdentityLabel}>PERSONAL DATA SERVER</Text><Text selectable style={styles.accountIdentityValue}>{accountPds || 'Unavailable'}</Text>
        </>}
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://coffeencode.cc')} style={styles.profileLink}><Text style={styles.action}>VISIT COFFEE & CODE  ↗</Text></Pressable>
      </View>}
    </> : <View style={styles.settingsCard}>
      {pages.map((item) => <SettingsRow key={item.id} {...item} onPress={() => setPage(item.id)} />)}
    </View>}
  </ScrollView>;
}