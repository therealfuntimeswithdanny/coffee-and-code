# Coffee & Code for iOS

This is the native iOS client for the Coffee & Code publication. It uses Expo and React Native and reads public stories from `https://coffeencode.cc/api`.

## Run on iPhone or simulator

1. Install a current Node.js LTS release.
2. From the repository root, run `npm run mobile:install` once to install the iOS app dependencies.
3. From the repository root, run `npm run ios` to build the native iOS app and launch it in the Xcode simulator or Device Hub.

The root `npm install` installs the web app dependencies. The iOS app has its own dependencies under `mobile`.

This project uses Expo SDK 58 and native AT Protocol OAuth modules. Use the iOS simulator or install a development build on a device; Expo Go cannot load the native OAuth modules.

The app includes latest and pinned stories, the archive with topic filters and search, contributor lists, device and account saved stories, native AT Protocol sign-in, and an article reader with public metrics, reactions, and comments. OAuth metadata is hosted by the publication at `/oauth-client-metadata-mobile.json` and `/oauth-client-metadata-author-mobile.json`.

