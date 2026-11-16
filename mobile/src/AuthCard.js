import React from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import Constants from 'expo-constants';
import { C, styles } from './theme';

const IS_EXPO_GO = Constants.appOwnership === 'expo';

/** Signed-out account card: AT Protocol handle sign-in plus hosted-PDS account creation.
 *  Shared by the Account tab and the Welcome flow. Pass view='signin' or view='create'
 *  to show only that section. */
export default function AuthCard({
  loginHandle, onChangeHandle, onLogin, accountBusy, error,
  inviteCode, inviteError, inviteLoading, onGetInviteCode, onContinueAccountCreation,
  view,
}) {
  return <View style={styles.accountCard}>
    {view !== 'create' && <>
      <Text style={styles.accountDescription}>Sign in with your AT Protocol account. Your provider handles the password and shows the permissions requested by Coffee & Code.</Text>
      {IS_EXPO_GO ? <Text style={styles.accountDescription}>Expo Go supports reading the live publication API. AT Protocol sign-in and member actions need the Coffee & Code development app because they use a native OAuth module.</Text> : <>
        <Text style={styles.fieldLabel}>Typically what you use to sign into orther At proto apps, Bluesky, Pckt, Leaflet, Anisota, rpg.actor, etc</Text>
        <TextInput value={loginHandle} onChangeText={onChangeHandle} placeholder="john-doe.coffeencode.cc or johndoe.com." placeholderTextColor={C.muted} autoCapitalize="none" autoCorrect={false} keyboardType="url" returnKeyType="go" onSubmitEditing={onLogin} style={styles.searchInput} accessibilityLabel="AT Protocol handle" />
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable accessibilityRole="button" disabled={accountBusy} onPress={onLogin} style={styles.primaryButton}>{accountBusy ? <ActivityIndicator color={C.bg} /> : <Text style={styles.primaryButtonText}>Sign in</Text>}</Pressable>
        <Text style={styles.privacyNote}>Coffee & Code never asks for or stores your password.</Text>
      </>}
    </>}
    {view !== 'signin' && <View style={styles.createAccountCard}>
        <Text style={styles.accountProfileName}>New to Coffee & Code?</Text>
        <Text style={styles.accountDescription}>Create an account on our PDS (your gateway to thounds of apps, including Bluesky).</Text>
        {IS_EXPO_GO && <Text style={styles.accountDescription}>You can get the code here, then continue signup in the Coffee & Code development app.</Text>}
        {!!error && <Text accessibilityRole="alert" style={styles.error}>{error}</Text>}
        {!!inviteError && <Text accessibilityRole="alert" style={styles.error}>{inviteError}</Text>}
        {!inviteCode ? <Pressable accessibilityRole="button" disabled={inviteLoading} onPress={onGetInviteCode} style={styles.secondaryButton}>
          {inviteLoading ? <ActivityIndicator color={C.muted} /> : <Text style={styles.action}>CREATE ACCOUNT</Text>}
        </Pressable> : <>
          <Text style={styles.fieldLabel}>Copy this code, you will need this to continue your signup. We do this to prevent abuse and bot attacks</Text>
          <Text selectable style={styles.inviteCode}>{inviteCode}</Text>
          <Pressable accessibilityRole="button" disabled={accountBusy} onPress={onContinueAccountCreation} style={[styles.primaryButton, styles.inviteContinue]}>
            {accountBusy ? <ActivityIndicator color={C.bg} /> : <Text style={styles.primaryButtonText}>CONTINUE TO SIGNUP  →</Text>}
          </Pressable>
        </>}
    </View>}
  </View>;
}
