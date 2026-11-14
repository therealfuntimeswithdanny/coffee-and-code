import React, { useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { C, styles } from './theme';
import { formatDate } from './utils';

export const accountSettingsPages = [
  { id: 'account', title: 'Manage Identity', subtitle: 'Manage your identity and perform destructive actions', icon: 'person.crop.circle' },
  { id: 'reading', title: 'Public activity', subtitle: 'View and delete public records. Likes, views, saves, etc.', icon: 'book' },
  { id: 'blocked', title: 'Moderation', subtitle: 'Manage your blocked accounts and moderation preferences', icon: 'hand.raised' },
  { id: 'ads', title: 'Ads and Marketing', subtitle: 'Manage your ads and marketing preferences', icon: 'bag' },
  { id: 'legal', title: 'Legal', subtitle: 'Terms of service and Privacy Policy', icon: 'hand.raised.slash' },
  { id: 'about', title: 'About', subtitle: 'App version and publication details', icon: 'info.circle' },
  { id: 'storage', title: 'Storage', subtitle: 'Image cache usage and clearing', icon: 'internaldrive' },
];

export const publicSettingsPageIds = ['ads', 'storage', 'legal', 'about'];

export function SettingsRow({ icon, title, subtitle, onPress, destructive = false }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.settingsRow}>
    <View style={styles.settingsIcon}><SymbolView name={icon} size={17} tintColor={destructive ? C.error : C.muted} /></View>
    <View style={styles.settingsCopy}><Text style={[styles.authorName, destructive && { color: C.error }]}>{title}</Text>{!!subtitle && <Text style={styles.meta}>{subtitle}</Text>}</View>
    <SymbolView name="chevron.right" size={15} tintColor={C.muted} />
  </Pressable>;
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(0, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function AccountSettings({ account, accountProfile, coffeeProfile, accountPds, blockedAccounts, savedCount, viewedCount, accountBusy, initialPage, onBack, onUnblock, onSignOut, cacheBytes = 0, maxCacheBytes = 0, cacheClearing = false, onClearCache }) {
  const [page, setPage] = useState(initialPage);
  const pages = account ? accountSettingsPages : accountSettingsPages.filter((item) => publicSettingsPageIds.includes(item.id));
  const selected = pages.find((item) => item.id === page);
  return <ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" onPress={selected ? initialPage ? onBack : () => setPage(null) : onBack} style={styles.backLink}>
      <Text style={styles.action}>‹  {selected ? initialPage ? 'Back to Settings' : 'Back to Settings' : 'Back to Settings'}</Text>
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
      {page === 'blocked' && <View style={styles.settingsCard}>
        <Text style={styles.accountDescription}>Comments and forum posts from Blocked accounts will be hidden on Coffee & Code. Unless specified, the user will still be visable on Bluesky.</Text>
        {blockedAccounts.length ? blockedAccounts.map((blocked) => <View key={blocked.did} style={styles.blockedAccountRow}>
          <View style={{ flex: 1 }}><Text style={styles.accountIdentityValue}>{blocked.did}</Text><Text style={styles.meta}>Blocked {formatDate(blocked.createdAt)}</Text></View>
          <Pressable accessibilityRole="button" disabled={accountBusy} onPress={() => onUnblock(blocked.did)} style={styles.accountRemoveButton}><Text style={styles.action}>UNBLOCK</Text></Pressable>
        </View>) : <Text style={styles.emptyText}>You have not blocked any accounts</Text>}
      </View>}
      {page === 'storage' && <View style={styles.settingsCard}>
        <Text style={styles.accountDescription}>Images are kept on this device for 3 hours, up to 500 MB, so they load instantly. Clearing the cache only removes downloaded copies.</Text>
        <Text style={styles.settingsMetric}>{formatBytes(cacheBytes)}<Text style={styles.meta}>  OF {formatBytes(maxCacheBytes)} USED</Text></Text>
        <Pressable accessibilityRole="button" disabled={cacheClearing} onPress={onClearCache} style={styles.secondaryButton}><Text style={styles.action}>{cacheClearing ? 'CLEARING…' : 'CLEAR IMAGE CACHE'}</Text></Pressable>
      </View>}
      {page === 'legal' && <View style={styles.settingsCard}>
        <Text style={styles.accountDescription}>Last updated: October 11, 2026</Text>
        <Text style={styles.accountDescription}>Please email <Text accessibilityRole="link" style={styles.inlineLink} onPress={() => Linking.openURL('mailto:legal@coffeencode.cc')}>legal@coffeencode.cc</Text> for legal inquiries.</Text>
        <Text style={styles.accountProfileName}>Terms of Service</Text>
        <Text style={styles.accountDescription}>These terms apply when you use Coffee & Code, website or iOS app, or an account hosted by the Coffee & Code Personal Data Server (PDS).  By this, you agree to these terms. If you do not agree, please do not use the service and if you created an account on our PDS please delete it.</Text>
        <Text style={styles.accountDescription}>You may read the publication without an account. Sign-in uses an AT Protocol account and the PDS that hosts it. If you create or use an account hosted by Coffee & Code, you are responsible for keeping your sign-in credentials secure and for activity performed through your account. Do not share credentials or attempt to access another person’s account.</Text>
        <Text style={styles.accountDescription}>When you sign in with an account hosted by another provider, that provider’s terms and policies also apply. Coffee & Code does not control external PDS providers, Bluesky, or other independent AT Protocol services.</Text>
        <Text style={styles.accountDescription}>You retain responsibility for content and records you create. When you use account features, the site may write likes, dislikes, views, saves, recommendations, comments, replies, and related records to your AT Protocol repository as described in the permissions shown by your account provider. These records are public, and may be copied, indexed, or displayed by other services on the network. Do not submit content or personal information that you do not want to be public.</Text>   
        <Text style={styles.accountDescription}>Coffee & Code is free for everyone and is inexpensive to run, this does not mean you can missuse/abuse this service. This includes attempting to disrupt, damage, or gain unauthorized access to the site, PDS, accounts, or network; interfering with another person’s use; sending malicious code or spam; or using the services for unlawful, deceptive, abusive, or rights-infringing activity.</Text>
        <Text style={styles.accountDescription}>The site and PDS are provided as available. Features may change, be interrupted, or be discontinued. We may suspend or limit access when reasonably necessary to protect users, the services, or the network, to address misuse or security issues, or to comply with law. We will make reasonable efforts to provide notice where practical.</Text>
        <Text style={styles.accountDescription}>The AT Protocol is a distributed network. Records removed from your repository may remain in copies held by other services, and Coffee & Code cannot control how independent services process or display them. Links to or integrations with third-party services are provided for convenience and are subject to those services’ own terms and policies.</Text>
        <Text style={styles.accountDescription}>To the extent permitted by applicable law, the services are provided without warranties of any kind. The Coffee & Code publication is not responsible for the acts or services of independent PDS providers or other network participants. Nothing in these terms excludes or limits liability that cannot legally be excluded or limited.</Text>
        <Text style={styles.accountProfileName}>Privacy Policy</Text>
        <Text style={styles.accountDescription}>Coffee & Code does and will never share, sell or rent your personal data.</Text>
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
