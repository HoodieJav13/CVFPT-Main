// Which Add-to-Home-Screen steps fit this phone + browser. Pure (no imports,
// no globals) so backend/test/install-guide.test.js can run it against real
// user-agent strings.
//
// 'ios-safari'    Safari's Share → Add to Home Screen
// 'ios-chrome'    Chrome's Share (address bar) → Add to Home Screen
// 'ios-other'     can't install here (in-app browser, Firefox, …) → open in Safari
// 'android'       browser menu → Add to Home screen / Install app
// 'android-inapp' in-app webview (Instagram, Facebook, …) → open in Chrome
// null            not a phone or tablet: nothing to guide

const IN_APP = /FBAN|FBAV|FB_IAB|FBIOS|Instagram|Line\/|LinkedInApp|Snapchat|musical_ly|TikTok|Twitter|MicroMessenger|GSA\//;
const IOS_NON_SAFARI = /FxiOS|EdgiOS|OPiOS|OPT\/|YaBrowser|DuckDuckGo/;

export function detectInstallGuide({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ios = /iPad|iPhone|iPod/.test(userAgent)
    || (platform === 'MacIntel' && maxTouchPoints > 1); // iPadOS masquerades as macOS
  const android = /Android/i.test(userAgent);
  if (!ios && !android) return null;
  if (ios) {
    if (IN_APP.test(userAgent) || IOS_NON_SAFARI.test(userAgent)) return 'ios-other';
    if (/CriOS\//.test(userAgent)) return 'ios-chrome';
    return 'ios-safari';
  }
  if (IN_APP.test(userAgent) || /; wv\)/.test(userAgent)) return 'android-inapp';
  return 'android';
}
