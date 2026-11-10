# Coffee & Code for iOS

This is the native iOS client for the existing Coffee & Code publication. It uses Expo and React Native and reads public stories from `https://coffeencode.cc/api`.

## Run on iPhone or simulator

1. Install a current Node.js LTS release.
2. From this folder, run `npm install`.
3. Run `npm run ios` to launch the iOS simulator, or `npm start` and scan the QR code with Expo Go on an iPhone.

The first version includes the latest story feed, pull to refresh, and a native reading view. It uses the existing `/api/home` and `/api/documents/:rkey.md` endpoints. Sign in, comments, and reactions can be added as the next app features.
