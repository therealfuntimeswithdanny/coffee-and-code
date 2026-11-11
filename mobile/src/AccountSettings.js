import React, { useState } from 'react';
import { Image, Linking, Pressable, ScrollView, Text, View } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { C, styles } from './theme';
import { formatDate } from './utils';

const pages = [
  { id: 'account', title: 'AT Proto & security', subtitle: 'Your identity and sign-in', icon: 'person.crop.circle' },
  { id: 'reading', title: 'Reading activity', subtitle: 'Recently read and saved stories', icon: 'book' },
  { id: 'blocked', title: 'Blocked accounts', subtitle: 'Manage accounts you blocked', icon: 'hand.raised' },
  { id: 'privacy', title: 'Privacy', subtitle: 'How Coffee & Code uses your data', icon: 'hand.raised.slash' },
  { id: 'about', title: 'About', subtitle: 'App version and publication details', icon: 'info.circle' },
];

function SettingsRow({ icon, title, subtitle, onPress, destructive = false }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={styles.settingsRow}>
    <View style={styles.settingsIcon}><SymbolView name={icon} size={17} tintColor={destructive ? C.error : C.muted} /></View>
    <View style={styles.settingsCopy}><Text style={[styles.authorName, destructive && { color: C.error }]}>{title}</Text>{!!subtitle && <Text style={styles.meta}>{subtitle}</Text>}</View>
    <SymbolView name="chevron.right" size={15} tintColor={C.muted} />
  </Pressable>;
}

export default function AccountSettings({ account, accountProfile, accountPds, blockedAccounts, savedCount, viewedCount, accountBusy, onBack, onUnblock, onSignOut }) {
  const [page, setPage] = useState(null);
  const selected = pages.find((item) => item.id === page);
  return <ScrollView contentContainerStyle={styles.content}>
    <Pressable accessibilityRole="button" onPress={selected ? () => setPage(null) : onBack} style={styles.backLink}>
      <Text style={styles.action}>‹  {selected ? 'SETTINGS' : 'ACCOUNT'}</Text>
    </Pressable>
    <Text style={[styles.pageTitle, { marginTop: 0 }]}>{selected?.title || 'Settings'}</Text>
    {selected ? <>
      {page === 'account' && <View style={styles.accountCard}>
        {accountProfile?.avatar ? <Image source={{ uri: accountProfile.avatar }} style={styles.accountProfileAvatar} /> : <View style={styles.accountAvatar}><SymbolView name="person.fill" size={25} tintColor={C.ink} /></View>}
        <Text style={styles.accountProfileName}>{accountProfile?.displayName || accountProfile?.handle || 'Your account'}</Text>
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
        <Text style={styles.accountDescription}>Blocked accounts won’t appear in your Coffee & Code interactions.</Text>
        {blockedAccounts.length ? blockedAccounts.map((blocked) => <View key={blocked.did} style={styles.blockedAccountRow}>
          <View style={{ flex: 1 }}><Text style={styles.accountIdentityValue}>{blocked.did}</Text><Text style={styles.meta}>Blocked {formatDate(blocked.createdAt)}</Text></View>
          <Pressable accessibilityRole="button" disabled={accountBusy} onPress={() => onUnblock(blocked.did)} style={styles.accountRemoveButton}><Text style={styles.action}>UNBLOCK</Text></Pressable>
        </View>) : <Text style={styles.emptyText}>No blocked accounts.</Text>}
      </View>}
      {page === 'privacy' && <View style={styles.settingsCard}>
        <Text style={styles.accountDescription}>Coffee & Code uses your AT Protocol identity to sync saved stories, reading activity, reactions, and comments when you choose to sign in.</Text>
        <Text style={styles.accountDescription}>Your password stays with your identity provider. You can review and revoke the permissions granted to Coffee & Code through your provider.</Text>
      </View>}
      {page === 'about' && <View style={styles.settingsCard}>
        <Text style={styles.accountProfileName}>Coffee & Code</Text>
        <Text style={styles.accountDescription}>Independent technology journalism, built on the AT Protocol.</Text>
        <Text style={styles.accountIdentityLabel}>SIGNED IN AS</Text><Text style={styles.accountIdentityValue}>@{accountProfile?.handle || 'Unknown'}</Text>
        <Text style={styles.accountIdentityLabel}>PERSONAL DATA SERVER</Text><Text selectable style={styles.accountIdentityValue}>{accountPds || 'Unavailable'}</Text>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL('https://coffeencode.cc')} style={styles.profileLink}><Text style={styles.action}>VISIT COFFEE & CODE  ↗</Text></Pressable>
      </View>}
    </> : <View style={styles.settingsCard}>
      {pages.map((item) => <SettingsRow key={item.id} {...item} onPress={() => setPage(item.id)} />)}
    </View>}
  </ScrollView>;
}
