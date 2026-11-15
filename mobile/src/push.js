import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { getApiBase, log } from './developer';

const PUSH_TOKEN_KEY = 'coffee-and-code:push-token';
const PUSH_TOKEN_DID_KEY = 'coffee-and-code:push-token-did';

// Show notifications while the app is in the foreground so replies and likes
// still surface when the user is on another tab.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function postRegistration(path, did, token) {
  const response = await fetch(`${getApiBase()}/push/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ did, token }),
  });
  if (!response.ok) throw new Error(`Push ${path} failed (${response.status}).`);
}

// Requests permission and registers this device's Expo push token against the
// signed-in account. Safe to call on every sign-in; the Worker upserts by token.
export async function registerForPushNotifications(did, storage) {
  try {
    if (!Device.isDevice) {
      log.info('Push registration skipped', 'simulators cannot receive remote notifications');
      return null;
    }
    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== 'granted') status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== 'granted') {
      log.info('Push registration skipped', 'notification permission not granted');
      return null;
    }
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    const [storedToken, storedDid] = await Promise.all([
      storage.getItem(PUSH_TOKEN_KEY),
      storage.getItem(PUSH_TOKEN_DID_KEY),
    ]);
    if (storedToken === token && storedDid === did) return token;
    await postRegistration('register', did, token);
    await Promise.all([
      storage.setItem(PUSH_TOKEN_KEY, token),
      storage.setItem(PUSH_TOKEN_DID_KEY, did),
    ]);
    log.info('Push registration', `registered token for ${did}`);
    return token;
  } catch (error) {
    log.warn('Push registration failed', error?.message);
    return null;
  }
}

export async function unregisterForPushNotifications(storage) {
  try {
    const [token, did] = await Promise.all([
      storage.getItem(PUSH_TOKEN_KEY),
      storage.getItem(PUSH_TOKEN_DID_KEY),
    ]);
    if (!token || !did) return;
    await postRegistration('unregister', did, token);
  } catch (error) {
    log.warn('Push unregistration failed', error?.message);
  } finally {
    await Promise.all([
      storage.removeItem(PUSH_TOKEN_KEY),
      storage.removeItem(PUSH_TOKEN_DID_KEY),
    ]).catch(() => {});
  }
}

// Subscribe to notification taps. The handler receives the notification's
// response and can navigate the app; returns an unsubscribe function.
export function onNotificationResponse(handler) {
  const subscription = Notifications.addNotificationResponseReceivedListener(handler);
  return () => subscription.remove();
}
