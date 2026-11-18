import React, { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ActivityIndicator, DevSettings, Image, Linking, Pressable, ScrollView, Share, Switch, Text, TextInput, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { WELCOME_KEY, FEEDBACK_URL } from './Welcome';
import SymbolView from './Icon';
import { C, styles } from './theme';
import { formatDate } from './utils';
import {
  clearImageCacheRegistry, clearLogs, clearPostCache, DEFAULT_API_BASE, formatBytes as devFormatBytes,
  getApiBase, getLogEntries, getLogStats, getLogText, imageCacheStats, postCacheStats, refreshImageCache,
  setApiBase,
} from './developer';
import {
  DEFAULT_FONT_SIZE, MAX_FONT_SIZE, MIN_FONT_SIZE, STORY_FONT_CHOICES, normalizePreferences, readerTextStyle,
} from './preferences';

// expo-image-picker is a native module: it only exists in builds made after it
// was installed. Require it lazily so older dev-client builds keep working.
let ImagePicker = null;
try {
  ImagePicker = require('expo-image-picker');
} catch { /* Older dev-client builds keep working without image picking. */ }
import { cacheStats as imageDiskStats, clearImageCache } from './imageCache';
import { LegalSettings } from './legal';

export const accountSettingsPages = [
  { id: 'profile', title: 'Edit profile', subtitle: 'Your name, pronouns, bio, and photos on Coffee & Code', icon: 'pencil' },
  { id: 'appearance', title: 'Appearance', subtitle: 'Story font and text size, synced to your account', icon: 'textformat.size' },
  { id: 'email', title: 'Email notifications', subtitle: 'Get new stories from authors and tags you follow in your inbox', icon: 'envelope' },
  { id: 'account', title: 'Manage Identity', subtitle: 'Manage your identity and perform destructive actions', icon: 'person.crop.circle' },
  { id: 'reading', title: 'Public activity', subtitle: 'View and delete public records. Likes, views, saves, etc.', icon: 'book' },
  { id: 'follows', title: 'Following', subtitle: 'Authors and tags you follow for new-story notifications', icon: 'tag' },
  { id: 'blocked', title: 'Moderation', subtitle: 'Manage your blocked accounts and moderation preferences', icon: 'hand.raised' },
  { id: 'ads', title: 'Ads and Marketing', subtitle: 'Manage your ads and marketing preferences', icon: 'bag' },
  { id: 'legal', title: 'Legal', subtitle: 'Terms of service and Privacy Policy', icon: 'hand.raised.slash' },
  { id: 'feedback', title: 'Feedback', subtitle: 'Bug reports and feature requests', icon: 'bubble.left' },
  { id: 'about', title: 'About', subtitle: 'App version and publication details', icon: 'info.circle' },
  { id: 'developer', title: 'Developer', subtitle: 'On-device logs and caches for debugging', icon: 'hammer' },
];

export const publicSettingsPageIds = ['appearance', 'ads', 'legal', 'feedback', 'about', 'developer'];

export function SettingsRow({ icon, title, subtitle, onPress, destructive = false, badge = 0 }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.settingsRow}>
    <View style={styles.settingsIcon}><SymbolView name={icon} size={17} tintColor={destructive ? C.error : C.muted} /></View>
    <View style={styles.settingsCopy}><Text style={[styles.authorName, destructive && { color: C.error }]}>{title}</Text>{!!subtitle && <Text style={styles.meta}>{subtitle}</Text>}</View>
    {badge > 0 && <View style={styles.settingsRowBadge}><Text style={styles.settingsRowBadgeText}>{badge > 99 ? '99+' : badge}</Text></View>}
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

const PROFILE_LIMITS = { displayName: 64, pronouns: 40, description: 256 };
const graphemes = (value) => [...String(value || '')].length;

// Edits the reader profile record (cc.coffeencode.profile). Unknown fields on
// the existing record are preserved so other clients' data is not lost.
function ProfileEditor({ account, accountProfile, coffeeProfile, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [description, setDescription] = useState('');
  const [avatar, setAvatar] = useState(null);
  const [banner, setBanner] = useState(null);
  const [removeAvatar, setRemoveAvatar] = useState(false);
  const [removeBanner, setRemoveBanner] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');

  const record = coffeeProfile || {};
  const startEditing = () => {
    setDisplayName(record.displayName || accountProfile?.displayName || '');
    setPronouns(record.pronouns || '');
    setDescription(record.description || accountProfile?.description || '');
    setAvatar(null);
    setBanner(null);
    setRemoveAvatar(false);
    setRemoveBanner(false);
    setStatus('');
    setEditing(true);
  };

  const pickImage = async (kind) => {
    if (busy) return;
    if (!ImagePicker) {
      setStatus('Image picking needs a newer app build. Rebuild the app to use it.');
      return;
    }
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: kind === 'avatar' ? [1, 1] : [3, 1],
        quality: 0.9,
      });
      if (result.canceled) return;
      const asset = result.assets?.[0];
      if (!asset?.uri) return;
      if (asset.fileSize && asset.fileSize > 2_000_000) {
        setStatus('Profile images must be smaller than 2 MB. Choose a smaller image.');
        return;
      }
      const mimeType = asset.mimeType
        || `image/${/\.(png)$/i.test(asset.uri) ? 'png' : /\.(gif)$/i.test(asset.uri) ? 'gif' : /\.(webp)$/i.test(asset.uri) ? 'webp' : 'jpeg'}`;
      if (!/^image\/(jpeg|png|gif|webp)$/.test(mimeType)) {
        setStatus('Profile images must be JPEG, PNG, GIF, or WebP.');
        return;
      }
      setStatus('');
      if (kind === 'avatar') { setAvatar({ uri: asset.uri, mimeType }); setRemoveAvatar(false); }
      else { setBanner({ uri: asset.uri, mimeType }); setRemoveBanner(false); }
    } catch (pickError) {
      setStatus(pickError.message || 'Could not open the image picker.');
    }
  };

  const save = async () => {
    const invalid = [['displayName', 'Display name', displayName], ['pronouns', 'Pronouns', pronouns], ['description', 'Bio', description]]
      .find(([key, , value]) => graphemes(value.trim()) > PROFILE_LIMITS[key]);
    if (invalid) {
      setStatus(`${invalid[1]} must be ${PROFILE_LIMITS[invalid[0]]} characters or fewer.`);
      return;
    }
    setBusy(true);
    setStatus(avatar || banner ? 'Uploading images…' : 'Saving your profile…');
    try {
      const { avatarUrl, bannerUrl, ...rest } = record;
      const next = { ...rest, $type: 'cc.coffeencode.profile' };
      const fields = { displayName: displayName.trim(), pronouns: pronouns.trim(), description: description.trim() };
      Object.entries(fields).forEach(([key, value]) => { if (value) next[key] = value; else delete next[key]; });
      const upload = async (picked) => {
        const base64 = await FileSystem.readAsStringAsync(picked.uri, { encoding: FileSystem.EncodingType.Base64 });
        const bytes = Uint8Array.fromBase64(base64);
        if (bytes.length > 2_000_000) throw new Error('Profile images must be smaller than 2 MB.');
        const uploaded = await account.agent.com.atproto.repo.uploadBlob(bytes, { encoding: picked.mimeType || 'image/jpeg' });
        const blob = uploaded?.data?.blob;
        if (!blob?.ref?.$link) throw new Error('The account provider did not return the uploaded image.');
        return blob;
      };
      if (avatar) next.avatar = await upload(avatar);
      else if (removeAvatar) delete next.avatar;
      if (banner) next.banner = await upload(banner);
      else if (removeBanner) delete next.banner;
      if (typeof next.createdAt !== 'string' || !next.createdAt) next.createdAt = new Date().toISOString();
      setStatus('Saving your profile…');
      await account.agent.com.atproto.repo.putRecord({
        repo: account.session.did,
        collection: 'cc.coffeencode.profile',
        rkey: 'self',
        record: next,
      });
      onSaved?.(next);
      setStatus('Profile saved.');
      setEditing(false);
    } catch (saveError) {
      setStatus(saveError.message || 'Could not save your profile.');
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return <View style={styles.settingsCard}>
      <Text style={styles.accountDescription}>Your Coffee & Code profile is shown on your public reader page instead of your Bluesky details. Changes sync anywhere you sign in.</Text>
      <Pressable accessibilityRole="button" onPress={startEditing} style={styles.secondaryButton}><Text style={styles.action}>EDIT PROFILE</Text></Pressable>
    </View>;
  }

  const pickerRow = (kind, picked, currentUrl, removed, onRemove) => <View style={styles.listImagePickerRow}>
    {picked?.uri || (!removed && currentUrl)
      ? <Image source={{ uri: picked?.uri || currentUrl }} accessibilityLabel={kind === 'avatar' ? 'Profile photo preview' : 'Profile banner preview'} style={kind === 'avatar' ? styles.profileAvatarPreview : styles.profileBannerPreview} />
      : <View style={[kind === 'avatar' ? styles.profileAvatarPreview : styles.profileBannerPreview, styles.listImagePreviewEmpty]}><SymbolView name="photo" size={18} tintColor={C.muted} /></View>}
    <View style={{ flex: 1 }}>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => pickImage(kind)} style={styles.secondaryButton}><Text style={styles.action}>{picked || (!removed && currentUrl) ? `CHANGE ${kind === 'avatar' ? 'PHOTO' : 'BANNER'}` : `CHOOSE ${kind === 'avatar' ? 'PHOTO' : 'BANNER'}`}</Text></Pressable>
      {(picked || (!removed && currentUrl)) && <Pressable accessibilityRole="button" disabled={busy} onPress={onRemove}><Text style={[styles.action, { color: C.error, marginTop: 8 }]}>REMOVE</Text></Pressable>}
    </View>
  </View>;

  return <View style={styles.settingsCard}>
    {!!status && <Text accessibilityRole="alert" style={styles.error}>{status}</Text>}
    <Text style={styles.fieldLabel}>PROFILE PHOTO</Text>
    {pickerRow('avatar', avatar, coffeeProfile?.avatarUrl || accountProfile?.avatar, removeAvatar, () => { setAvatar(null); setRemoveAvatar(true); })}
    <Text style={[styles.fieldLabel, { marginTop: 14 }]}>BANNER</Text>
    {pickerRow('banner', banner, coffeeProfile?.bannerUrl || accountProfile?.banner, removeBanner, () => { setBanner(null); setRemoveBanner(true); })}
    <Text style={styles.meta}>Images upload to your account, up to 2 MB each.</Text>
    <Text style={[styles.fieldLabel, { marginTop: 14 }]}>DISPLAY NAME</Text>
    <TextInput value={displayName} onChangeText={setDisplayName} editable={!busy} placeholder="Your name" placeholderTextColor={C.muted} maxLength={640} style={styles.commentInput} />
    <Text style={[styles.fieldLabel, { marginTop: 14 }]}>PRONOUNS (OPTIONAL)</Text>
    <TextInput value={pronouns} onChangeText={setPronouns} editable={!busy} placeholder="For example: they/them" placeholderTextColor={C.muted} maxLength={400} autoCapitalize="none" style={styles.commentInput} />
    <Text style={[styles.fieldLabel, { marginTop: 14 }]}>BIO</Text>
    <TextInput value={description} onChangeText={setDescription} editable={!busy} placeholder="A little about you" placeholderTextColor={C.muted} multiline maxLength={2560} style={[styles.commentInput, { minHeight: 80 }]} />
    <Pressable accessibilityRole="button" disabled={busy} onPress={save} style={[styles.primaryButton, busy && styles.disabledButton, { marginTop: 16 }]}>
      <Text style={styles.primaryButtonText}>{busy ? 'SAVING…' : 'SAVE PROFILE'}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" disabled={busy} onPress={() => setEditing(false)}><Text style={[styles.action, { marginTop: 12 }]}>CANCEL</Text></Pressable>
  </View>;
}

function AppearanceSettings({ account, prefs, onPrefsChange, prefsStatus = '' }) {
  const active = normalizePreferences(prefs);
  const size = active.postFontSize || DEFAULT_FONT_SIZE;
  const choose = (patch) => onPrefsChange?.(normalizePreferences({ ...active, ...patch }));
  const chip = (choice) => <Pressable key={choice.id} accessibilityRole="button" accessibilityState={{ selected: active.postFont === choice.id }} onPress={() => choose({ postFont: choice.id })} style={[styles.tagChip, active.postFont === choice.id && styles.tagChipActive]}>
    <Text style={[styles.tagText, active.postFont === choice.id && styles.tagTextActive]}>{choice.label}</Text>
  </Pressable>;
  return <View style={styles.settingsCard}>
    <Text style={styles.accountDescription}>Choose how stories look in the app. Your preferences are saved to your account and synced with the Coffee &amp; Code website.</Text>
    <Text style={styles.fieldLabel}>STORY FONT</Text>
    <View style={styles.prefChipRow}>{STORY_FONT_CHOICES.map(chip)}</View>
    <Text style={[styles.fieldLabel, { marginTop: 14 }]}>STORY TEXT SIZE</Text>
    <View style={styles.prefSizeRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Decrease text size" disabled={size <= MIN_FONT_SIZE} onPress={() => choose({ postFontSize: size - 1 })} style={[styles.tagChip, size <= MIN_FONT_SIZE && styles.disabledButton]}><Text style={styles.tagText}>A−</Text></Pressable>
      <Text style={styles.accountIdentityValue}>{size}px</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Increase text size" disabled={size >= MAX_FONT_SIZE} onPress={() => choose({ postFontSize: size + 1 })} style={[styles.tagChip, size >= MAX_FONT_SIZE && styles.disabledButton]}><Text style={styles.tagText}>A+</Text></Pressable>
    </View>
    <View style={styles.prefPreview}>
      <Text style={[styles.paragraph, readerTextStyle(active), { marginBottom: 0 }]}>The quick brown fox jumps over the lazy dog. Stories you read in the app use this font and size.</Text>
    </View>
    {!!prefsStatus && <Text style={styles.meta}>{prefsStatus}</Text>}
    {!account && <Text style={styles.meta}>Sign in to sync these preferences with the website.</Text>}
  </View>;
}

const EMAIL_FREQUENCIES = [
  { id: 'instant', label: 'Instant' },
  { id: 'daily', label: 'Daily' },
  { id: 'weekly', label: 'Weekly' },
];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Mirrors the website's Email notifications card: the same /api/email routes
// back both, so addresses added here work there too.
function EmailSettings({ account }) {
  const did = account?.session?.did;
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Loading your email settings…');
  const [newAddress, setNewAddress] = useState('');
  const [accountEmail, setAccountEmail] = useState(null);
  const [filterFor, setFilterFor] = useState(null);
  const [filterDraft, setFilterDraft] = useState({ tags: '', authors: '' });

  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(`${getApiBase()}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `The email service returned an error (${response.status}).`);
    return payload;
  }, []);

  const applySettings = useCallback((payload) => {
    setSettings(payload);
    return payload;
  }, []);

  useEffect(() => {
    if (!did) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const payload = await request(`/email/settings?did=${encodeURIComponent(did)}`);
        if (cancelled) return;
        applySettings(payload);
        setStatus(payload.emails?.length ? '' : 'Add an email address to get new stories in your inbox.');
      } catch (loadError) {
        if (!cancelled) setStatus(loadError.message || 'Could not load your email settings.');
      } finally {
        if (!cancelled) setLoading(false);
      }
      // The account's own email comes from its PDS session. Sessions that
      // predate the email scope just do not offer the button.
      try {
        const session = await account.agent.com.atproto.server.getSession();
        const address = session?.data?.email;
        if (!cancelled && typeof address === 'string' && address) {
          setAccountEmail({ address, confirmed: session.data.emailConfirmed === true });
        }
      } catch { /* Account email unavailable; manual addresses still work. */ }
    })();
    return () => { cancelled = true; };
  }, [did, account, request, applySettings]);

  const run = useCallback(async (working, action) => {
    if (busy) return;
    setBusy(true);
    setStatus(working);
    try {
      const payload = await action();
      if (payload?.emails) applySettings(payload);
      return payload;
    } catch (actionError) {
      setStatus(actionError.message || 'That change could not be saved.');
      return null;
    } finally {
      setBusy(false);
    }
  }, [busy, applySettings]);

  const toggleEnabled = (enabled) => run(
    enabled ? 'Turning email notifications on…' : 'Turning email notifications off…',
    async () => {
      const payload = await request('/email/settings', { method: 'POST', body: JSON.stringify({ did, enabled }) });
      setStatus(enabled ? 'Email notifications are on.' : 'Email notifications are off.');
      return payload;
    },
  );
  const chooseFrequency = (frequency) => run('Saving your delivery preference…', async () => {
    const payload = await request('/email/settings', { method: 'PUT', body: JSON.stringify({ did, frequency }) });
    setStatus(frequency === 'instant' ? 'Emails will arrive as stories publish.' : `You'll get a ${frequency} brief in your inbox.`);
    return payload;
  });
  const removeAddress = (address) => run(`Removing ${address}…`, async () => {
    const payload = await request('/email/addresses', { method: 'DELETE', body: JSON.stringify({ did, email: address }) });
    setStatus(`Removed ${address}.`);
    return payload;
  });
  const resend = (address) => run(`Resending the confirmation email to ${address}…`, async () => {
    const payload = await request('/email/addresses', { method: 'POST', body: JSON.stringify({ did, email: address }) });
    setStatus(payload.verificationSent ? `Confirmation email sent to ${address}.` : 'The confirmation email could not be sent right now. Try again shortly.');
    return payload;
  });
  const addAddress = () => {
    const address = newAddress.trim();
    if (!EMAIL_PATTERN.test(address)) { setStatus('Enter a valid email address.'); return; }
    void run(`Sending a confirmation email to ${address}…`, async () => {
      const payload = await request('/email/addresses', { method: 'POST', body: JSON.stringify({ did, email: address }) });
      setNewAddress('');
      setStatus(payload.alreadyVerified
        ? `${address} is already verified.`
        : payload.verificationSent
          ? `Confirmation email sent to ${address}. Open the link in it to verify the address.`
          : `${address} saved, but the confirmation email could not be sent. Try again shortly.`);
      return payload;
    });
  };
  const addAccountEmail = () => {
    if (!accountEmail) return;
    const { address, confirmed } = accountEmail;
    void run(`Adding ${address}…`, async () => {
      const payload = await request(confirmed ? '/email/account-email' : '/email/addresses', { method: 'POST', body: JSON.stringify({ did, email: address }) });
      setStatus(confirmed
        ? `${address} added — it is already verified through your account.`
        : `Confirmation email sent to ${address}. Open the link in it to verify the address.`);
      if (confirmed) setAccountEmail(null);
      return payload;
    });
  };
  const openFilters = (entry) => {
    setFilterFor(entry.address);
    setFilterDraft({ tags: (entry.tags || []).join(', '), authors: (entry.authors || []).join(', ') });
  };
  const saveFilters = () => {
    const parse = (value) => value.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 32);
    const tags = parse(filterDraft.tags);
    const authors = parse(filterDraft.authors);
    void run('Saving delivery filters…', async () => {
      const payload = await request('/email/addresses', { method: 'PUT', body: JSON.stringify({ did, email: filterFor, tags, authors }) });
      setFilterFor(null);
      setStatus(tags.length || authors.length
        ? `${filterFor} now only receives matching stories.`
        : `${filterFor} now receives every matching story.`);
      return payload;
    });
  };

  if (loading) return <View style={styles.settingsCard}><ActivityIndicator color={C.muted} /><Text style={[styles.meta, { marginTop: 10 }]}>{status}</Text></View>;
  const enabled = settings?.enabled === true;
  const frequency = settings?.frequency || 'instant';
  const emails = settings?.emails || [];
  const accountEmailListed = accountEmail && emails.some((entry) => entry.address.toLowerCase() === accountEmail.address.toLowerCase());
  return <View style={styles.settingsCard}>
    <View style={styles.emailToggleRow}>
      <Text style={[styles.authorName, { flex: 1, paddingRight: 10 }]}>Email me when people or tags I follow publish a story</Text>
      <Switch accessibilityLabel="Email me when people or tags I follow publish a story" value={enabled} disabled={busy || !settings} onValueChange={toggleEnabled} trackColor={{ true: C.ink, false: C.panelLight }} thumbColor={enabled ? C.bg : C.muted} />
    </View>
    <Text style={styles.fieldLabel}>DELIVERY</Text>
    <View style={styles.prefChipRow}>
      {EMAIL_FREQUENCIES.map((option) => <Pressable key={option.id} accessibilityRole="button" accessibilityState={{ selected: frequency === option.id }} disabled={busy || !settings} onPress={() => chooseFrequency(option.id)} style={[styles.tagChip, frequency === option.id && styles.tagChipActive]}>
        <Text style={[styles.tagText, frequency === option.id && styles.tagTextActive]}>{option.label}</Text>
      </Pressable>)}
    </View>
    {!!status && <Text accessibilityRole="alert" style={[styles.meta, { marginTop: 12 }]}>{status}</Text>}
    {emails.map((entry) => <View key={entry.address} style={styles.blockedAccountRow}>
      <View style={{ flex: 1 }}>
        <Text numberOfLines={1} style={styles.accountIdentityValue}>{entry.address}</Text>
        <Text style={styles.meta}>{entry.verified ? (entry.account ? 'Account email' : 'Verified') : 'Pending confirmation'}</Text>
        {!!(entry.tags?.length || entry.authors?.length) && <Text style={styles.meta} numberOfLines={2}>Only: {[...(entry.tags || []).map((tag) => `#${tag}`), ...(entry.authors || [])].join(', ')}</Text>}
      </View>
      <View style={styles.emailRowActions}>
        {!entry.verified && <Pressable accessibilityRole="button" disabled={busy} onPress={() => resend(entry.address)}><Text style={styles.action}>RESEND</Text></Pressable>}
        <Pressable accessibilityRole="button" accessibilityLabel={`Edit filters for ${entry.address}`} disabled={busy} onPress={() => (filterFor === entry.address ? setFilterFor(null) : openFilters(entry))}><Text style={styles.action}>FILTERS</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${entry.address}`} disabled={busy} onPress={() => removeAddress(entry.address)}><Text style={[styles.action, { color: C.error }]}>REMOVE</Text></Pressable>
      </View>
      {filterFor === entry.address && <View style={{ flexBasis: '100%', marginTop: 10 }}>
        <Text style={styles.fieldLabel}>ONLY THESE TAGS (COMMA-SEPARATED)</Text>
        <TextInput value={filterDraft.tags} onChangeText={(tags) => setFilterDraft((draft) => ({ ...draft, tags }))} placeholder="Leave empty for every tag" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} style={styles.commentInput} />
        <Text style={[styles.fieldLabel, { marginTop: 10 }]}>ONLY THESE AUTHORS (COMMA-SEPARATED)</Text>
        <TextInput value={filterDraft.authors} onChangeText={(authors) => setFilterDraft((draft) => ({ ...draft, authors }))} placeholder="Handles or DIDs, empty for every author" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} style={styles.commentInput} />
        <Pressable accessibilityRole="button" disabled={busy} onPress={saveFilters} style={styles.secondaryButton}><Text style={styles.action}>SAVE FILTERS</Text></Pressable>
      </View>}
    </View>)}
    {!!accountEmail && !accountEmailListed && <Pressable accessibilityRole="button" disabled={busy} onPress={addAccountEmail} style={styles.secondaryButton}>
      <Text style={styles.action}>{accountEmail.confirmed ? `USE ${accountEmail.address.toUpperCase()}` : `USE ${accountEmail.address.toUpperCase()} (CONFIRMATION REQUIRED)`}</Text>
    </Pressable>}
    <Text style={styles.fieldLabel}>ADD AN ADDRESS</Text>
    <TextInput value={newAddress} onChangeText={setNewAddress} editable={!busy} placeholder="you@example.com" placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" style={styles.commentInput} />
    <Pressable accessibilityRole="button" disabled={busy || !newAddress.trim()} onPress={addAddress} style={[styles.primaryButton, (busy || !newAddress.trim()) && styles.disabledButton, { marginTop: 12 }]}>
      <Text style={styles.primaryButtonText}>{busy ? 'PLEASE WAIT…' : 'SEND CONFIRMATION EMAIL'}</Text>
    </Pressable>
  </View>;
}

export default function AccountSettings({ account, accountProfile, coffeeProfile, accountPds, blockedAccounts, tagFollows = [], authors = [], authorFollows = [], savedCount, viewedCount, accountBusy, initialPage, onBack, onUnblock, onToggleTagFollow, onToggleAuthorFollow, onSignOut, onProfileSaved, readerPrefs, onReaderPrefsChange, readerPrefsStatus }) {
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
      {page === 'profile' && !!account && <ProfileEditor account={account} accountProfile={accountProfile} coffeeProfile={coffeeProfile} onSaved={onProfileSaved} />}
      {page === 'appearance' && <AppearanceSettings account={account} prefs={readerPrefs} onPrefsChange={onReaderPrefsChange} prefsStatus={readerPrefsStatus} />}
      {page === 'email' && !!account && <EmailSettings account={account} />}
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
        <Text style={styles.accountDescription}>New posts from authors and tags you follow appear in your notifications.</Text>
        <Text style={styles.fieldLabel}>AUTHORS</Text>
        {(() => {
          const isFollowed = (did) => authorFollows.some((follow) => follow.did?.toLowerCase() === did?.toLowerCase());
          const knownDids = new Set(authors.map((author) => author.did));
          const extraFollows = authorFollows.filter((follow) => !knownDids.has(follow.did));
          const authorRow = (author) => {
            const followed = isFollowed(author.did);
            return <View key={author.did} style={styles.blockedAccountRow}>
              {author.avatar
                ? <Image source={{ uri: author.avatar }} accessibilityLabel={`${author.displayName || author.handle} profile photo`} style={styles.followAuthorAvatar} />
                : <View style={[styles.followAuthorAvatar, styles.followAuthorAvatarPlaceholder]}><Text style={styles.avatarInitial}>{(author.displayName || author.handle || 'C')[0].toUpperCase()}</Text></View>}
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={styles.accountIdentityValue}>{author.displayName || author.handle || author.did}</Text>
                {!!author.handle && <Text numberOfLines={1} style={styles.meta}>@{author.handle}</Text>}
              </View>
              <Pressable accessibilityRole="button" accessibilityState={{ selected: followed }} accessibilityLabel={`${followed ? 'Unfollow' : 'Follow'} ${author.displayName || author.handle || author.did}`} disabled={accountBusy} onPress={() => onToggleAuthorFollow?.(author)} style={styles.accountRemoveButton}>
                <Text style={styles.action}>{followed ? 'FOLLOWING' : 'FOLLOW'}</Text>
              </Pressable>
            </View>;
          };
          return <>
            {authors.length ? authors.map(authorRow) : extraFollows.length ? extraFollows.map(authorRow) : <Text style={styles.emptyText}>Authors will appear here once the feed loads.</Text>}
            {!!authors.length && !!extraFollows.length && extraFollows.map((follow) => <View key={follow.did} style={styles.blockedAccountRow}>
              <View style={{ flex: 1 }}><Text numberOfLines={1} style={styles.accountIdentityValue}>{follow.did}</Text></View>
              <Pressable accessibilityRole="button" disabled={accountBusy} onPress={() => onToggleAuthorFollow?.(follow)} style={styles.accountRemoveButton}><Text style={styles.action}>FOLLOWING</Text></Pressable>
            </View>)}
          </>;
        })()}
        <Text style={[styles.fieldLabel, { marginTop: 16 }]}>TAGS</Text>
        <Text style={styles.accountDescription}>Follow a tag from the Archive tab.</Text>
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