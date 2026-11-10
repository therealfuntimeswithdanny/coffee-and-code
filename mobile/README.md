# Coffee & Code for iOS

This is the native iOS client for the Coffee & Code publication. It uses Expo and React Native and reads public stories from `https://coffeencode.cc/api`.

## Run on iPhone or simulator

1. Install a current Node.js LTS release.
2. From the repository root, run `npm run mobile:install` once to install the iOS app dependencies.
3. From the repository root, run `npm run ios` to start Expo and open the iOS simulator in Device Hub (Xcode 27).

The root `npm install` installs the web app dependencies. The iOS app has its own dependencies under `mobile`.

This project uses Expo SDK 58. The Expo Go app from the iOS App Store does not support this SDK on a physical iPhone; use the iOS simulator or create a development build for a device.

The app includes latest stories, a full archive with topic filters and search, a contributor directory and story lists, persistent saved stories, and a native article reader with images, links, headings, lists, quotes, and code blocks. Article pages show public reading and reaction counts plus the comment thread; posting reactions and comments is still done on the website. It uses the publication's existing public APIs without changing the web copy.

The app currently reads public content without an account. Account sign-in, comments, and reactions are not included in this iOS client yet.
