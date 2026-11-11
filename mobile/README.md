# Coffee & Code for iOS

This is the native iOS client for the Coffee & Code publication. It uses Expo and React Native and reads public stories from `https://coffeencode.cc/api`.

## Run on iPhone or simulator

1. Install a current Node.js LTS release.
2. From the repository root, run `npm run mobile:install` once to install the iOS app dependencies.
3. From the repository root, run `npm run ios` to build the native development app and launch it in the Xcode simulator or Device Hub.
4. To test the public reading experience in Expo Go, run `npm start` from `mobile` (or `npm start` from the repository root), then scan the QR code. For the native OAuth flow, run `npm run start:dev-client` and open the installed Coffee & Code development app.
5. For a standalone TestFlight beta, from `mobile` run `npx eas-cli@latest login` and `npx eas-cli@latest init` once to link the EAS project. Then run `npx eas-cli@latest build --platform ios --profile production`. After App Store Connect has an app record and the build is ready, submit it with `npx eas-cli@latest submit --platform ios --latest`.

The root `npm install` installs the web app dependencies. The iOS app has its own dependencies under `mobile`.

This project uses Expo SDK 58 and a native AT Protocol OAuth module. Expo Go can load the public stories, archive, and device saved-story features; account sign-in, reactions, and comments require the Coffee & Code development build because Expo Go does not include that native module.

The production/TestFlight profile is a store build: it embeds the JavaScript bundle and calls the publication's public HTTPS API, so it does not need to discover Metro on the local network. TestFlight distribution requires Apple Developer Program membership; testing on your own device directly from Xcode can use a free Personal Team.

The app includes latest and pinned stories, the archive with topic filters and search, contributor lists, device and account saved stories, native AT Protocol sign-in, and an article reader with public metrics, reactions, and comments. OAuth metadata is hosted by the publication at `/oauth-client-metadata-mobile.json` and `/oauth-client-metadata-author-mobile.json`.

