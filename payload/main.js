// Yapper desktop: a window around www.yapper.website with the things a browser tab can't do well:
// a tray icon, "start minimised", notifications that open the right chat, screen sharing without
// the browser's picker, yapper:// links, and updates that install themselves (GitHub releases).
var { app, BrowserWindow, Menu, Tray, nativeImage, shell, session, desktopCapturer, ipcMain, Notification, nativeTheme, dialog } = require('electron');
var path = require('node:path');
var fs = require('node:fs');
var { autoUpdater } = require('electron-updater');

var SITE = 'https://www.yapper.website';
var ALLOWED = new Set(['www.yapper.website', 'yapper.website', 'rt.yapper.website', 'lk.yapper.website']);
var ICON = path.join(__dirname, 'build', 'icon.png');

// ---- theme -------------------------------------------------------------
// The site is entirely variable-driven: --bg-* surfaces, --text* type, and
// --accent* highlights, all redefined per [data-theme]. So a custom look is
// just overriding those vars; no DOM poking needed.
//
// Settings are persisted to userData and editable from the "Yapper Mod" tab
// injected into the app's own settings panel.
// Everything the mod changes lives here, is persisted to userData, and is
// editable from the "Yapper Mod" tab injected into the app's own settings.
var DEFAULTS = {
  fallback: false,  // broken images (avatars, server banners) become the logo
  hue: '#ffffff',   // the single colour everything derives from
  text: '#f4f4f5',  // primary text
  logger: false,    // tint the author red + tag it when a message is deleted
  nametag: false,   // show messages as displayname(username)
  customCss: false, // load custom.css from userData and append it
  aboutClamp: false, // clamp long "About me" bios to 4 lines behind a Read more
  forceOne: false,   // force a single accent colour (plus optional text colour)
  forceAccent: '#5865f2',
  forceText: '#f4f4f5',
  decoFile: '',
  bgMode: false,     // show a background behind the app
  bgKind: 'image',   // 'image' or 'video'
  bgFile: '',
  bgBlur: 14,        // px of blur applied to the backdrop media
  bgDim: 0.28,       // black scrim over the backdrop (lower = more visible)
  folderIcons: {},   // { folderName: 'file.png' } custom icon per native rail folder
  folderColours: {},// { folderName: 'rgba(...)' } custom colour per native rail folder
  groups: '',        // per line: Name | icon.png | server, server
  emojiCodes: true,     // turn :shortcode: into the real emoji
  silentTyping: false,  // suppress the typing indicator sent to other people
  collapsed: '',     // comma separated group names that are folded shut
  svgIcons: false,  // swap the member-count emoji for a real SVG
  allOnline: false, // show offline members as if they were online
  cycleColors: false, // smoothly cycle the forced colour
  winhawkWarned: false, // the Winhawk transparency notice has been shown
  randomColor: false,  // pick a random forced colour each time
  adblock: true,     // scrub tracking junk out of outbound links
  noTrack: true,     // refuse telemetry and crash-report requests
  reduceMotion: false, // strip animations and transitions
  compactMode: false,  // tighten message spacing
  emojiSize: 0,      // 0 = leave emoji alone, otherwise px tall
  timestamp24: false, // message times on a 24 hour clock
  msgFont: 0,      // 0 = app default, otherwise px for message text
  hideActions: false, // message buttons only show on hover
  fancyName: false,   // author names in a gradient
  autoDelete: 0,      // seconds before a bot message fades out, 0 = never
  externalLinks: false, // open web links in the system browser
  noDeleteKey: false, // Delete stops jumping between channels
};
var SECTIONS = {
  look: 'Appearance',
  msg: 'Messaging',
  profile: 'Profile & presence',
  ui: 'Interface',
};
var TOGGLES = [
  { key: 'fallback', label: 'Media placeholders', hint: 'Substitute the Yapper mark when an image cannot load', group: 'look', restart: true },
    { key: 'bgMode', label: 'Backdrop media', hint: 'Render an image or looping video behind the interface', group: 'look' },
  { key: 'cycleColors', label: 'Ambient transitions', hint: 'Fade between colour changes instead of cutting', group: 'look' },
  { key: 'logger', label: 'Message logger', hint: 'Mark removed messages and tint their author', group: 'msg', wip: true },
  { key: 'nametag', label: 'Author identity', hint: 'Render authors as displayname(username)', group: 'msg' },
  { key: 'allOnline', label: 'Unified presence', hint: 'Present every member as available', group: 'profile', wip: true },
  { key: 'silentTyping', label: 'Silent typing', hint: 'Type without showing a typing indicator to anyone else', group: 'profile', wip: true },
  { key: 'emojiCodes', label: 'Emoji shortcodes', hint: 'Turn :shortcodes: into the real emoji, including the iOS set', group: 'ui' },
  { key: 'svgIcons', label: 'Vector iconography', hint: 'Replace emoji glyphs with vector icons', group: 'ui' },
  { key: 'customCss', label: 'Custom stylesheet', hint: 'Append your own stylesheet to the theme', group: 'ui' },
  { key: 'timestamp24', label: '24 hour clock', hint: 'Message times as 14:05 rather than 2:05 PM', group: 'msg' },
  { key: 'compactMode', label: 'Compact messages', hint: 'Tighter spacing between messages', group: 'msg' },
  { key: 'emojiSize', label: 'Bigger emoji', hint: 'Scale up the emoji in messages', group: 'msg' },
  { key: 'adblock', label: 'Link cleaner', hint: 'Strip utm, fbclid and gclid tracking out of links', group: 'ui' },
  { key: 'noTrack', label: 'No tracking', hint: 'Block telemetry and crash reporting requests', group: 'ui' },
  { key: 'reduceMotion', label: 'Reduce motion', hint: 'Remove animations and transitions across the app', group: 'ui' },
  { key: 'hideActions', label: 'Hide message buttons', hint: 'Reactions, reply and more appear only on hover', group: 'msg' },
  { key: 'fancyName', label: 'Gradient names', hint: 'Render author names in a gradient', group: 'look' },
  { key: 'externalLinks', label: 'External links', hint: 'Open links in messages and embeds in your normal browser', group: 'ui' },
  { key: 'noDeleteKey', label: 'Stop Delete shortcut', hint: 'Stop Delete from jumping between channels', group: 'ui' },
];
var settingsFile = () => path.join(app.getPath('userData'), 'yapper-mod.json');
var settings = { ...DEFAULTS };
try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch { /* defaults */ }
var winhawkCssFile = () => path.join(app.getPath('userData'), 'winhawk.css');
// Base64 so the CSS never has to survive being embedded in the template
// literal that injects the theme - no quoting, no ${} surprises.
function readWinhawkCssB64() {
  try {
    return fs.readFileSync(winhawkCssFile()).toString('base64');
  } catch { return ''; }
}
try {
  if (!fs.existsSync(winhawkCssFile())) {
    fs.writeFileSync(winhawkCssFile(), '/* WINHAWK - transparent Yapper. Loaded while the Winhawk theme is on. */\n');
  }
} catch { /* no fs in this context, or a read-only profile */ }
var customCssFile = () => path.join(app.getPath('userData'), 'custom.css');
function readCustomCss() {
  if (!settings.customCss) return '';
  try { return fs.readFileSync(customCssFile(), 'utf8'); } catch { return ''; }
}
// Create it once so there is an obvious place to paste overrides.
try {
  if (!fs.existsSync(customCssFile())) {
    fs.mkdirSync(path.dirname(customCssFile()), { recursive: true });
    fs.writeFileSync(customCssFile(), '/* Yapper Mod - your CSS is appended after the theme. */\n');
  }
} catch { /* best effort */ }

function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile()), { recursive: true }); fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2)); } catch { /* best effort */ }
}
// Broken or missing avatars fall back to this instead of an empty hole.
var FALLBACK_LOGO = 'data:image/png;base64,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';

var decoPath = () => path.join(app.getPath('userData'), 'deco.gif');
var groupsDir = () => path.join(app.getPath('userData'), 'groups');
var folderIconsDir = () => path.join(app.getPath('userData'), 'folder-icons');
function mediaKind(file) {
  var ext = String(file || '').split('.').pop().toLowerCase();
  return ['mp4', 'webm', 'mov', 'm4v', 'ogv', 'mkv'].includes(ext) ? 'video' : 'image';
}
function bgExt() {
  var raw = String(settings.bgFile || '').split('.').pop().toLowerCase();
  return /^[a-z0-9]{2,5}$/.test(raw) ? raw : (settings.bgKind === 'video' ? 'mp4' : 'png');
}
var bgPath = () => path.join(app.getPath('userData'), 'background.' + bgExt());
// Resolve a folder's custom icon to a data URI so the renderer can drop it
// straight into an <img>. GIFs are served with their own mime so they animate.
function folderIconUri(folderName) {
  var map = settings.folderIcons || {};
  var file = map[String(folderName)];
  if (!file) return '';
  try {
    var buf = fs.readFileSync(path.join(folderIconsDir(), file));
    return 'data:' + mimeFor(file, 'image/png') + ';base64,' + buf.toString('base64');
  } catch { return ''; }
}
function bgDataUri() {
  if (!settings.bgMode || !settings.bgFile) return '';
  try {
    var b = fs.readFileSync(bgPath());
    var mime = mimeFor(settings.bgFile, settings.bgKind === 'video' ? 'video/mp4' : 'image/png');
    return 'data:' + mime + ';base64,' + b.toString('base64');
  } catch { return ''; }
}
function mimeFor(file, fallback) {
  var ext = String(file || '').split('.').pop().toLowerCase();
  var map = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp',
                gif: 'image/gif', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp' };
  return map[ext] || fallback;
}

function decoDataUri() {
  if (!settings.deco || !settings.decoFile) return '';
  try {
    var b = fs.readFileSync(decoPath());
    return 'data:image/gif;base64,' + b.toString('base64');
  } catch { return ''; }
}


var ICON_ATTR = "viewBox='0 0 24 24' width='1em' height='1em' fill='currentColor' aria-hidden='true' style='vertical-align:-0.15em'";
var wrapIcon = (d) => "<svg " + ICON_ATTR + "><path d='" + d + "'/></svg>";
var ICON_SVGS = {};
ICON_SVGS[String.fromCodePoint(0x1F4AC)] = wrapIcon('M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z');
ICON_SVGS[String.fromCodePoint(0x1F514)] = wrapIcon('M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z');
ICON_SVGS[String.fromCodePoint(0x1F464)] = wrapIcon('M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z');
ICON_SVGS[String.fromCodePoint(0x21C4)] = wrapIcon('M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z');
ICON_SVGS[String.fromCodePoint(0x2728)] = wrapIcon('M12 2l2.4 6.2L21 9.3l-5 4.4 1.4 6.8L12 17l-5.4 3.5L8 13.7 3 9.3l6.6-1.1L12 2z');
ICON_SVGS[String.fromCodePoint(0x1F451)] = wrapIcon('M5 18h14l2-9-5 3-4-7-4 7-5-3 2 9z');

function shade(hex, k) {
  var n = parseInt(String(hex).replace('#', ''), 16);
  if (Number.isNaN(n)) return 'rgb(0 0 0)';
  return 'rgb(' + Math.round(((n >> 16) & 255) * k) + ' '
                + Math.round(((n >> 8) & 255) * k) + ' '
                + Math.round((n & 255) * k) + ')';
}


var FOLDER_CLOSED = '<path d="M2 6a2 2 0 0 1 2-2h4.6l2 2.4H20a2 2 0 0 1 2 2V19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2z"/>';
var FOLDER_OPEN = '<path d="M2 6a2 2 0 0 1 2-2h4.6l2 2.4H20a2 2 0 0 1 2 2V11H7.4L2 20z"/><path d="M2 20l4.4-9H22l-4.4 9z"/>';
var folderIcon = (open) => '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true">' + (open ? FOLDER_OPEN : FOLDER_CLOSED) + '</svg>';

function rgbTriple(hex) {
  var n = parseInt(hex.replace('#', ''), 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
}

function glassCss() {
  var h = rgbTriple(settings.hue);
  // True black: every surface is #000, separation comes from translucent white
  // panels. Fully transparent bases were tried and are a dead end here - DWM
  // refused the acrylic material, so the desktop just bled through and left
  // every menu unreadable.
  return `
    :root, [data-theme="dark"], [data-theme="light"] {
      --bg-rail: ${settings.bgMode ? 'rgb(18 18 20 / 0.72)' : (settings.forceOne ? shade(settings.forceAccent, 0.09) : 'rgb(18 18 20)')};
      --bg-side: ${settings.bgMode ? 'rgb(24 24 27 / 0.74)' : (settings.forceOne ? shade(settings.forceAccent, 0.12) : 'rgb(24 24 27)')};
      --bg-main: ${settings.bgMode ? 'rgb(15 15 17 / 0.78)' : (settings.forceOne ? shade(settings.forceAccent, 0.06) : 'rgb(15 15 17)')};
      --bg-elev: rgb(${h} / 0.06);
      --bg-hover: rgb(${h} / 0.10);
      --bg-active: rgb(${h} / 0.16);
      --bg-input: rgb(${h} / 0.08);
      --text: ${settings.text};
      --text-muted: rgb(${h} / 0.62);
      --text-faint: rgb(${h} / 0.38);
      --border: rgb(${h} / 0.12);
      --accent: ${settings.hue};
      --accent-hover: ${settings.forceOne ? rgbTriple(settings.forceAccent).replace(/(\d+) (\d+) (\d+)/, (m, r2, g2, b2) => 'rgb(' + r2 + ' ' + g2 + ' ' + b2 + ' / 0.85)') : 'rgb(' + h + ' / 0.85)'};
      --accent-soft: rgb(${h} / 0.14);
      --on-accent: #000000;
      --shadow: 0 12px 48px rgb(0 0 0 / 0.55);
      --yapper-cycle: 1;
      --yapper-online: ${settings.allOnline ? '#43b581' : 'inherit'};
      transition: background-color .55s ease, color .55s ease, border-color .55s ease;
    }
    html, body { background: ${settings.bgMode ? 'transparent' : (settings.forceOne ? shade(settings.forceAccent, 0.06) : 'rgb(15 15 17)')} !important; }
    #yapperBg, #yapperBgDim { position: fixed; inset: 0; pointer-events: none; z-index: -1; }
    #yapperBg { background-size: cover; background-position: center; background-repeat: no-repeat; }
    #yapperBg video, #yapperBg img { width: 100%; height: 100%; object-fit: cover; }
    /* Blur the backdrop so it reads as depth rather than a distracting image. */
    #yapperBg { filter: blur(${settings.bgBlur != null ? settings.bgBlur : 14}px); transform: scale(1.06); }
    #yapperBgDim { background: rgb(0 0 0 / ${settings.bgDim ?? 0.28}); }
    /* The app paints its own translucent panels (.main 78%, .rail 72%) over the
       backdrop, which crushed it to near black. Lift them when a backdrop is on
       so the media is actually visible through them. */
    ${settings.bgMode ? `.main, .chat-wrap, .members, .messages, .modal, .popover {
      /* Kept deliberately light. The media is already blurred by #yapperBg, so
         a heavy backdrop-filter here blurred it a SECOND time and the picture
         turned to mush. A touch of extra blur for legibility is all this needs. */
      background-color: rgba(20, 20, 24, 0.28) !important;
      backdrop-filter: blur(3px) saturate(1.2);
      -webkit-backdrop-filter: blur(3px) saturate(1.2);
    }
    /* Deliberately NOT backdrop-filter on .rail: that creates a stacking
       context, which traps the app's .ctx-menu (z-index 60) inside the rail
       and lets the sidebar paint over it. Tint the rail only. */
    .rail { background-color: rgba(20, 20, 24, 0.42) !important; }` : ''}
    ${settings.fallback ? 'img[data-yapper-fallback] { border-radius: inherit; object-fit: cover; background: rgb(' + h + ' / 0.08); }' : ''}
    /* Menus and dialogs must stay readable no matter how transparent the rest
       of the app gets, so they always get their own blurred, near-opaque
       backing rather than inheriting the see-through panels. Deliberately
       unconditional: this holds even with no backdrop media at all. */
    .ctx-menu, .modal, .popover, .dropdown-menu, [class*="dd-menu"],
    [class*="dropdown"], [class*="menu-panel"], .toast-yapper {
      background-color: rgba(18, 18, 22, 0.88) !important;
      backdrop-filter: blur(18px) saturate(1.2) !important;
      -webkit-backdrop-filter: blur(18px) saturate(1.2) !important;
    }
    /* ---- Winhawk: a transparent base, not transparent windows ----
       Only the page background goes clear, so whatever sits behind the app
       shows through the gaps around it. Panels, modals and menus keep their
       own solid backing, otherwise every window turned see-through and the
       text became unreadable. This is the transparent equivalent of the
       Monochrome surfaces option. */
    html[data-ym-theme="winhawk"],
    html[data-ym-theme="winhawk"] body {
      background: transparent !important;
    }
    .yapper-deleted-author { color: #ff4d4d !important; }
    /* A deleted message stays readable and simply goes red: every piece of
       text in it, plus any image, video or audio that travelled with it. */
    .msg.yapper-deleted .msg-text,
    .msg.yapper-deleted .msg-content,
    .msg.yapper-deleted .msg-author,
    .msg.yapper-deleted .msg-time,
    .msg.yapper-deleted .msg-attachment-name,
    .msg.yapper-deleted a {
      color: #ff4d4d !important;
      /* The app wins the colour cascade outright here - even an inline
         !important on the element is ignored - so the red is painted with a
         filter, which is what actually takes effect. */
      filter: sepia(1) saturate(9) hue-rotate(-45deg) brightness(.92);
    }
    .msg.yapper-deleted img,
    .msg.yapper-deleted video,
    .msg.yapper-deleted canvas {
      filter: grayscale(1) sepia(1) saturate(7) hue-rotate(-45deg) brightness(.72) !important;
      opacity: .8 !important;
    }
    .yapper-uid { opacity: .62; font-weight: 500; }
    ${settings.allOnline ? `.members-panel .pick-row.offline,
    .members-panel .pick-row.offline .pick-row-name,
    .members-panel .pick-row.offline .pick-row-role { opacity: 1 !important; }
    /* idle and dnd are amber and red. Make every presence state read as the
       plain green online dot so nobody looks away or busy. */
    .status-dot.offline, .status-dot.idle, .status-dot.dnd {
      background: #43b581 !important;
    }
    /* offline draws a grey inset ring; swap it for the outer ring an online
       dot has so the two are indistinguishable. */
    .status-dot.offline {
      box-shadow: 0 0 0 3px var(--bg-main) !important;
    }` : ''}
    /* Colour only ever lands on the BACKGROUND. It is applied with
       background-color, which paints underneath the folder's own artwork and
       its member server icons, so no icon is ever recoloured or made
       transparent. The slider drives the mix weight: 0% leaves the rail
       background fully transparent, 100% makes it the full chosen colour. */
    .rail-item.rail-folder[data-yapper-folder-tinted="1"] {
      background-color: color-mix(in srgb,
        var(--yapper-folder-tint) calc(var(--yapper-folder-strength, 22) * 1%),
        transparent) !important;
    }
    .rail-item.rail-folder[data-yapper-folder-custom="1"] {
      background-image: var(--yapper-folder-bg, none) !important;
      background-size: cover !important;
      background-position: center !important;
      background-repeat: no-repeat !important;
    }
    /* Expanded, the app builds a full-height plate (.rail-folder-open) behind
       the folder and its server icons. Same treatment: background-color only,
       never an overlay, so the icons on top stay untouched. React recreates
       this wrapper on every expand, which is why the vars are re-asserted on
       each sweep. */
    .rail-folder-open[data-yapper-folder-tinted="1"]::before {
      background-color: color-mix(in srgb,
        var(--yapper-folder-tint) calc(var(--yapper-folder-strength, 22) * 1%),
        transparent) !important;
    }
    /* Once a custom image is set, the stock folder glyph has nothing left to
       describe, so drop it and var the image be the folder's face. */
    .rail-item.rail-folder[data-yapper-folder-icon-only="1"] > svg {
      display: none !important;
    }
    /* The member icons must remain visible: only the stock folder glyph goes. */
    .yapper-hint-icon { margin-right: 4px; display: inline-flex; vertical-align: -0.15em; }
    /* Scope the colour cycle to the things that actually change colour. A bare
       '*' rule puts a transition on every element in the app, which forces the
       compositor to watch thousands of nodes and makes the UI feel laggy. */
    ${settings.cycleColors ? `.rail, .rail *, .messages, .messages *, .msg, .msg *, .msg-author, .avatar {
      transition: background-color .55s ease, color .55s ease, border-color .55s ease;
    }` : ''}
    .yapper-deleted-tag {
      margin-left: 6px; padding: 1px 6px; border-radius: 999px;
      background: rgb(255 77 77 / 0.18); color: #ff6b6b;
      font-size: 10px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase;
      -webkit-text-fill-color: #ff6b6b; vertical-align: middle;
    }
    .yapper-about-clamp {
      display: -webkit-box !important; -webkit-line-clamp: 4; -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .yapper-about-open { display: block !important; -webkit-line-clamp: unset !important; overflow: visible; }
    .yapper-readmore {
      margin-top: 6px; padding: 0; border: 0; background: none; cursor: pointer;
      font-family: inherit; font-size: 13px; font-weight: 700; color: var(--accent);
    }
    .yapper-readmore:hover { text-decoration: underline; }
    ${settings.reduceMotion ? `*, *::before, *::after {
      animation-duration: 0s !important;
      animation-delay: 0s !important;
      transition-duration: 0s !important;
      transition-delay: 0s !important;
    }
    html { scroll-behavior: auto !important; }` : ''}
    ${settings.compactMode ? `.msg { margin-bottom: 1px !important; }
    .msg + .msg { margin-top: 0 !important; }
    .msg-text { line-height: 1.22 !important; }
    .msg-head { margin-bottom: 1px !important; }` : ''}
    ${settings.emojiSize ? `.msg-text img[data-ym-emoji="1"],
    .msg-content img[data-ym-emoji="1"] {
      height: ${Number(settings.emojiSize)}px !important;
      width: auto !important;
      max-width: none !important;
      vertical-align: middle;
    }` : ''}
    ${settings.msgFont ? `.msg-text, .msg-content, .msg-author, .msg-time, .msg-head {
      font-size: ${Number(settings.msgFont)}px !important;
      line-height: ${Math.round(Number(settings.msgFont) * 1.42)}px !important;
    }` : ''}
    ${settings.hideActions ? `.msg-actions {
      opacity: 0 !important; pointer-events: none;
      transition: opacity .12s linear;
    }
    .msg:hover .msg-actions, .msg:focus-within .msg-actions {
      opacity: 1 !important; pointer-events: auto;
    }` : ''}
    ${settings.fancyName ? `.msg-author {
      background-image: linear-gradient(90deg, #ff6b6b 0%, #ffd166 25%, #7ee787 50%, #79c0ff 75%, #d2a8ff 100%) !important;
      -webkit-background-clip: text !important;
      background-clip: text !important;
      -webkit-text-fill-color: transparent !important;
      color: transparent !important;
    }` : ''}
    ${settings.autoDelete ? `.msg[data-ym-fade="1"] {
      opacity: .18 !important;
      transition: opacity .6s ease;
      pointer-events: none;
    }` : ''}
    ${readCustomCss()}
  `;
}

var PLACEHOLDER = (() => {
  try { return customCssFile().replace(/\\/g, '\\\\'); } catch { return 'custom.css'; }
})();
var CSS_PATH = (() => {
  try { return 'Saved to ' + customCssFile(); } catch { return 'Saved to custom.css'; }
})();

function surfaceBox() {
  var row = 'display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;';
  return '<div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--border)">'
    + '<div style="font-size:14px;font-weight:600;margin-bottom:10px">Surfaces</div>'
    + '<label style="' + row + 'cursor:pointer">'
      + '<input type="checkbox" data-mod-key="forceOne"' + (settings.forceOne ? ' checked' : '')
      + ' style="width:17px;height:17px;accent-color:#fff;cursor:pointer">'
      + '<span><span style="display:block;font-size:14px;font-weight:600">One surfaces color</span>'
      + '<span style="display:block;font-size:12px;color:var(--text-muted)">Derive every surface from a single colour</span></span></label>'
    + '<label style="' + row + 'justify-content:space-between">'
      + '<span><span style="display:block;font-size:14px;font-weight:600">Forced colour</span>'
      + '<span style="display:block;font-size:12px;color:var(--text-muted)">Every surface is mixed from this</span></span>'
      + '<input type="color" data-mod-key="forceAccent" value="' + String(settings.forceAccent || '#5865f2') + '"'
      + ' title="Forced surface colour" aria-label="Forced surface colour"'
      + ' style="width:34px;height:34px;padding:0;border:1px solid var(--border);border-radius:8px;'
      + 'background:none;cursor:pointer;flex:0 0 auto">'
    + '</label>'
    + '</div>';
}

function panelBits() {
  var PANEL = panelHtml();
  // panelHtml wraps everything in #yapperModPanel; the overlay element
  // supplies that wrapper itself, so hand back only the contents.
  var open = PANEL.indexOf('>') + 1;
  var close = PANEL.lastIndexOf('</div>');
  return PANEL.slice(open, close);
}

function panelHtml() {
  var row = 'display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--border);border-radius:var(--radius);margin-bottom:8px;';
  var one = (t) => {
    var badge = (label) => ' <span style="display:inline-block;margin-left:6px;padding:1px 6px;'
      + 'border-radius:999px;background:rgb(255 255 255 / 0.10);color:var(--text-muted);font-size:10px;'
      + 'font-weight:800;letter-spacing:.04em;text-transform:uppercase;vertical-align:1px">' + label + '</span>';
    // Work in progress: shown greyed out and not clickable, so it is clear the
    // option exists but is not finished rather than looking like a dead toggle.
    var style = t.wip
      ? 'opacity:.45;cursor:not-allowed;filter:saturate(0)'
      : 'cursor:pointer';
    var input = '<input type="checkbox" data-mod-key="' + t.key + '"'
      + (settings[t.key] ? ' checked' : '')
      + (t.wip ? ' disabled' : '')
      + ' style="width:17px;height:17px;accent-color:#fff;'
      + (t.wip ? 'cursor:not-allowed;pointer-events:none;' : 'cursor:pointer;') + '">';
    return '<label style="' + row + style + '">' + input
      + '<span><span style="display:block;font-size:14px;font-weight:600">' + t.label
      + (t.restart ? badge('Restart') : '')
      + (t.wip ? badge('Work in progress') : '')
      + '</span>'
      + '<span style="display:block;font-size:12px;color:var(--text-muted)">' + t.hint
      + (t.wip ? ' Not finished yet.' : '')
      + (t.restart ? ' Takes effect after you restart Yapper.' : '') + '</span></span></label>';
  };
  var order = ['look', 'msg', 'profile', 'ui'];
  var boxes = order.map((g) => {
    var items = TOGGLES.filter((t) => t.group === g);
    if (!items.length) return '';
    return '<div style="font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;'
      + 'color:var(--text-faint);margin:18px 0 8px">' + (SECTIONS[g] || g) + '</div>'
      + items.map(one).join('');
  }).join('');
  // Show the value that is really applied. Rounding to a whole number made the
  // readout claim "2" while 1.5 was in use. Declared (not assigned) because the
  // panel renders before this point in the file is reached.
  function sliderText(v, step) {
    return (step && step < 1) ? (Math.round(Number(v) * 10) / 10).toFixed(1) : String(v);
  }
  // A labelled range slider that writes straight back to settings.
  var slider = (key, label, lo, hi, value, step) =>
    '<label style="display:flex;align-items:center;gap:12px;padding:9px 12px;border:1px solid var(--border);'
    + 'border-radius:var(--radius);margin-bottom:8px;justify-content:space-between;">'
    + '<span style="font-size:14px;font-weight:600">' + label + '</span>'
    + '<span style="display:flex;align-items:center;gap:10px">'
    + '<input type="range" data-yapper-slider="' + key + '" min="' + lo + '" max="' + hi
    + '" step="' + (step || 1) + '" value="' + value + '" style="width:150px;accent-color:#fff">'
    + '<b data-yapper-slider-out="' + key + '" style="min-width:42px;text-align:right;font-size:12px;'
    + 'color:var(--text-muted)">' + sliderText(value, step) + '</b></span></label>';
  // Show what is actually applied. A whole number rounded the display away from
  // the real value, so the label read 2 while 1.5 was in use.

  var btn = 'background:rgba(255,255,255,0.10);color:var(--text);border:1px solid var(--border);'
    + 'border-radius:6px;padding:6px 12px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;';
  var editor =
    '<div style="margin-top:24px">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:10px">' +
        '<span style="font-size:14px;font-weight:600">Custom CSS editor</span>' +
        '<span style="display:flex;gap:8px">' +
          '<button type="button" data-yapper-css="reset" style="' + btn + '">Reset</button>' +
          '<button type="button" data-yapper-css="save" style="' + btn + '">Save (Ctrl+S)</button>' +
        '</span>' +
      '</div>' +
      '<textarea id="yapperCssEditor" spellcheck="false" autocomplete="off" ' +
        'placeholder="' + PLACEHOLDER + '" style="width:100%;min-height:220px;resize:vertical;' +
        'box-sizing:border-box;padding:12px;border:1px solid var(--border);border-radius:var(--radius);' +
        'background:rgba(255,255,255,0.04);color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;' +
        'font-size:12.5px;line-height:1.55;tab-size:2"></textarea>' +
      '<div id="yapperCssStatus" style="margin-top:8px;font-size:12px;color:var(--text-muted)">' + CSS_PATH + '</div>' +
    '</div>';

  var mono = 'width:100%;box-sizing:border-box;min-height:110px;resize:vertical;padding:10px;'
    + 'border:1px solid var(--border);border-radius:var(--radius);background:rgba(255,255,255,0.04);'
    + 'color:var(--text);font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;line-height:1.5;';
  var bgBox = '<div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--border)">'
    + '<div style="font-size:14px;font-weight:600;margin-bottom:10px">App background</div>'
    + '<label style="' + row + 'cursor:pointer">'
      + '<input type="checkbox" data-mod-key="bgMode"' + (settings.bgMode ? ' checked' : '')
      + ' style="width:17px;height:17px;accent-color:#fff;cursor:pointer">'
      + '<span style="font-size:14px;font-weight:600">Use a background</span></label>'
    + '<div style="' + row + 'justify-content:space-between"><span style="font-size:14px;font-weight:600">File</span>'
      + '<span style="display:flex;gap:8px">'
        + '<button type="button" data-yapper-bg="pick" style="' + btn + '">Choose</button>'
        + '<button type="button" data-yapper-bg="clear" style="' + btn + '">Clear</button>'
      + '</span></div>'
    + slider('bgBlur', 'Blur', 0, 2, Number(settings.bgBlur != null ? settings.bgBlur : 2), 0.1)
    + slider('bgDim', 'Darkness', 0, 100, Math.round(Number(settings.bgDim != null ? settings.bgDim : 0.28) * 100))
    + '<div id="yapperBgStatus" style="margin-top:6px;font-size:12px;color:var(--text-muted)">'
      + (settings.bgFile ? 'Using ' + settings.bgFile : 'No background chosen') + '</div></div>';

  var tuneBox = '<div style="margin-top:22px;padding-top:18px;border-top:1px solid var(--border)">'
    + '<div style="font-size:14px;font-weight:600;margin-bottom:10px">Message tuning</div>'
    + slider('msgFont', 'Text size', 0, 24, Number(settings.msgFont || 0))
    + slider('emojiSize', 'Emoji size', 0, 48, Number(settings.emojiSize || 0))
    + slider('autoDelete', 'Auto-hide bot messages', 0, 60, Number(settings.autoDelete || 0))
    + '<div style="font-size:11px;color:var(--text-muted);margin-top:2px">'
      + 'Text size and auto-hide are in seconds; 0 turns each one off.</div></div>';

  return '<div id="yapperModPanel" style="padding:22px 26px 18px;max-width:540px">' +
    '<h2 style="margin:0 0 4px;font-size:20px;font-weight:700">Yapcord</h2>' +
    '<p style="margin:0 0 20px;color:var(--text-muted);font-size:13px">Local tweaks applied to this desktop app.</p>' +
    boxes
    + '<div id="yapperRestartNote" style="margin-top:10px;padding:9px 11px;border-radius:8px;'
    + 'border:1px solid var(--border);background:rgba(255 255 255 / .05);font-size:12px;'
    + 'color:var(--text-muted)"></div>'
    + surfaceBox() + bgBox + tuneBox + (settings.customCss ? editor : '') + '</div>';
}

// The site keeps its light/dark pick in localStorage['yapper-theme'] and renders
// from <html data-theme="...">, so pin both to dark or the vars above lose to
// the site's own [data-theme=light] block.
function applyTheme(contents) {
  var css = glassCss();
  var script = `(() => {
    var CSS = ${JSON.stringify(css)};
    var PANEL_INNER = ${JSON.stringify(panelBits())};
    // The observer below is installed once, so its closure would keep the panel
    // markup from the very first injection. That made a toggle look like it
    // reverted the moment you changed tabs, even though it had saved fine.
    window.__yapperPanelHtml = PANEL_INNER;
    window.__yapperCur = ${JSON.stringify(settings)};
    // Do NOT clobber the live buffer. Every br.set() re-runs this injection via
    // applyAll(), and the main process may still hold pre-edit groups. Resetting
    // here made each folder open/close discard whatever the last drag had added.
    var CUR = ${JSON.stringify(settings)};
    var DARK = ${settings.dark ? 'true' : 'false'};
    var FALLBACK = ${settings.fallback ? 'true' : 'false'};
    var LOGGER = ${settings.logger ? 'true' : 'false'};
    var NAMETAG = ${settings.nametag ? 'true' : 'false'};
    var ABOUT = ${settings.aboutClamp ? 'true' : 'false'};
    var FORCE_ONE = ${settings.forceOne ? 'true' : 'false'};
    var FORCE_ACCENT = ${JSON.stringify(settings.forceAccent)};
    var FORCE_TEXT = ${JSON.stringify(settings.forceText)};
    // The MutationObserver below is installed only once, so its closure would
    // otherwise keep the flags from the first injection and every later toggle
    // would do nothing until a page reload. Read them from window each time.
    window.__yapperFlags = {
      LOGGER: LOGGER, NAMETAG: NAMETAG, ABOUT: ABOUT,
      FORCE_ONE: FORCE_ONE, FORCE_ACCENT: FORCE_ACCENT,
      FORCE_TEXT: FORCE_TEXT,
      BG_MODE: ${settings.bgMode ? 'true' : 'false'},
      BG_KIND: ${JSON.stringify(settings.bgKind)},
      BG_URI: ${JSON.stringify(bgDataUri())},
      SILENT_TYPING: ${settings.silentTyping ? 'true' : 'false'},
      NL: ${JSON.stringify(String.fromCharCode(10))},
      SVG_ICONS: ${settings.svgIcons ? 'true' : 'false'},
      EMOJI_CODES: ${settings.emojiCodes ? 'true' : 'false'},
      ALL_ONLINE: ${settings.allOnline ? 'true' : 'false'},
      ADBLOCK: ${settings.adblock ? 'true' : 'false'},
      TIMESTAMP24: ${settings.timestamp24 ? 'true' : 'false'},
      EMOJI_SIZE: ${Number(settings.emojiSize || 0)},
      AUTO_DELETE: ${Number(settings.autoDelete || 0)},
      EXTERNAL_LINKS: ${settings.externalLinks ? 'true' : 'false'},
      NO_DELETE_KEY: ${settings.noDeleteKey ? 'true' : 'false'},
      FOLDER_ICONS: ${JSON.stringify((() => {
        var m = {};
        for (var k of Object.keys(settings.folderIcons || {})) {
          var uri = folderIconUri(k);
          if (uri) m[k] = uri;
        }
        return m;
      })())},
      FOLDER_COLOURS: ${JSON.stringify(settings.folderColours || {})},
 FOLDER_STRENGTH: ${JSON.stringify(settings.folderStrength || {})},
 CUSTOM_THEME: ${JSON.stringify(settings.customTheme || '')},
 WINHAWK_CSS_B64: '${readWinhawkCssB64()}',
 WINHAWK_WARNED: ${settings.winhawkWarned ? 'true' : 'false'},
    };
    window.__yapperFolderIcons = window.__yapperFlags.FOLDER_ICONS || {};
    // Restore any custom folder colour so it survives a restart. Parsed with
    // string ops rather than a regex: backslashes inside this template literal
    // collapse and would silently break the pattern.
    window.__yapperFolderColours = window.__yapperFlags.FOLDER_COLOURS || {};
 window.__yapperFolderStrength = window.__yapperFlags.FOLDER_STRENGTH || {};
    (() => {
      var saved = window.__yapperFolderColours;
      for (var k of Object.keys(saved)) {
        var css = String(saved[k]);
        window.__yapperFolderColour = css;
        window.__yapperFolderApplied = css;
        var open = css.indexOf('(');
        var close = css.lastIndexOf(')');
        if (open !== -1 && close > open) {
          var nums = css.slice(open + 1, close).split(',').map(x => Number(x.trim()));
          if (nums.length >= 3 && nums.every(n => !isNaN(n))) {
            var hex = '#' + nums.slice(0, 3)
              .map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
            window.__yapperFolderHex = hex;
            window.__yapperFolderAlpha = nums.length > 3 ? nums[3] : 1;
          }
        }
      }
    })();
    var apply = () => {
      if (CSS && document.head) {
        var s = document.getElementById('__yapperTheme');
        if (!s) { s = document.createElement('style'); s.id = '__yapperTheme'; document.head.appendChild(s); }
        if (s.textContent !== CSS) s.textContent = CSS;
      }
      if (DARK) {
        try { localStorage.setItem('yapper-theme', 'dark'); } catch (e) {}
        var el = document.documentElement;
        if (el && el.getAttribute('data-theme') !== 'dark') el.setAttribute('data-theme', 'dark');
      }
      var meta = document.querySelector('meta[name="theme-color"]');
      if (meta && meta.getAttribute('content') !== '#000000') meta.setAttribute('content', '#000000');
    };
    var LOGO = ${JSON.stringify(FALLBACK_LOGO)};
    // Anything remote that fails to load becomes the app logo: avatars, server
    // icons and server banners alike. Empty-src spacers and data: URIs (inline
    // art, the app's own branding) are left untouched.
    var patch = (el) => {
      if (!FALLBACK) return;
      if (el.tagName !== 'IMG' || el.dataset.yapperFallback) return;
      var s = el.getAttribute('src') || '';
      if (!s || s.startsWith('data:')) return;
      var swap = () => {
        if (el.getAttribute('src') === LOGO) return;
        el.setAttribute('data-yapper-fallback', '1');
        el.src = LOGO;
      };
      if (el.complete && el.naturalWidth === 0) swap();
      el.addEventListener('error', swap, { once: false });
    };
    var sweep = (root) => {
      if (root.nodeType !== 1) return;
      patch(root);
      root.querySelectorAll && root.querySelectorAll('img').forEach(patch);
    };
    apply();
    sweep(document);
    if (!window.__yapperImgWatch) {
      window.__yapperImgWatch = true;
      new MutationObserver((muts) => {
        for (var m of muts) for (var n of m.addedNodes) sweep(n);
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
    if (!window.__yapperDarkPinned) {
      window.__yapperDarkPinned = true;
      new MutationObserver(apply).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    }

    // ---- message mods ----
    // Author name lives in .msg-author; the username is only on the avatar
    // button's aria-label ("<username>'s profile"), so that is what we read.
    var usernameOf = (msg) => {
      var av = msg.querySelector('.avatar');
      if (!av) return null;
      var m = (av.getAttribute('aria-label') || '').match(/^(.+?)'s profile$/);
      return m ? m[1] : null;
    };
    var formatName = (msg) => {
      var F = window.__yapperFlags || {};
      var a = msg.querySelector('.msg-author');
      if (!a) return;
      var user = usernameOf(msg);
      if (!user) return;
      // Build the label from the pristine display name every time instead of
      // appending to whatever is on screen. Appending to textContent is what
      // used to mangle names that already contain brackets or odd glyphs, and it
      // double-wrapped the moment React re-rendered the author.
      var disp = a.dataset.yapperDisp;
      if (disp == null) {
        // Drop a thin-space + bracketed username left by an earlier pass.
        // Plain string ops, no regex: backslashes inside this template literal
        // collapse and silently corrupt any pattern written here.
        var t = a.textContent || '';
        var cut = t.lastIndexOf(' (');
        if (cut !== -1 && t.charAt(t.length - 1) === ')') t = t.slice(0, cut);
        disp = t;
        a.dataset.yapperDisp = disp;
      }
      var show = F.NAMETAG && user && user !== disp && disp.indexOf(user) === -1;
      var cur = a.textContent || '';
      var want = show ? disp + ' (' + user + ')' : disp;
      if (cur !== want) a.textContent = want;
    };
    var isDeleted = (msg) => {
      if (/deleted|tombstone/i.test(msg.className || '')) return true;
      var d = msg.dataset || {};
      if (d.deleted === 'true' || d.deleted === '1') return true;
      var t = msg.querySelector('.msg-text');
      return !!(t && /message (was )?deleted|deleted message/i.test(t.textContent || ''));
    };
    // A deleted message is kept on screen and tinted, rather than replaced by
    // the app's tombstone.
    //
    // The snapshot has to be taken while the message is still intact, because
    // once React swaps in the tombstone the original text is gone.
    var msgOriginal = new WeakMap();
    var snapshotMsg = (msg) => {
      if (msgOriginal.has(msg)) return;
      var t = msg.querySelector('.msg-text');
      if (!t) return;
      msgOriginal.set(msg, t.innerHTML);
    };
    var markDeleted = (msg) => {
      // Class and attribute changes only. The previous version inserted a
      // <span> next to the author, and because that markup belongs to React it
      // corrupted the reconciliation for the whole message list, so edits and
      // live updates stopped rendering.
      msg.classList.add('yapper-deleted');
      msg.setAttribute('data-yapper-deleted', '1');
      var a = msg.querySelector('.msg-author');
      if (a) a.classList.add('yapper-deleted-author');
      var t = msg.querySelector('.msg-text');
      var keep = msgOriginal.get(msg);
      // Only ever put the original text back when the current text really is
      // a tombstone. isDeleted() also matches an ordinary message that merely
      // mentions "message deleted", and blindly restoring would then overwrite
      // genuine edits and live updates.
      var cur = t ? (t.textContent || '') : '';
      var isTombstone = !cur || /message (was )?deleted|deleted message|^deleted$/i.test(cur.trim());
      if (t && keep && isTombstone && t.innerHTML !== keep) t.innerHTML = keep;
    };
    // ---- "About me" clamping ----
    // Their viewer markup for the bio lives in a lazily loaded chunk, so find it
    // by its heading text instead of guessing class names, and never touch a
    // form control (that would break editing the profile).
    var aboutBodyFor = (label) => {
      var parent = label.parentElement;
      if (!parent) return null;
      var kids = [...parent.children];
      for (var k = kids.indexOf(label) + 1; k < kids.length; k++) {
        var c = kids[k];
        if (/^(TEXTAREA|INPUT|SELECT|BUTTON|LABEL)$/.test(c.tagName)) continue;
        if (c.isContentEditable) continue;
        var t = (c.textContent || '').trim();
        if (!t || /^about me$/i.test(t)) continue;
        return c;
      }
      return null;
    };
    // Emoji -> real SVG, and offline members shown as online.
var ICON_SVG_PATHS = [[0x1F4AC, 'M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z'], [0x1F514, 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5S10.5 3.17 10.5 4v.68C7.64 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z', '1.35em'], [0x1F464, 'M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z', '1.45em'], [0x21C4, 'M6.99 11L3 15l3.99 4v-3H14v-2H6.99v-3zM21 9l-3.99-4v3H10v2h7.01v3L21 9z'], [0x2728, 'M12 2l2.4 6.2L21 9.3l-5 4.4 1.4 6.8L12 17l-5.4 3.5L8 13.7 3 9.3l6.6-1.1L12 2z'], [0x1F451, 'M5 18h14l2-9-5 3-4-7-4 7-5-3 2 9z']];
    var Q = String.fromCharCode(39);
    var ICON_ATTR = 'viewBox=' + Q + '0 0 24 24' + Q
      + ' fill=' + Q + 'currentColor' + Q + ' aria-hidden=' + Q + 'true' + Q + ' style=' + Q + 'vertical-align:-0.15em' + Q;
    var wrapIcon = (d, w) => '<svg ' + ICON_ATTR + ' width=' + Q + (w || '1em') + Q + ' height=' + Q + (w || '1em') + Q + '><path d=' + Q + d + Q + '/></svg>';
    var ICONS = {};
    ICON_SVG_PATHS.forEach((p) => { ICONS[String.fromCodePoint(p[0])] = wrapIcon(p[1], p[2]); });
    var PEOPLE_GLYPH = String.fromCodePoint(0x1F465);
    var PEOPLE_SVG = wrapIcon('M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z');
    var swapEmoji = () => {
      var F = window.__yapperFlags || {};
      if (!F.SVG_ICONS) return;
      // The status popup renders its rows with raw emoji in span.me-ico.
      document.querySelectorAll('span.me-ico, span[title="Server owner"]').forEach(el => {
        if (el.dataset.yapperSvg === '1') return;
        var key = (el.textContent || '').trim();
        var svg = ICONS[key];
        if (!svg) return;
        el.dataset.yapperSvg = '1';
        el.textContent = '';
        el.innerHTML = svg;
      });
      document.querySelectorAll('span.hint').forEach(el => {
        if (el.dataset.yapperIcon === '1') return;
        var t = el.textContent || '';
        if (t.indexOf(PEOPLE_GLYPH) === -1) return;
        el.dataset.yapperIcon = '1';
        var rest = t.split(PEOPLE_GLYPH).join('').trim();
        el.textContent = '';
        var wrap = document.createElement('span');
        wrap.className = 'yapper-hint-icon';
        wrap.innerHTML = PEOPLE_SVG;
        el.appendChild(wrap);
        el.appendChild(document.createTextNode(rest ? ' ' + rest : ''));
      });
    };
    // ---- :shortcode: -> emoji ----
    // The app renders :name: as plain text, so anything typed in Slack/Discord
    // shortcode form stays unreadable. This expands the shortcodes it knows,
    // including the Slack "ios" custom set which has no Unicode equivalent and
    // so is mapped to the closest real glyph.
    var EMOJI_CODES = {
      // standard shortcodes
      smile: '\u{1F604}', laughing: '\u{1F606}', wink: '\u{1F609}', blush: '\u{1F60A}',
      heart_eyes: '\u{1F60D}', kissing_heart: '\u{1F618}', thinking: '\u{1F914}', neutral_face: '\u{1F610}',
      cry: '\u{1F622}', sob: '\u{1F62D}', rage: '\u{1F621}', angry: '\u{1F620}',
      sunglasses: '\u{1F60E}', confused: '\u{1F615}', worried: '\u{1F61F}', scream: '\u{1F631}',
      flushed: '\u{1F633}', sleeping: '\u{1F634}', mask: '\u{1F637}', innocent: '\u{1F617}',
      smiley: '\u{1F603}', grin: '\u{1F601}', joy: '\u{1F602}', rofl: '\u{1F923}',
      upside_down: '\u{1F643}', zipper_mouth: '\u{1F910}', raised_eyebrow: '\u{1F928}',
      shushing: '\u{1F92B}', exploding: '\u{1F92F}', partying: '\u{1F973}', star_struck: '\u{1F929}',
      poop: '\u{1F4A9}', hankey: '\u{1F4A9}', skull: '\u{1F480}', ghost: '\u{1F47B}',
      alien: '\u{1F47D}', robot: '\u{1F916}', clown: '\u{1F921}', jester: '\u{1F921}',
      heart: '\u{2764}\u{FE0F}', orange_heart: '\u{1F9E1}', yellow_heart: '\u{1F49B}',
      green_heart: '\u{1F49A}', blue_heart: '\u{1F499}', purple_heart: '\u{1F49C}',
      black_heart: '\u{1F5A4}', broken_heart: '\u{1F494}', sparkling_heart: '\u{1F496}',
      fire: '\u{1F525}', star: '\u{2B50}', sparkles: '\u{2728}', zap: '\u{26A1}',
      boom: '\u{1F4A5}', collision: '\u{1F4A5}', dizzy: '\u{1F4AB}', sweat_drops: '\u{1F4A6}',
      droplet: '\u{1F4A7}', snowflake: '\u{2744}\u{FE0F}', snowman: '\u{2603}\u{FE0F}',
      sunny: '\u{2600}\u{FE0F}', cloud: '\u{2601}\u{FE0F}', rainbow: '\u{1F308}',
      crescent_moon: '\u{1F319}', full_moon: '\u{1F315}', earth_americas: '\u{1F30E}',
      earth_africa: '\u{1F30D}', earth_asia: '\u{1F30F}', rocket: '\u{1F680}',
      airplane: '\u{2708}\u{FE0F}', helicopter: '\u{1F681}', train: '\u{1F686}',
      car: '\u{1F697}', taxi: '\u{1F695}', bus: '\u{1F68C}', bike: '\u{1F6B2}',
      ship: '\u{1F6A2}', anchor: '\u{2693}', house: '\u{1F3E0}', office: '\u{1F3E2}',
      hospital: '\u{1F3E5}', school: '\u{1F3EB}', bank: '\u{1F3E6}', tent: '\u{26FA}',
      beach: '\u{1F3D6}\u{FE0F}', mountain: '\u{26F0}\u{FE0F}', desert: '\u{1F3DC}\u{FE0F}',
      city: '\u{1F3D9}\u{FE0F}', night: '\u{1F303}', bridge: '\u{1F309}', wave: '\u{1F30A}',
      phone: '\u{1F4DE}', computer: '\u{1F4BB}', keyboard: '\u{2328}\u{FE0F}',
      floppy_disk: '\u{1F4BE}', cd: '\u{1F4BF}', camera: '\u{1F4F7}', video_camera: '\u{1F4F9}',
      tv: '\u{1F4FA}', radio: '\u{1F4FB}', mag: '\u{1F50D}', lock: '\u{1F512}',
      key: '\u{1F511}', hammer: '\u{1F528}', wrench: '\u{1F527}', gear: '\u{2699}\u{FE0F}',
      link: '\u{1F517}', paperclip: '\u{1F4CE}', scissors: '\u{2702}\u{FE0F}',
      pencil2: '\u{270F}\u{FE0F}', memo: '\u{1F4DD}', book: '\u{1F4D6}', books: '\u{1F4DA}',
      newspaper: '\u{1F4F0}', page_facing_up: '\u{1F4C4}', chart_with_upwards_trend: '\u{1F4C8}',
      bar_chart: '\u{1F4CA}', clipboard: '\u{1F4CB}', calendar: '\u{1F4C5}',
      pushpin: '\u{1F4CC}', round_pushpin: '\u{1F4CD}', paperclip_note: '\u{1F4CE}',
      bell: '\u{1F514}', no_bell: '\u{1F515}', mega: '\u{1F4E3}', loudspeaker: '\u{1F4E2}',
      speech_balloon: '\u{1F4AC}', thought_balloon: '\u{1F4AD}', email: '\u{2709}\u{FE0F}',
      envelope: '\u{2709}\u{FE0F}', inbox_tray: '\u{1F4E5}', outbox_tray: '\u{1F4E4}',
      warning: '\u{26A0}\u{FE0F}', no_entry: '\u{26D4}', x: '\u{274C}', heavy_check_mark: '\u{2714}\u{FE0F}',
      white_check_mark: '\u{2705}', ballot_box_with_check: '\u{2611}\u{FE0F}',
      question: '\u{2753}', grey_question: '\u{2754}', exclamation: '\u{2757}',
      heavy_exclamation_mark: '\u{2757}', 100: '\u{1F4AF}', arrow_right: '\u{27A1}\u{FE0F}',
      arrow_left: '\u{2B05}\u{FE0F}', arrow_up: '\u{2B06}\u{FE0F}', arrow_down: '\u{2B07}\u{FE0F}',
      eyes: '\u{1F440}', eye: '\u{1F441}\u{FE0F}', ear: '\u{1F442}', nose: '\u{1F443}',
      tongue: '\u{1F445}', lips: '\u{1F444}', brain: '\u{1F9E0}', muscle: '\u{1F4AA}',
      wave_hand: '\u{1F44B}', raised_hand: '\u{270B}', ok_hand: '\u{1F44C}',
      pray: '\u{1F64F}', clap: '\u{1F44F}', muscle_emoji: '\u{1F4AA}',
      point_right: '\u{1F449}', point_left: '\u{1F448}', point_up_2: '\u{1F446}',
      point_down: '\u{1F447}', eyes_emoji: '\u{1F440}', heart_eyes_eyes: '\u{1F60D}',
      tada: '\u{1F389}', confetti_ball: '\u{1F38A}', balloon: '\u{1F388}',
      gift: '\u{1F381}', trophy: '\u{1F3C6}', medal: '\u{1F3C5}', crown: '\u{1F451}',
      gem: '\u{1F48E}', moneybag: '\u{1F4B0}', dollar: '\u{1F4B5}', credit_card: '\u{1F4B3}',
      coffee: '\u{2615}', tea: '\u{1F375}', beer: '\u{1F37A}', beers: '\u{1F37B}',
      pizza: '\u{1F355}', hamburger: '\u{1F354}', fries: '\u{1F35F}', cake: '\u{1F370}',
      cookie: '\u{1F36A}', doughnut: '\u{1F369}', candy: '\u{1F36C}', lollipop: '\u{1F36D}',
      apple: '\u{1F34E}', banana: '\u{1F34C}', watermelon: '\u{1F349}', strawberry: '\u{1F353}',
      dog: '\u{1F436}', cat: '\u{1F431}', mouse: '\u{1F42D}', hamster: '\u{1F439}',
      rabbit: '\u{1F430}', fox: '\u{1F98A}', bear: '\u{1F43B}', panda: '\u{1F43C}',
      monkey: '\u{1F412}', penguin: '\u{1F427}', bird: '\u{1F426}', duck: '\u{1F986}',
      eagle: '\u{1F985}', owl: '\u{1F989}', bat: '\u{1F987}', wolf: '\u{1F43A}',
      unicorn: '\u{1F984}', bee: '\u{1F41D}', bug: '\u{1F41B}', butterfly: '\u{1F98B}',
      snail: '\u{1F40C}', turtle: '\u{1F422}', fish: '\u{1F41F}', dolphin: '\u{1F42C}',
      whale: '\u{1F433}', octopus: '\u{1F419}', crab: '\u{1F980}', dragon: '\u{1F409}',
      cactus: '\u{1F335}', evergreen_tree: '\u{1F332}', palm_tree: '\u{1F334}',
      seedling: '\u{1F331}', herb: '\u{1F33F}', four_leaf_clover: '\u{1F340}',
      maple_leaf: '\u{1F341}', fallen_leaf: '\u{1F342}', mushroom: '\u{1F344}',
      // the Slack "ios" custom set - no Unicode original, mapped to the closest
      IOSSpaceship: '\u{1F6F8}\u{FE0F}',
      IOSRocket: '\u{1F680}',
      IOSSatellite: '\u{1F4E1}',
      IOSAlien: '\u{1F47D}',
      IOSGhost: '\u{1F47B}',
      IOSSkull: '\u{1F480}',
      IOSRobot: '\u{1F916}',
      IOSClown: '\u{1F921}',
      IOSPoop: '\u{1F4A9}',
      IOSHeart: '\u{2764}\u{FE0F}',
      IOSFire: '\u{1F525}',
      IOSStar: '\u{2B50}',
      IOSSparkles: '\u{2728}',
      IOSBoom: '\u{1F4A5}',
      IOSRainbow: '\u{1F308}',
      IOSSun: '\u{2600}\u{FE0F}',
      IOSMoon: '\u{1F319}',
      IOSCloud: '\u{2601}\u{FE0F}',
      IOSSnow: '\u{2744}\u{FE0F}',
      IOSFlame: '\u{1F525}',
      IOSLightning: '\u{26A1}',
      IOSMoonFace: '\u{1F31D}',
      IOSBomb: '\u{1F4A3}',
      IOSSkullCross: '\u{2620}\u{FE0F}',
      IOSAnchor: '\u{2693}',
      IOSCrown: '\u{1F451}',
      IOSGem: '\u{1F48E}',
      IOSRocketShip: '\u{1F680}',
      IOSUFO: '\u{1F6F8}\u{FE0F}',
      IOSButterfly: '\u{1F98B}',
      IOSSnail: '\u{1F40C}',
      IOSWhale: '\u{1F433}',
      IOSOctopus: '\u{1F419}',
      IOSDragon: '\u{1F409}',
      IOSUnicorn: '\u{1F984}',
      IOSPanda: '\u{1F43C}',
    };

    var expandEmoji = () => {
      var F = window.__yapperFlags || {};
      if (!F.EMOJI_CODES) return;
      var re = /:([A-Za-z][A-Za-z0-9_+-]{1,30}):/g;
      document.querySelectorAll('.msg-text, .msg-content').forEach((el) => {
        if (el.closest('code, pre')) return;   // never touch code blocks
        var html = el.innerHTML;
        if (html.indexOf(':') === -1) return;
        var changed = false;
        var next = html.replace(re, (whole, key) => {
          var g = EMOJI_CODES[key];
          if (!g) g = EMOJI_CODES[key.toLowerCase()];
          if (!g) return whole;
          changed = true;
          return g;
        });
        if (changed) el.innerHTML = next;
      });
    };

    var showOnline = () => {
      var F = window.__yapperFlags || {};
      if (!F.ALL_ONLINE) return;
      // offline, idle and dnd all become the plain green online dot.
      document.querySelectorAll('.status-dot.offline, .status-dot.idle, .status-dot.dnd')
        .forEach(d => {
          d.style.setProperty('background', '#43b581', 'important');
          if (d.classList.contains('offline')) {
            // Without this the dot stays a green centre inside the app's grey
            // inset ring and still reads as offline at a glance.
            d.style.setProperty('box-shadow', '0 0 0 3px var(--bg-main)', 'important');
          }
        });
      document.querySelectorAll('.members-panel .pick-row.offline').forEach(r => {
        r.style.setProperty('opacity', '1', 'important');
      });
    };
    swapEmoji();
    showOnline();

    var setupAbout = () => {
      if (!(window.__yapperFlags || {}).ABOUT) return;
      var labels = [...document.querySelectorAll('label, .label, h1, h2, h3, h4, strong, b, span, div, p')]
        .filter(l => l.children.length === 0 && /^about me$/i.test((l.textContent || '').trim()));
      labels.forEach(lab => {
        var body = aboutBodyFor(lab);
        if (!body || body.dataset.yapperAbout) return;
        body.dataset.yapperAbout = '1';
        body.classList.add('yapper-about-clamp');
        // Only keep the clamp if the text genuinely overflows four lines.
        if (body.scrollHeight <= body.clientHeight + 2) {
          body.classList.remove('yapper-about-clamp');
          return;
        }
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'yapper-readmore';
        btn.textContent = 'Read more\u2026';
        btn.addEventListener('click', () => {
          var open = body.classList.toggle('yapper-about-open');
          body.classList.toggle('yapper-about-clamp', !open);
          btn.textContent = open ? 'Read less' : 'Read more\u2026';
        });
        body.insertAdjacentElement('afterend', btn);
      });
    };
    // Custom avatar decoration everywhere.
    var applyDeco = () => {
      var F = window.__yapperFlags || {};
      var D = '';
      var selfOn = !!(F.DECO_SELF && D);

      // Yours, wherever it appears: the user bar, the status popup and the
      // profile card all render the same avatar markup. "Is this me?" is
      // answered by comparing the picture against your own, which is far more
      // reliable than guessing from container classes.
      if (!window.__yapperSelfSrc) {
        var me = document.querySelector('.user-bar .avatar-clip > img');
        if (me && me.src) window.__yapperSelfSrc = me.src;
      }
      var selfSrc = window.__yapperSelfSrc || '';
      var hosts = document.querySelectorAll(
        '.user-bar .avatar'
      );
      hosts.forEach(host => {
        var pic = host.querySelector('.avatar-clip > img');
        var mine = !selfSrc || (pic && pic.src === selfSrc) || host.closest('.user-bar');
        if (!mine) return;
        var overlay = host.querySelector('img[data-yapper-deco="overlay"]');
        if (selfOn) {
          if (overlay) return;
          host.style.position = 'relative';
          host.classList.add('decorated');
          var deco = document.createElement('img');
          deco.className = 'avatar-deco';
          deco.alt = '';
          deco.draggable = false;
          deco.dataset.yapperDeco = 'overlay';
          deco.src = D;
          host.appendChild(deco);
          return;
        }
        if (overlay && overlay.parentElement) overlay.parentElement.removeChild(overlay);
        if (!host.closest('.user-bar')) host.classList.remove('decorated');
      });

    };


    // ---- silent typing ----
    // The typing indicator is an outbound control frame. Dropping it means
    // nobody else sees you typing; nothing else about the socket changes.
    window.__yapperSilentTyping = !!(window.__yapperFlags || {}).SILENT_TYPING;
    if (typeof WebSocket !== 'undefined' && !WebSocket.prototype.__yapperSilent) {
      var proto = WebSocket.prototype;
      var originalSend = proto.send;
      var isTypingFrame = (data) => {
        if (typeof data !== 'string' || data.length > 400) return false;
        var t = data.toLowerCase();
        if (t.indexOf('content') !== -1) return false;   // never touch real messages
        return t.indexOf('typing') !== -1 || /"op"\s*:\s*9\b/.test(t) || /"t"\s*:\s*9\b/.test(t);
      };
      proto.send = function (data) {
        if (window.__yapperSilentTyping && isTypingFrame(data)) return;
        return originalSend.apply(this, arguments);
      };
      proto.__yapperSilent = true;
    }

    // ---- background ----
    var applyBg = () => {
      var F = window.__yapperFlags || {};
      var wantKey = (F.BG_MODE ? F.BG_KIND : 'off') + '|' + (F.BG_URI || '').length;
      if (window.__yapperBgKey === wantKey) return;
      window.__yapperBgKey = wantKey;
      if (!F.BG_MODE || !F.BG_URI) {
        ['yapperBg', 'yapperBgDim'].forEach(id => {
          var el = document.getElementById(id);
          if (el && el.parentElement) el.parentElement.removeChild(el);
        });
        return;
      }
      var holder = document.getElementById('yapperBg');
      if (!holder) {
        holder = document.createElement('div');
        holder.id = 'yapperBg';
        document.body.appendChild(holder);
      }
      var want = (F.BG_KIND === 'video' ? '<video' : '<img') + '';
      var isVideo = F.BG_KIND === 'video';
      var hasVideo = !!holder.querySelector('video');
      var hasImg = !!holder.querySelector('img');
      if (isVideo === hasVideo && (isVideo ? hasVideo : hasImg)) {
        var node = isVideo ? holder.querySelector('video') : holder.querySelector('img');
        if ((node.getAttribute('src') || '') !== F.BG_URI && node.src !== F.BG_URI) node.setAttribute('src', F.BG_URI);
        return;
      }
      holder.textContent = '';
      if (isVideo) {
        var v = document.createElement('video');
        v.autoplay = true; v.muted = true; v.loop = true; v.playsInline = true;
        v.setAttribute('src', F.BG_URI);
        holder.appendChild(v);
      } else {
        var im = document.createElement('img');
        im.setAttribute('src', F.BG_URI);
        im.setAttribute('alt', '');
        holder.appendChild(im);
      }
      if (!document.getElementById('yapperBgDim')) {
        var dim = document.createElement('div');
        dim.id = 'yapperBgDim';
        document.body.appendChild(dim);
      }
    };
    applyBg();

    setupAbout();

    var sweepMessages = () => {
      var F = window.__yapperFlags || {};
      if (!F.LOGGER && !F.NAMETAG) return;
      var list = document.querySelector('.messages');
      if (!list) return;
      list.querySelectorAll('.msg').forEach(m => {
        if (F.NAMETAG) formatName(m);
        if (F.LOGGER) {
        if (isDeleted(m)) markDeleted(m);
        else snapshotMsg(m);
      }
      });
    };
    sweepMessages();

    // Custom icon for the app's native rail folders. The folder is a <button>
    // with a .folder-grid of member mini-icons; we swap in an <img> and keep
    // it there, so React re-renders cannot wipe it.
    var folderName = (btn) => String(btn.getAttribute('title') || '').trim();

    // Folders get renamed every time a server is added or removed: the app
    // appends the server name, and once there are several it collapses them
    // into "Name, First and 1 more". Keying the saved picture and colour off
    // the name meant every one of those changes threw the customisation away.
    //
    // The wrapper carries a stable id that the name churn never touches, so
    // that is the key from now on. Old name-keyed entries are migrated across
    // the first time their folder is seen again.
    // Which element carries the id depends on whether the folder is open.
    // Collapsed, .rail-wrap has data-rail-row. Expanded, that wrapper is
    // rebuilt without it and only .drag-row still has data-drag-id - which is
    // why the custom icon and colour vanished the moment you opened a folder.
    var folderIdMemo = {};
    var folderIdOf = (btn) => {
      if (!btn) return '';
      var wrap = btn.closest ? btn.closest('.rail-wrap') : null;
      var row = btn.closest ? btn.closest('.drag-row') : null;
      var id = (wrap && wrap.getAttribute ? wrap.getAttribute('data-rail-row') : '')
        || (row && row.getAttribute ? row.getAttribute('data-drag-id') : '')
        || '';
      // remember it, so the id survives even a render that drops both
      var base = String(btn.getAttribute('title') || '').split(',')[0].trim();
      if (id) { if (base) folderIdMemo[base] = id; return id; }
      return base ? (folderIdMemo[base] || '') : '';
    };

    var baseName = (n) => String(n || '').split(',')[0].trim().toLowerCase();

    var movedKeys = {};
    var folderKeyOf = (name, btn) => {
      var id = btn ? folderIdOf(btn) : '';
      var icons = window.__yapperFolderIcons || {};
      var colours = window.__yapperFolderColours || {};

      if (!id) return name;              // no id to go on, name is all we have

      // Always run the migration, even when the id already holds one of the
      // two values. Returning early on "the image is there" left a colour that
      // was still saved under the old name stranded, and that folder showed no
      // colour at all.
      if (!movedKeys[id]) {
      var oldKey = '';
      if (icons[name] || colours[name]) {
        oldKey = name;
      } else {
        var want = baseName(name);
        var keys = Object.keys(icons).concat(Object.keys(colours));
        var seen = {};
        for (var i = 0; i < keys.length; i++) {
          var k = keys[i];
          if (!k || seen[k]) continue;
          seen[k] = 1;
          if (baseName(k) === want) { oldKey = k; break; }
        }
      }
      if (!oldKey) { movedKeys[id] = 'done'; return id; }

      movedKeys[id] = oldKey;
      if (icons[oldKey] && !icons[id]) icons[id] = icons[oldKey];
      if (colours[oldKey] && !colours[id]) colours[id] = colours[oldKey];
      delete icons[oldKey];
      delete colours[oldKey];
      var b = (window.yapperDesktop && window.yapperDesktop.mod) || null;
      if (b && b.folderIcon && b.folderIcon.moveKey) {
        try { b.folderIcon.moveKey(oldKey, id); } catch { /* keep going */ }
      }
      }
      return id;
    };

    // The coloured plate the app draws for a folder lives on this wrapper.
    var getPlate = (btn) => {
      var w = btn && btn.closest ? btn.closest('.rail-folder-open') : null;
      return w || (btn && btn.parentElement) || btn;
    };
    var mirrorToWrapper = (btn) => {
      var plate = getPlate(btn);
      if (!plate || plate === btn) return;
      var bg = btn.style.getPropertyValue('--yapper-folder-bg');
      var tint = btn.style.getPropertyValue('--yapper-folder-tint');
      if (bg && plate.style.getPropertyValue('--yapper-folder-bg') !== bg) {
        plate.style.setProperty('--yapper-folder-bg', bg);
      }
      if (tint && plate.style.getPropertyValue('--yapper-folder-tint') !== tint) {
        plate.style.setProperty('--yapper-folder-tint', tint);
      }
      if (bg) plate.setAttribute('data-yapper-folder-custom', '1');
      if (tint) plate.setAttribute('data-yapper-folder-tinted', '1');
      else plate.removeAttribute('data-yapper-folder-tinted');
    };

    var paintFolders = () => {
      // Re-assert a custom colour only while the app has NOT changed it. The app
      // rewrites --folder from its own state on every render, so a blanket
      // re-apply overrode the user's own preset pick and made the palette look
      // broken. Only re-assert if the current value still matches what the app
      // would have written on its own (i.e. it clobbered us, not the user).
      // Colours are strictly per folder. An earlier version re-applied one
      // global value to every folder, which recoloured the whole rail.
      var saved = window.__yapperFolderColours || {};
      for (var b of document.querySelectorAll('.rail-item.rail-folder')) {
        var name = folderKeyOf(folderName(b), b);
        var want = saved[name] || '';
        var plate = getPlate(b);
        var has = b.style.getPropertyValue('--yapper-folder-tint');
        if (!want) {
          if (has) b.style.removeProperty('--yapper-folder-tint');
          plate.style.removeProperty('--yapper-folder-tint');
          continue;
        }
        if (has !== want) b.style.setProperty('--yapper-folder-tint', want);
        if (plate.style.getPropertyValue('--yapper-folder-tint') !== want) {
          plate.style.setProperty('--yapper-folder-tint', want);
        }
        // Carry the saved strength so a restart keeps the same intensity.
        var strength = String(window.__yapperFolderStrength && window.__yapperFolderStrength[name] != null
          ? window.__yapperFolderStrength[name] : 100);
        if (b.style.getPropertyValue('--yapper-folder-strength') !== strength) {
          b.style.setProperty('--yapper-folder-strength', strength);
        }
        if (plate.style.getPropertyValue('--yapper-folder-strength') !== strength) {
          plate.style.setProperty('--yapper-folder-strength', strength);
        }
        // Only paint the plate's ::before when this folder actually has a
        // colour of its own; otherwise leave the app's own look alone.
        if (want) plate.setAttribute('data-yapper-folder-tinted', '1');
        else plate.removeAttribute('data-yapper-folder-tinted');
      }
      var icons = window.__yapperFolderIcons || {};
      for (var btn of document.querySelectorAll('.rail-item.rail-folder')) {
        var key = folderKeyOf(folderName(btn), btn);
        var uri = icons[key] || '';
        // The image is a CSS background on the button itself, never an inserted
        // child. React owns those children and walks them to open the context
        // menu, so adding an <img> there silently broke right-click; painting
        // the backdrop touches nothing the app depends on. The member icons
        // stay on top, so this is a backdrop rather than a replacement.
        var plate = getPlate(btn);
        var bg = btn.style.getPropertyValue('--yapper-folder-bg');
        if (!uri) {
          if (bg) btn.style.removeProperty('--yapper-folder-bg');
          btn.removeAttribute('data-yapper-folder-custom');
          btn.removeAttribute('data-yapper-folder-icon-only');
          // Keep data-yapper-folder-tinted: colour survives an image clear.
          plate.removeAttribute('data-yapper-folder-custom');
          plate.removeAttribute('data-yapper-folder-icon-only');
          continue;
        }
        var next = 'url("' + uri + '")';
        if (bg !== next) btn.style.setProperty('--yapper-folder-bg', next);
        btn.setAttribute('data-yapper-folder-custom', '1');
        plate.setAttribute('data-yapper-folder-custom', '1');
        // A custom image replaces the stock folder glyph, but never the
        // server icons inside the folder.
        btn.setAttribute('data-yapper-folder-icon-only', '1');
        if (btn.style.getPropertyValue('--yapper-folder-tint')) {
          btn.setAttribute('data-yapper-folder-tinted', '1');
        }
        mirrorToWrapper(btn);
      }
    };

    // Add a free-form colour + opacity picker to the app's own Folder settings
    // modal, right after its preset swatches. The app only offers 10 fixed
    // colours, so there was no way to pick anything else or fade it.
    // The folder whose context menu was opened last. The colour dialog belongs
    // to it, so the picker must target that folder and not the first one.
    var lastFolder = null;

    var wireFolderColorPicker = () => {
      if (window.__yapperColorArmed) return;
      window.__yapperColorArmed = true;
      var paint = () => {
        var modal = [...document.querySelectorAll('.overlay .modal')]
          .find(m => /folder settings/i.test(m.getAttribute('aria-label') || ''));
        if (!modal) return false;
        var sw = modal.querySelector('.swatches');
        if (!sw) return false;
        if (sw.parentElement.querySelector('[data-yapper-color]')) return true;

        var box = document.createElement('div');
        box.setAttribute('data-yapper-color', '');
        box.style.cssText = 'display:flex;align-items:center;gap:8px;margin-top:10px;'
          + 'flex-wrap:wrap;font-size:12px;color:var(--text-muted);';

        // Seed from whatever the folder currently shows, so reopening the dialog
        // reflects the live colour rather than a hardcoded default. The hex is
        // remembered separately because --folder holds rgba() once opacity is
        // used, which cannot be fed back into an <input type=color>.
        var btnNow = document.querySelector('.rail-item.rail-folder');
        var live = btnNow ? String(btnNow.style.getPropertyValue('--folder') || '').trim() : '';
        var liveHex = window.__yapperFolderHex
          || (/^#[0-9a-f]{6}$/i.test(live) ? live : '#9b59b6');
        // The folder this dialog belongs to. Only one paint runs per dialog
        // open, so binding here avoids stacking duplicate listeners.
        var liveBtn = (lastFolder && lastFolder.isConnected)
          ? lastFolder
          : document.querySelector('.rail-item.rail-folder');

        // The app rewrites --folder as a plain hex whenever it re-renders the rail,
// dropping the alpha, so the slider position comes from our own cache.
        var liveAlpha = (() => {
          // The colour is stored as a pure hex now, so its alpha carries no
          // strength. Read the saved strength for this exact folder instead.
          var key = (liveBtn && liveBtn.isConnected)
            ? folderKeyOf(folderName(liveBtn), liveBtn)
            : String(document.querySelector('.rail-item.rail-folder')
                ?.getAttribute('title') || '').trim();
          var sm = (window.__yapperFolderStrength || {})[key];
          if (sm != null) return Math.max(0, Math.min(100, Math.round(Number(sm))));
          if (window.__yapperFolderAlpha != null) return Math.round(window.__yapperFolderAlpha * 100);
          var m = live.match(/rgba?\([^)]*?,\s*([0-9.]+)\s*\)/i);
          return m ? Math.round(Number(m[1]) * 100) : 100;
        })();

        var picker = document.createElement('input');
        picker.type = 'color';
        picker.value = liveHex;
        picker.title = 'Custom folder colour';
        picker.setAttribute('aria-label', 'Custom folder colour');
        picker.style.cssText = 'width:34px;height:34px;padding:0;border:1px solid var(--border);'
          + 'border-radius:8px;background:none;cursor:pointer;';

        var alpha = document.createElement('input');
        alpha.type = 'range';
        alpha.min = '0'; alpha.max = '100'; alpha.value = String(liveAlpha);
        alpha.title = 'Transparency';
        alpha.setAttribute('aria-label', 'Folder transparency');
        alpha.style.cssText = 'width:96px;accent-color:var(--accent);';

        var pct = document.createElement('span');
        pct.textContent = liveAlpha + '%';
        pct.style.cssText = 'min-width:38px;font-variant-numeric:tabular-nums;';

        var preview = document.createElement('span');
        preview.style.cssText = 'width:34px;height:34px;border-radius:8px;'
          + 'border:1px solid var(--border);flex:0 0 auto;';

        // Mirror our pick onto the app's state: mark a matching preset active
        // when there is one, clear the app's own selection otherwise, then set
        // the folder CSS var exactly as the app does so Save picks it up.
        var applyToFolder = () => {
          var hex = picker.value;
          var alphaPct = Number(alpha.value) / 100;
          // Stored as a pure hex so the colour survives a restart unchanged;
          // the strength is published separately as the mix weight.
          var css = hex;
          preview.style.background = css;
          pct.textContent = alpha.value + '%';
          // Live preview on the tile itself: --folder is what paints
          // .rail-item.rail-folder, so the change is visible as you drag.
          if (liveBtn && liveBtn.isConnected) {
            liveBtn.style.setProperty('--yapper-folder-tint', css);
            liveBtn.style.setProperty('--yapper-folder-strength', String(alpha.value));
            liveBtn.setAttribute('data-yapper-folder-tinted', '1');
            var livePlate = getPlate(liveBtn);
            livePlate.style.setProperty('--yapper-folder-tint', css);
            livePlate.style.setProperty('--yapper-folder-strength', String(alpha.value));
            livePlate.setAttribute('data-yapper-folder-tinted', '1');
          }
          for (var s of sw.querySelectorAll('.swatch')) s.classList.remove('on');
          var match = [...sw.querySelectorAll('.swatch')].find(s =>
            String(s.getAttribute('title') || '').toLowerCase() === hex.toLowerCase()
            && alphaPct >= 1);
          if (match) match.classList.add('on');

          // Watch the app's own swatches. Picking a preset must hand control back to
          // the app, otherwise our re-apply silently reverts the choice and the
          // whole palette looks broken.
          for (var s of sw.querySelectorAll('.swatch')) {
            if (s.__yapperWired) continue;
            s.__yapperWired = true;
            s.addEventListener('click', () => {
              window.__yapperFolderColour = '';
              window.__yapperFolderHex = '';
              window.__yapperFolderAlpha = null;
              window.__yapperUserPickedPreset = true;
              var pb = document.querySelector('.rail-item.rail-folder');
              var pf = pb ? folderKeyOf(folderName(pb), pb) : '';
              var pmod = modBridge();
              if (pmod && pmod.folderIcon && pmod.folderIcon.saveColour && pf) {
                pmod.folderIcon.saveColour(pf, '', 100);
              }
            });
          }

          window.__yapperFolderColour = css;
          window.__yapperFolderHex = hex;
          window.__yapperFolderAlpha = alphaPct;
          window.__yapperFolderApplied = css;
          window.__yapperUserPickedPreset = false;
          // Tint only the folder whose dialog is open. querySelector would
          // always return the FIRST folder, so editing the second silently
          // recoloured the first and then the per-folder pass reverted it.
          var btn = (lastFolder && lastFolder.isConnected)
            ? lastFolder
            : document.querySelector('.rail-item.rail-folder');
          // One key for everything below. The cache used to be written under
          // the raw name while the file was written under the folder id, so the
          // sweep - which looks the id up - found nothing and removed the tint
          // the picker had just set. That is why the colour never stuck.
          var key = btn ? folderKeyOf(folderName(btn), btn) : '';
          if (btn) {
            btn.style.setProperty('--yapper-folder-strength', String(alpha.value));
            btn.style.setProperty('--yapper-folder-tint', css);
            btn.setAttribute('data-yapper-folder-tinted', '1');
            var plate = getPlate(btn);
            plate.style.setProperty('--yapper-folder-tint', css);
            plate.style.setProperty('--yapper-folder-strength', String(alpha.value));
            plate.setAttribute('data-yapper-folder-tinted', '1');
            // Keep the live cache in step, or the per-folder pass on the next
            // sweep reverts the edit from the stale saved value.
            window.__yapperFolderColours = window.__yapperFolderColours || {};
            window.__yapperFolderColours[key] = css;
            window.__yapperFolderStrength = window.__yapperFolderStrength || {};
            window.__yapperFolderStrength[key] = Number(alpha.value);
          }
          // Persist so the colour is still there after a restart.
          var bmod = modBridge();
          var fname = key;
          if (bmod && bmod.folderIcon && bmod.folderIcon.saveColour && fname) {
            bmod.folderIcon.saveColour(fname, css, alpha.value);
          }
        };

        picker.addEventListener('input', applyToFolder);
        alpha.addEventListener('input', applyToFolder);

        box.appendChild(picker);
        box.appendChild(alpha);
        box.appendChild(pct);
        box.appendChild(preview);
        sw.parentElement.appendChild(box);
        applyToFolder();
        return true;
      };
      // Never rebuild an existing picker. Removing and re-inserting the node
      // mutates the DOM, which wakes this very observer - a self-feeding loop
      // that pinned the renderer and took the window down. If the box is
      // already present, leave it completely alone.
      var existingBox = () => {
        var m = [...document.querySelectorAll('.overlay .modal')]
          .find(x => /folder settings/i.test(x.getAttribute('aria-label') || ''));
        return m ? m.querySelector('[data-yapper-color]') : null;
      };
      if (existingBox()) return;

      // Watch only until the modal first appears, then disconnect. The app
      // rebuilds the dialog each time it opens, so re-arm on every right-click.
      var tries = 0;
      var obs = new MutationObserver(() => {
        if (paint() || ++tries > 60) obs.disconnect();
      });
      obs.observe(document.body, { childList: true, subtree: true });
      paint();
    };

    var wireFolderIconMenu = () => {
      if (window.__yapperFolderMenu) return;
      window.__yapperFolderMenu = true;
      var pickFor = (key) => {
        var br = modBridge();
        if (!br || !br.folderIcon) return;
        br.folderIcon.pick(key).then((r) => {
          if (!r || !r.name) return;
          // The main process re-injects on save, which republishes the map.
          // Re-read from the flag the injection wrote, then repaint.
          setTimeout(() => {
            var m = (window.__yapperFlags || {}).FOLDER_ICONS || {};
            window.__yapperFolderIcons = m;
            paintFolders();
          }, 120);
        });
      };
      var clearFor = (key) => {
        var br = modBridge();
        if (!br || !br.folderIcon) return;
        br.folderIcon.clear(key).then(() => {
          setTimeout(() => {
            var m = (window.__yapperFlags || {}).FOLDER_ICONS || {};
            window.__yapperFolderIcons = m;
            paintFolders();
          }, 120);
        });
      };

      // Do NOT build our own menu. The app already opens a .ctx-menu for a
      // folder (Rename folder / Folder color / Ungroup); a second menu on top
      // of it covered the native one. Instead wait for the app's menu and add
      // our entries into it, so everything stays in one place.
      var inject = () => {
        var menu = document.querySelector('.ctx-menu');
        if (!menu) return false;
        if (menu.querySelector('[data-yapper-folder-icon]')) return true;
        // Which folder was right-clicked? The menu sits next to the target.
        var btn = lastFolder;
        if (!btn || !btn.isConnected) return false;
        lastFolder = btn;
        var key = folderKeyOf(folderName(btn), btn);
        var icons = window.__yapperFolderIcons || {};

        var sep = () => {
          var s = document.createElement('div');
          s.className = 'sep';
          return s;
        };
        var item = (label, fn) => {
          var b = document.createElement('button');
          b.textContent = label;
          b.setAttribute('data-yapper-folder-icon', '');
          // Clone the look of the app's own buttons so it looks native.
          var sample = menu.querySelector('button');
          if (sample && sample.getAttribute('style')) b.setAttribute('style', sample.getAttribute('style'));
          // Close the menu exactly like the app's own items do: run the action,
          // then var the overlay remove itself. Tearing it down by hand left
          // the app's own dismiss handler with a detached node to clean up.
          b.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            fn();
            var ov = menu.parentElement;
            if (ov && ov.classList.contains('overlay')) {
              var r = ov.getBoundingClientRect();
              var o = { bubbles: true, cancelable: true, view: window,
                clientX: Math.round(r.left + 8), clientY: Math.round(r.top + r.height - 8) };
              ov.dispatchEvent(new PointerEvent('pointerdown', o));
              ov.dispatchEvent(new MouseEvent('mousedown', o));
              ov.dispatchEvent(new MouseEvent('mouseup', o));
              ov.dispatchEvent(new MouseEvent('click', o));
            } else {
              menu.remove();
            }
          });
          return b;
        };

        // Lift the whole overlay above app content. The rail sits in the normal flow,
        // so any ancestor that forms a stacking context can trap the menu.
        // The app's .overlay is a full-screen grid that catches the click which
        // dismisses the menu, so keep it interactive - only z-index is changed.
        var overlay = menu.parentElement;
        if (overlay && overlay.classList.contains('overlay')) {
          overlay.style.zIndex = '2147483000';
        }

        var ungroup = [...menu.querySelectorAll('button')].find(b => /ungroup/i.test(b.textContent || ''));
        if (ungroup) {
          // The app already puts a .sep before Ungroup; reuse it instead of
          // adding a second one, which rendered as a double rule.
          var before = ungroup.previousElementSibling;
          if (!before || !before.classList.contains('sep')) menu.insertBefore(sep(), ungroup);
          menu.insertBefore(item(icons[key] ? 'Change folder image' : 'Set folder image', () => pickFor(key)), ungroup);
          if (icons[key]) menu.insertBefore(item('Clear folder image', () => clearFor(key)), ungroup);
        } else {
          menu.appendChild(sep());
          menu.appendChild(item(icons[key] ? 'Change folder image' : 'Set folder image', () => pickFor(key)));
          if (icons[key]) menu.appendChild(item('Clear folder image', () => clearFor(key)));
        }
        return true;
      };

      // Watch for the menu instead of polling on rAF. rAF is throttled to a
      // standstill in an occluded window, and the app takes a few hundred ms to
      // build the menu, so a frame-count poll gave up before it appeared.
      var pending = false;
      var startWatch = () => {
        if (pending) return;
        pending = true;
        var deadline = Date.now() + 4000;
        var obs = new MutationObserver(() => {
          if (inject()) { obs.disconnect(); pending = false; return; }
          if (Date.now() > deadline) { obs.disconnect(); pending = false; }
        });
        obs.observe(document.body, { childList: true, subtree: true });
        inject();
      };

      // The app's own folder menu has no Escape handler, so a folder menu could
      // only be dismissed with the mouse. Add one for consistency.
      if (!window.__yapperFolderEsc) {
        window.__yapperFolderEsc = true;
        document.addEventListener('keydown', (e) => {
          if (e.key !== 'Escape') return;
          var menu = document.querySelector('.ctx-menu');
          if (!menu) return;
          e.preventDefault();
          e.stopPropagation();
          // Close the way the app does: a real click on its own overlay. Removing
          // the node outright left React thinking a menu was still open, and the
          // next right-click was then swallowed - so the folder menu only worked
          // again after a restart.
          var ov = menu.parentElement;
          if (ov && ov.classList.contains('overlay')) {
            var r = ov.getBoundingClientRect();
            var opts = { bubbles: true, cancelable: true, view: window,
              clientX: Math.round(r.left + 8), clientY: Math.round(r.top + r.height - 8) };
            ov.dispatchEvent(new PointerEvent('pointerdown', opts));
            ov.dispatchEvent(new MouseEvent('mousedown', opts));
            ov.dispatchEvent(new MouseEvent('mouseup', opts));
            ov.dispatchEvent(new MouseEvent('click', opts));
          } else {
            menu.remove();
          }
        }, true);
      }
      document.addEventListener('contextmenu', (e) => {
        var btn = e.target && e.target.closest ? e.target.closest('.rail-item.rail-folder') : null;
        if (!btn) return;
        lastFolder = btn;
        // Let the app open its own menu untouched; we only add to it.
        startWatch();
        // Re-arm the colour picker: the app drops unknown nodes each time it
        // rebuilds the Folder settings dialog, so it has to be re-added then.
        window.__yapperColorArmed = false;
        wireFolderColorPicker();
      }, true);
    };

    // ---- Extra colour themes, injected into the app's own theme grid ----
    // The app renders each theme as <button class="tint-tile"> holding a
    // <span class="tint-name">, painted with an inline linear-gradient.
    // Picking one writes --tint-a/b/c/k onto documentElement and stores
    // {"key":"..."} in localStorage under yapper-color. These five reuse that
    // exact markup and that exact apply path, so they are indistinguishable
    // from the built-in ones.
    var CUSTOM_THEMES = [
      { key: 'ym-ember',   name: 'Ember Glow',    a: 'rgb(255, 94, 51)',   b: 'rgb(120, 26, 14)' },
      { key: 'ym-grape',   name: 'Grape Soda',    a: 'rgb(147, 51, 234)',  b: 'rgb(219, 39, 119)' },
      { key: 'ym-arctic',  name: 'Arctic Drift',  a: 'rgb(125, 211, 252)', b: 'rgb(30, 64, 110)' },
      { key: 'ym-toxic',   name: 'Toxic Lime',    a: 'rgb(132, 204, 22)',  b: 'rgb(22, 78, 40)' },
      { key: 'ym-bubble',  name: 'Bubblegum',     a: 'rgb(244, 114, 182)', b: 'rgb(120, 53, 90)' },
      { key: 'ym-winhawk', name: 'Frost Blur',      a: 'rgb(122, 162, 255)', b: 'rgb(88, 96, 140)', seeThrough: true },
    ];
    var hexOf = (rgb) => {
      // [0-9.] not \d: this whole file is embedded in a template
      // literal, where a backslash escape would collapse and break the regex.
      var m = String(rgb).match(/[0-9.]+/g);
      if (!m) return '#000000';
      return '#' + m.slice(0, 3).map((v) => ('0' + Math.round(Number(v)).toString(16)).slice(-2)).join('');
    };
    var customByKey = (key) => CUSTOM_THEMES.find((t) => t.key === key) || null;
    var currentThemeKey = () => {
      try { return (JSON.parse(localStorage.getItem('yapper-color') || '{}').key) || ''; }
      catch { return ''; }
    };

    // Reproduce the app's own apply step: the three tint vars plus the
    // intensity factor, straight onto documentElement.
    var activeThemeKey = '';

    var useTheme = (t) => {
      var root = document.documentElement;
      activeThemeKey = t.key;
      // Winhawk is pure transparency: no palette at all, it only clears the
      // page background so whatever sits behind the window shows through.
      // Applying a tint here is what made it read as a colour theme.
      if (t.seeThrough) {
        // CSSStyleDeclaration methods live on .style, not the element.
        root.style.removeProperty('--tint-a');
        root.style.removeProperty('--tint-b');
        root.style.removeProperty('--tint-c');
        root.setAttribute('data-ym-theme', 'winhawk');
      } else {
        root.style.setProperty('--tint-a', hexOf(t.a));
        root.style.setProperty('--tint-b', hexOf(t.b));
        root.style.setProperty('--tint-c', hexOf(t.b));
      }
      if (!t.seeThrough) {
        var k = (window.__yapperTintK != null) ? window.__yapperTintK : 0.75;
        root.style.setProperty('--tint-k', String(k));
        root.removeAttribute('data-ym-theme');
      }
      // localStorage cannot be used: the app purges every key it does not
      // own during boot, so any selection written there is gone by the next
      // launch. Persist through the mod's own settings file over IPC.
      // Read the bridge off window directly: modBridge() is declared further
      // down this same scope, and the boot block below calls into here before
      // that var is initialised, which threw a TDZ ReferenceError and killed
      // the whole mod script on every launch once a theme had been saved.
      var bmod = (window.yapperDesktop && window.yapperDesktop.mod) || null;
      if (bmod && bmod.customTheme && bmod.customTheme.save) {
        try { bmod.customTheme.save(t.key); } catch { /* keep the tint for this session */ }
      }
      try {
        // Mirror into the app's own key so its UI shows the tile as selected.
        localStorage.setItem('yapper-color', JSON.stringify({ key: t.key }));
      } catch { /* private mode */ }
    };

    // Drop the Winhawk marker whenever no custom theme is active, so picking a
    // built-in theme (or None) restores the normal opaque panels.
    var clearSeeThrough = () => {
      var k = activeThemeKey || (window.__yapperFlags || {}).CUSTOM_THEME || '';
      if (!customByKey(k) || !customByKey(k).seeThrough) {
        document.documentElement.removeAttribute('data-ym-theme');
      }
    };

    var markTheme = (key) => {
      document.querySelectorAll('.tint-tile').forEach((b) => {
        var mine = b.getAttribute('data-yapper-theme');
        var label = (b.textContent || '').trim();
        b.classList.toggle('on', !!key && (mine === key || (mine == null && label === key)));
      });
    };

    var putThemeBack = () => {
      var key = (window.__yapperFlags || {}).CUSTOM_THEME || '';
      if (!key) return;
      var mine = customByKey(key);
      if (!mine) return;
      var root = document.documentElement;
      // The app clears the root vars during its own boot, so re-assert ours
      // whenever they are missing rather than only once at startup.
      if (root.style.getPropertyValue('--tint-a') === hexOf(mine.a)) return;
      useTheme(mine);
    };

    // A one-off toast. Used to warn about Winhawk exactly once.
    //
    // The guard MUST be a plain in-memory flag set synchronously here. An
    // earlier version relied on the injected WINHAWK_WARNED flag, which is
    // only computed at page load, so within one session it never turned true:
    // every sweep built a fresh toast, each toast was a DOM mutation, and the
    // mutation observer woke the sweep again. That loop pinned the CPU and
    // froze the machine.
    var toastShown = false;
    var toastIt = (msg) => {
      if (toastShown) return;
      toastShown = true;
      var old = document.getElementById('toastIt');
      if (old) old.remove();
      var t = document.createElement('div');
      t.id = 'toastIt';
      t.className = 'toast-yapper';
      t.textContent = msg;
      t.style.cssText = 'position:fixed;left:50%;bottom:26px;transform:translateX(-50%);'
        + 'z-index:9999;max-width:440px;padding:12px 16px;border-radius:12px;'
        + 'font:500 13px/1.45 inherit;color:#fff;cursor:pointer;';
      document.body.appendChild(t);
      var kill = () => t.remove();
      t.addEventListener('click', kill);
      setTimeout(kill, 11000);
    };

    var warnWinhawkOnce = () => {
      if (toastShown) return;
      var flags = window.__yapperFlags || {};
      var key = activeThemeKey || flags.CUSTOM_THEME || '';
      var mine = customByKey(key);
      if (!mine || !mine.seeThrough) return;
      if (flags.WINHAWK_WARNED) return;
      toastIt('Winhawk makes the interface see-through. Menus keep their own '
        + 'blurred backing so they stay readable, but bright text over a busy '
        + 'backdrop can still be hard to read. This notice shows only once.');
      var b = (window.yapperDesktop && window.yapperDesktop.mod) || null;
      if (b && b.customTheme && b.customTheme.warned) {
        try { b.customTheme.warned(); } catch { /* notice still shown */ }
      }
    };

    // Clicking any of the app's OWN tiles (including None) has to switch
    // Winhawk off. Without this the saved key survived, putThemeBack kept
    // re-applying it on every sweep, and the theme could never be turned off.
    var dropTheme = () => {
      activeThemeKey = '';
      var flags = window.__yapperFlags || (window.__yapperFlags = {});
      flags.CUSTOM_THEME = '';
      // Our tile must stop looking selected the moment it is switched off.
      document.querySelectorAll('.tint-tile[data-yapper-theme]')
        .forEach((b) => b.classList.remove('on'));
      document.documentElement.removeAttribute('data-ym-theme');
      var sheet = document.getElementById('__yapperWinhawkCss');
      if (sheet) sheet.remove();
      var b = (window.yapperDesktop && window.yapperDesktop.mod) || null;
      if (b && b.customTheme && b.customTheme.save) {
        try { b.customTheme.save(''); } catch { /* already off */ }
      }
    };
    if (!window.__yapperThemeWatch) {
      window.__yapperThemeWatch = true;
      // Everything goes through this one handler on document, not through
      // listeners on the tiles themselves. React rebuilds the grid whenever the
      // theme changes, which threw away any listener we had attached to a tile
      // and left that tile dead - picking a theme while Frost Blur was on would
      // change nothing at all.
      var onTileClick = (e) => {
        var tile = e.target && e.target.closest ? e.target.closest('.tint-tile') : null;
        if (!tile) return;
        var key = tile.getAttribute('data-yapper-theme');
        if (key) {
          var theme = customByKey(key);
          if (!theme) return;
          if (!theme.seeThrough) {
            var flags = window.__yapperFlags || (window.__yapperFlags = {});
            flags.CUSTOM_THEME = theme.key;
          }
          useTheme(theme);
          markTheme(theme.key);
          winhawkCss();
          return;
        }
        // One of the app's own tiles: Frost Blur is no longer wanted.
        dropTheme();
        setTimeout(() => { clearSeeThrough(); winhawkCss(); markTheme(''); }, 0);
      };
      document.addEventListener('click', onTileClick, true);
    }

    // The Winhawk stylesheet is mounted while the Winhawk theme is selected
    // and removed as soon as any other theme is picked, so there is no toggle
    // to remember. Adding or removing the node is a DOM mutation, so this is
    // guarded by its own presence check and cannot feed the sweep.
    var winhawkOn = () => {
      var flags = window.__yapperFlags || {};
      var key = activeThemeKey || flags.CUSTOM_THEME || '';
      var t = customByKey(key);
      return !!(t && t.seeThrough);
    };
    var winhawkCss = () => {
      var on = winhawkOn();
      var existing = document.getElementById('__yapperWinhawkCss');
      if (!on) { if (existing) existing.remove(); return; }
      if (existing) return;
      var b64 = (window.__yapperFlags || {}).WINHAWK_CSS_B64 || '';
      if (!b64) return;
      var css = '';
      try { css = decodeURIComponent(escape(window.atob(b64))); }
      catch { css = window.atob(b64); }
      var el = document.createElement('style');
      el.id = '__yapperWinhawkCss';
      el.textContent = css;
      (document.head || document.documentElement).appendChild(el);
    };

    // ---- download button on voice messages ----
    // The audio URL is not in the DOM; it lives in an ancestor React fiber as
    // props.url. The button itself is mounted on document.body and parked over
    // whichever .voice-msg is hovered, so React never owns it and cannot
    // reconcile it away.
    var voiceUrl = (el) => {
      var fk = Object.keys(el).find((k) => k.indexOf('__reactFiber') === 0);
      var node = fk ? el[fk] : null;
      var hops = 0;
      while (node && hops < 14) {
        var props = node.memoizedProps || node.pendingProps;
        if (props && typeof props.url === 'string' && /^https?:/i.test(props.url)) return props.url;
        node = node.return;
        hops++;
      }
      return '';
    };
    var DL_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" '
      + 'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M12 3v12"></path><path d="m7 10 5 5 5-5"></path><path d="M5 21h14"></path></svg>';
    var getDlBtn = () => {
      var btn = document.getElementById('yapperVoiceDl');
      if (btn) return btn;
      btn = document.createElement('button');
      btn.id = 'yapperVoiceDl';
      btn.type = 'button';
      btn.title = 'Download voice message';
      btn.setAttribute('aria-label', 'Download voice message');
      btn.innerHTML = DL_ICON.replace('<svg', '<svg style="pointer-events:none"');
      btn.style.cssText = 'position:fixed;z-index:9000;display:none;align-items:center;'
        + 'justify-content:center;width:26px;height:26px;padding:0;border-radius:50%;'
        + 'border:1px solid var(--border);background:rgba(18,18,22,0.92);color:var(--text);'
        + 'cursor:pointer;opacity:0;transition:opacity .12s ease;';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        var url = btn.getAttribute('data-url');
        if (!url) return;
        var b = (window.yapperDesktop && window.yapperDesktop.mod) || null;
        if (b && b.download && b.download.file) b.download.file(url);
        btn.style.opacity = '0';
      });
      document.body.appendChild(btn);
      return btn;
    };
    if (!window.__yapperVoiceWatch) {
      window.__yapperVoiceWatch = true;
      // The button lives on document.body, so it is NOT inside .voice-msg.
      // Moving the pointer onto it fires mouseover on the button itself and
      // mouseout on the message, which used to hide it the instant you got
      // there and made it impossible to click.
      var onDlButton = (n) => !!(n && n.closest && n.closest('#yapperVoiceDl'));
      var hideTimer = null;
      var hideSoon = () => {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = setTimeout(() => {
          hideTimer = null;
          var b = document.getElementById('yapperVoiceDl');
          if (b) { b.style.opacity = '0'; b.style.display = 'none'; }
        }, 160);
      };
      document.addEventListener('mouseover', (e) => {
        if (onDlButton(e.target)) {
          if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
          var b = document.getElementById('yapperVoiceDl');
          if (b) { b.style.opacity = '1'; b.style.display = 'flex'; }
          return;
        }
        var host = e.target && e.target.closest ? e.target.closest('.voice-msg') : null;
        var btn = getDlBtn();
        if (!host) { hideSoon(); return; }
        var url = voiceUrl(host);
        if (!url) { hideSoon(); return; }
        var r = host.getBoundingClientRect();
        btn.setAttribute('data-url', url);
        btn.style.display = 'flex';
        // Outside the bar: overlapping it made the button flicker, because
        // crossing onto the button fired mouseout on the message itself.
        btn.style.left = Math.round(r.right + 6) + 'px';
        // Sits above the centre line so it never covers the elapsed time.
        btn.style.top = Math.round(r.top + 4) + 'px';
        btn.style.opacity = '1';
      }, true);
      document.addEventListener('mouseout', (e) => {
        if (onDlButton(e.relatedTarget)) return;
        var host = e.target && e.target.closest ? e.target.closest('.voice-msg') : null;
        if (!host) return;
        if (e.relatedTarget && host.contains(e.relatedTarget)) return;
        hideSoon();
      }, true);
      // The message list virtualises, so re-hide when the node under the
      // pointer is replaced out from under us.
      window.addEventListener('scroll', () => {
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
        var btn = document.getElementById('yapperVoiceDl');
        if (btn) { btn.style.opacity = '0'; btn.style.display = 'none'; }
      }, true);
    }

    var addThemes = () => {
      putThemeBack();
      winhawkCss();
      clearSeeThrough();
      warnWinhawkOnce();
      var grid = document.querySelector('.tint-grid');
      if (!grid) return;
      for (var t of CUSTOM_THEMES) {
        if (grid.querySelector('[data-yapper-theme="' + t.key + '"]')) continue;
        var tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'tint-tile';
        tile.setAttribute('data-yapper-theme', t.key);
        tile.style.background = 'linear-gradient(135deg, ' + t.a + ', ' + t.b + ')';
        var name = document.createElement('span');
        name.className = 'tint-name';
        name.textContent = t.name;
        tile.appendChild(name);
        grid.appendChild(tile);
      }
      markTheme(currentThemeKey());
    };

    // On boot, re-apply ours: the app only knows its own keys, so it would
    // otherwise reset the root vars back to untinted on the next load.
    (() => {
      var saved = (window.__yapperFlags || {}).CUSTOM_THEME || '';
      var mine = customByKey(saved || currentThemeKey());
      if (!mine) return;
      var strength = document.querySelector('.tint-intensity input[type=range]');
      if (strength && strength.value) window.__yapperTintK = Number(strength.value) / 100;
      useTheme(mine);
    })();

    // ---- Link cleaner (AdblockerPlugin) ----
// Scrubs the tracking parameters that ride along on shared links. Only real
// outbound http(s) links are touched, and never the app's own domains.
var TRACK_Q = /[?&](utm_[^=&#]*|fbclid|gclid|gbraid|wbraid|msclkid|mc_cid|mc_eid|igshid|yclid|_hsenc|_hsmi|vero_id|ref_src|spm)=/i;
var SELF_HOST = /(^|\\.)(yapper|discord|discordapp)\\./i;
var cleanLinks = () => {
  if (!(window.__yapperFlags || {}).ADBLOCK) return;
  var links = document.querySelectorAll('a[href]');
  for (var i = 0; i < links.length; i++) {
    var a = links[i];
    var href = a.getAttribute('href') || '';
    // cheap test first: most links carry nothing worth removing
    if (!TRACK_Q.test(href)) continue;
    var u;
    try { u = new URL(href, location.href); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    if (SELF_HOST.test(u.hostname)) continue;
    var drop = [];
    u.searchParams.forEach(function (v, k) { if (TRACK_Q.test('?' + k + '=')) drop.push(k); });
    if (!drop.length) continue;
    drop.forEach(function (k) { u.searchParams.delete(k); });
    a.setAttribute('href', u.toString());
    a.setAttribute('rel', 'noreferrer noopener');
  }
};

// ---- 24 hour clock (Timestamps) ----
// Rewrites "Today at 3:05 AM" into "Today at 15:05". The memo is compared
// against the live text, so a React re-render that puts the original back
// simply gets rewritten again on the next sweep.
var clock24 = () => {
  if (!(window.__yapperFlags || {}).TIMESTAMP24) return;
  var els = document.querySelectorAll('.msg-time, .msg-hover-time');
  for (var i = 0; i < els.length; i++) {
    var el = els[i];
    var txt = el.textContent || '';
    if (el.__ym24 === txt) continue;
    // Every backslash here is doubled on purpose. This whole block is shipped
    // inside a template literal, where a lone \d silently collapses to a plain
    // "d" - the regex still parses, it just stops matching anything at all.
    var m = txt.match(/^(\\s*(?:Today|Yesterday)(?:\\s+at)?\\s*)?(\\d{1,2}):(\\d{2})\\s*([AaPp])\\.?\\s*[Mm]\\.?(\\s*)$/);
    if (!m) continue;
    var h = Number(m[2]) % 12;
    if (m[4].toLowerCase() === 'p') h += 12;
    var out = (m[1] || '') + (h < 10 ? '0' + h : String(h)) + ':' + m[3] + (m[5] || '');
    el.__ym24 = out;
    el.textContent = out;
  }
};

// ---- Emoji tagging (MoreEmojiSizes) ----
// Only small images count, so attachments and embeds keep their own size.
var tagEmojis = () => {
  // Always tag, whatever the slider says. The size itself is CSS, and the flag
  // is baked in when the renderer is injected - gating on it meant moving the
  // slider did nothing until the app was restarted.
  var imgs = document.querySelectorAll('.msg-text img, .msg-content img');
  for (var i = 0; i < imgs.length; i++) {
    var im = imgs[i];
    var w = Number(im.getAttribute('width') || 0) || im.naturalWidth || 0;
    if (!w || w > 64) continue;
    im.setAttribute('data-ym-emoji', '1');
  }
};

// ---- Auto hide bot messages (AutoDeleteMessages) ----
// One timer per message, tracked by id, so a re-render never stacks duplicates.
var fadeTimers = {};
var autoHideBots = () => {
  var secs = Number((window.__yapperFlags || {}).AUTO_DELETE || 0);
  var list = document.querySelectorAll('.msg');
  for (var i = 0; i < list.length; i++) {
    var m = list[i];
    if (!m.querySelector('.ubadge.bot')) continue;
    var key = m.getAttribute('data-message-id') || '';
    if (!key) {
      if (!m.__ymFadeKey) m.__ymFadeKey = 'f' + Math.random().toString(36).slice(2);
      key = m.__ymFadeKey;
    }
    if (secs <= 0) {
      m.removeAttribute('data-ym-fade');
      if (fadeTimers[key]) { clearTimeout(fadeTimers[key]); delete fadeTimers[key]; }
      continue;
    }
    if (fadeTimers[key]) continue;
    var when = key;
    fadeTimers[key] = setTimeout(function () {
      var q = document.querySelector('[data-message-id="' + when + '"]');
      if (q) q.setAttribute('data-ym-fade', '1');
    }, secs * 1000);
  }
};

// ---- Open message links in the system browser (openInBrowser) ----
// Delegated and scoped to message bodies and embeds, so nothing else in the
// app can be swallowed by the handler. Modifier clicks are left alone so the
// usual "open in new tab" still works.
var linkHandler = (e) => {
  if (!(window.__yapperFlags || {}).EXTERNAL_LINKS) return;
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
  var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
  if (!a || !a.closest('.msg-text, .msg-content')) return;
  var href = String(a.getAttribute('href') || '');
  if (href.slice(0, 7) !== 'http://' && href.slice(0, 8) !== 'https://') return;
  var br = modBridge();
  if (!br || !br.openExternal) return;
  e.preventDefault();
  e.stopPropagation();
  try { br.openExternal(a.href); } catch { /* nothing we can do */ }
};

// ---- Delete key (NoDeleteKeybind) ----
// Only swallows it while nothing is being typed into.
var deleteHandler = (e) => {
  if (!(window.__yapperFlags || {}).NO_DELETE_KEY) return;
  if (e.key !== 'Delete') return;
  var t = document.activeElement;
  var tag = t && t.tagName ? String(t.tagName).toUpperCase() : '';
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  if (t && (t.isContentEditable || t.value)) return;
  e.preventDefault();
  e.stopPropagation();
};
if (!document.__ymLinkWired) {
  document.__ymLinkWired = true;
  document.addEventListener('click', linkHandler, true);
}
if (!document.__ymDelWired) {
  document.__ymDelWired = true;
  document.addEventListener('keydown', deleteHandler, true);
}

var sweepAll = () => { setupAbout(); sweepMessages(); swapEmoji(); expandEmoji(); showOnline(); applyBg(); paintFolders(); wireFolderColorPicker(); addThemes(); cleanLinks(); clock24(); tagEmojis(); autoHideBots(); };
    paintFolders();
    wireFolderIconMenu();
    wireFolderColorPicker();
    addThemes();
    if (!window.__yapperMsgWatch) {
      window.__yapperMsgWatch = true;
      // Calls straight through rather than via requestAnimationFrame: rAF is
      // throttled to a standstill in occluded/hidden windows, so the mods would
      // silently stop applying whenever Yapper was in the background. This only
      // ever adds nodes, so it cannot loop.
      new MutationObserver(() => { ensureTab(); syncTabState(); sweepAll(); })
        .observe(document.documentElement, { childList: true, subtree: true });
    }

    // ---- "Yapper Mod" tab, injected into the app's own settings panel ----
    // React owns this DOM and will happily wipe unknown nodes on re-render, so
    // every piece is re-asserted by an observer rather than inserted once.
    var NAV = 'nav.settings-nav';
    var MAIN = 'section.settings-main';
    var ID = 'yapperModTab';
    var restyle = (btn, on) => {
      btn.style.cssText = 'padding:8px 10px;border-radius:6px;font-size:15px;font-weight:500;'
        + 'text-align:left;width:100%;border:0;cursor:pointer;font-family:inherit;'
        + 'color:' + (on ? '#f4f4f5' : 'rgba(255,255,255,0.62)') + ';'
        + 'background:' + (on ? 'rgba(255,255,255,0.16)' : 'transparent');
    };
    var wire = (panel) => {
      panel.querySelectorAll('[data-mod-key]').forEach(inp => {
        var key = inp.dataset.modKey;
        inp.onchange = () => {
          var val = inp.type === 'checkbox' ? inp.checked : inp.value;
          window.__yapperSyncHold = Date.now() + 1200;
          if (key === 'fallback' && val) {
            var n = document.getElementById('yapperRestartNote');
            if (n) n.textContent = 'Media placeholders are now on. Quit Yapper from the tray and reopen it to apply.';
          }
          inp.checked = inp.type === 'checkbox' ? !!val : inp.checked;
          var bridge = window.yapperDesktop && window.yapperDesktop.mod;
          try { bridge && bridge.set({ [key]: val }); } catch (e) {}
        };
      });
    };
    var render = () => {
      // React never clears .active from our button because it does not own it,
      // so without this guard the observer rebuilt our panel over whatever tab
      // the user had just switched to, and the settings nav became unusable.
      if (!window.__yapperModActive) return;
      var main = document.querySelector(MAIN);
      var btn = document.getElementById(ID);
      if (!main || !btn || !btn.classList.contains('active')) return;
      if (document.getElementById('yapperModPanel')) return;
      mountPanel(main);
      var panel = document.getElementById('yapperModPanel');
      if (panel) wire(panel);
      mountEditor();
    };
    // Sync control values in place. Rebuilding innerHTML here would throw away
    // whatever the user is currently editing (a colour picker mid-drag, say).
    var refreshPanel = () => {
      var panel = document.getElementById('yapperModPanel');
      if (!panel) return;
      // A click round-trips through IPC and back before the new settings land.
      // Re-syncing inside that window fought the user's click and made every
      // checkbox look like it needed a second click.
      if (window.__yapperSyncHold && Date.now() < window.__yapperSyncHold) return;
      window.__yapperSyncHold = 0;
      var C = window.__yapperCur || CUR;
      panel.querySelectorAll('[data-mod-key]').forEach(inp => {
        var k = inp.dataset.modKey;
        if (!(k in C)) return;
        if (inp.type === 'checkbox') {
          if (inp.checked !== !!C[k]) inp.checked = !!C[k];
        } else if (inp.value !== C[k]) {
          inp.value = C[k];
        }
      });
    };
    // ---- custom CSS editor ----
    var modBridge = () => window.yapperDesktop && window.yapperDesktop.mod;
    var cssStatus = (t) => { var s = document.getElementById('yapperCssStatus'); if (s) s.textContent = t; };
    var loadCss = () => {
      var b = modBridge(), ta = document.getElementById('yapperCssEditor');
      if (!b || !b.css || !ta) return;
      // React re-renders this modal on its own schedule and wipes our panel.
      // An unsaved draft lives outside the DOM so typing is never lost.
      if (typeof window.__yapperCssDraft === 'string') {
        ta.value = window.__yapperCssDraft;
        cssStatus('Unsaved changes');
        return;
      }
      var want = ta;
      b.css.read().then((txt) => { if (document.getElementById('yapperCssEditor') === want) want.value = txt || ''; }).catch(() => {});
    };
    var saveCss = () => {
      var b = modBridge(), ta = document.getElementById('yapperCssEditor');
      if (!b || !b.css || !ta) return;
      b.css.write(ta.value)
        .then((ok) => {
          if (ok) delete window.__yapperCssDraft;
          cssStatus(ok ? 'Saved ' + new Date().toLocaleTimeString() : 'Save failed');
        })
        .catch(() => cssStatus('Save failed'));
    };
    var wireEditor = () => {
      var ta = document.getElementById('yapperCssEditor');
      var b = modBridge();
      if (!ta || !b || !b.css) return;
      ta.oninput = () => { window.__yapperCssDraft = ta.value; cssStatus('Unsaved changes'); };
      ta.onkeydown = (e) => {
        if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); saveCss(); return; }
        if (e.key === 'Tab') {
          e.preventDefault();
          var s = ta.selectionStart, en = ta.selectionEnd;
          ta.value = ta.value.slice(0, s) + '  ' + ta.value.slice(en);
          ta.selectionStart = ta.selectionEnd = s + 2;
          window.__yapperCssDraft = ta.value;
          cssStatus('Unsaved changes');
        }
      };
      document.querySelectorAll('[data-yapper-css]').forEach(btn => {
        btn.onclick = () => {
          if (btn.getAttribute('data-yapper-css') === 'save') { saveCss(); return; }
          b.css.write('').then(() => {
            delete window.__yapperCssDraft;
            var t = document.getElementById('yapperCssEditor');
            if (t) t.value = '';
            cssStatus('Reset to empty');
          }).catch(() => cssStatus('Reset failed'));
        };
      });
    };
    // The blur / darkness sliders save as you drag.
    //
    // Delegated, not per-node. Wiring each element directly meant a panel
    // rebuild - or a mount that ran before the markup reached the document -
    // left sliders flagged as wired with no handler actually attached, so
    // dragging did nothing at all. One listener on the document cannot be lost
    // that way, and it keeps working across every re-render.
    // Local copy on purpose. The one further up belongs to the panel builder's
    // scope, and from inside here it is an undefined global - so the handler
    // threw on its first line and the sliders looked dead.
    var sliderText = (v, step) =>
      (step && step < 1) ? (Math.round(Number(v) * 10) / 10).toFixed(1) : String(v);
    var sliderHandler = (e) => {
      var el = e.target;
      if (!el || !el.matches || !el.matches('[data-yapper-slider]')) return;
      var key = el.getAttribute('data-yapper-slider');
      var out = document.querySelector('[data-yapper-slider-out="' + key + '"]');
      if (out) out.textContent = sliderText(el.value, Number(el.getAttribute('step') || 1));
      var patch = {};
      patch[key] = (key === 'bgDim') ? Number(el.value) / 100 : Number(el.value);
      var br = modBridge();
      if (br && br.set) { try { br.set(patch); } catch { /* ignore */ } }
    };
    if (!document.__yapperSliderWired) {
      document.__yapperSliderWired = true;
      document.addEventListener('input', sliderHandler, true);
      document.addEventListener('change', sliderHandler, true);
    }
    var wireSliders = () => {};

    var wireExtra = () => {
      wireSliders();
      var bridge = modBridge();
      document.querySelectorAll('[data-yapper-bg]').forEach(b => {
        b.onclick = () => {
          var br = modBridge();
          var st = document.getElementById('yapperBgStatus');
          var act = b.getAttribute('data-yapper-bg');
          if (act === 'pick') {
            br.bg.pick().then(r => {
              if (st) st.textContent = r && r.name ? 'Using ' + r.name + ' (' + r.kind + ')' : 'No background chosen';
            });
          } else if (act === 'clear') {
            br.bg.clear().then(() => { if (st) st.textContent = 'No background chosen'; });
          }
        };
      });
    };
    var wireRandom = () => {
      document.querySelectorAll('[data-yapper-random]').forEach(b => {
        b.onclick = () => {
          var bridge = modBridge();
          if (!bridge) return;
          var hue = Math.floor(Math.random() * 360);
          var col = 'hsl(' + hue + ' 78% 58%)';
          var probe = document.createElement('div');
          probe.style.color = col;
          document.body.appendChild(probe);
          var hex = getComputedStyle(probe).color;
          probe.remove();
          var m = hex.match(/\d+/g) || [0, 0, 0];
          var to2 = n => Number(n).toString(16).padStart(2, '0');
          var rgb = '#' + to2(m[0]) + to2(m[1]) + to2(m[2]);
          var inp = document.querySelector('#yapperModPanel input[data-mod-key="forceAccent"]');
          if (inp) inp.value = rgb;
          bridge.set({ forceAccent: rgb });
        };
      });
    };
    var wireGif = () => {
      document.querySelectorAll('[data-yapper-gif]').forEach(btn => {
        btn.onclick = () => {
          var b = modBridge();
          if (!b || !b.gif) return;
          var st = document.getElementById('yapperGifStatus');
          if (btn.getAttribute('data-yapper-gif') === 'pick') {
            b.gif.pick().then((r) => { if (st) st.textContent = r && r.name ? 'Using ' + r.name : 'No GIF chosen'; });
          } else {
            b.gif.clear().then(() => { if (st) st.textContent = 'No GIF chosen'; });
          }
        };
      });
    };
    var mountEditor = () => { wireEditor(); wireGif(); wireRandom(); wireExtra(); loadCss(); };

    // React owns the children of settings-main. Wiping or replacing them makes
    // React abort on its next unmount, which is what used to trap the user on
    // this tab forever. So the panel is ADDED as an overlay child and simply
    // removed again on the way out; React's own nodes are never disturbed.
    var mountPanel = (main) => {
      if (document.getElementById('yapperModPanel')) return;
      if (typeof main.dataset.yapperModInline !== 'string') {
        main.dataset.yapperModInline = main.getAttribute('style') || '';
      }
      main.style.position = 'relative';
      main.style.overflow = 'hidden';
      var panel = document.createElement('div');
      panel.id = 'yapperModPanel';
      panel.setAttribute('style', 'position:absolute;left:0;right:0;top:0;z-index:5;'
        + 'max-height:100%;overflow-y:auto;padding:22px 26px 18px;max-width:640px;background:var(--bg-main);');
      var html = window.__yapperPanelHtml || PANEL_INNER;
      panel.innerHTML = html;
      // Remember the shape we built, so a structural change (e.g. the CSS
      // editor appearing) can rebuild it without rebuilding on every value tweak.
      var keys = [];
      var re = /data-mod-key="([^"]+)"/g;
      var m;
      while ((m = re.exec(html))) keys.push(m[1]);
      keys.sort();
      panel.dataset.yapperSig = keys.join(',') + '|' + (html.indexOf('yapperCssEditor') === -1 ? '-' : 'e');
      main.appendChild(panel);
      // Hide what React rendered underneath instead of deleting it. Deleting
      // it broke React's unmount and locked the nav; this just masks it, so the
      // other tab's content can never peek out below our panel.
      [...main.children].forEach(c => { if (c !== panel) c.style.visibility = 'hidden'; });
    };
    var unmountPanel = () => {
      var panel = document.getElementById('yapperModPanel');
      var host = panel && panel.parentElement;
      if (host) {
        [...host.children].forEach(c => { c.style.visibility = ''; });
        host.removeChild(panel);
      }
      var main = document.querySelector(MAIN);
      if (main && typeof main.dataset.yapperModInline === 'string') {
        if (main.dataset.yapperModInline) main.setAttribute('style', main.dataset.yapperModInline);
        else main.removeAttribute('style');
        delete main.dataset.yapperModInline;
      }
    };

    var openTab = () => {
      var nav = document.querySelector(NAV);
      var main = document.querySelector(MAIN);
      if (!nav || !main) return;
      window.__yapperModActive = true;
      soloActive();
      var btn = document.getElementById(ID);
      btn.classList.add('active');
      restyle(btn, true);
      mountPanel(main);
      wire(document.getElementById('yapperModPanel'));
      refreshPanel();
      mountEditor();
    };
    var ensureTab = () => {
      var nav = document.querySelector(NAV);
      if (!nav) return;
      var btn = document.getElementById(ID);
if (!btn) {
          btn = document.createElement('button');
          btn.id = ID;
          btn.type = 'button';
          btn.textContent = 'Yapcord';
          nav.appendChild(btn);
          restyle(btn, false);
          btn.addEventListener('click', openTab);
          // The dialog keeps its scroll position between opens, and the app's
          // own My Profile pane is ~3000px tall, so a retained scroll left the
          // tab far above the viewport and it looked like the settings had
          // stopped working. Nudge it back into view when it is opened.
          btn.addEventListener('click', () => {
            setTimeout(() => {
              var r = btn.getBoundingClientRect();
              if (r.top < 0 || r.bottom > window.innerHeight) {
                var modal = btn.closest('.modal');
                if (modal) modal.scrollTop += (r.top - 60);
                else btn.scrollIntoView({ block: 'center' });
              }
            }, 0);
          });
        }
      // Any click on another nav tab hands control back to React.
      if (!nav.__yapperModWired) {
        nav.__yapperModWired = true;
        nav.addEventListener('click', (e) => {
          var b = e.target && e.target.closest ? e.target.closest('button') : null;
          if (!b || b.id === ID) return;
          window.__yapperModActive = false;
          unmountPanel();
          var mine = document.getElementById(ID);
          if (mine) { mine.classList.remove('active'); restyle(mine, false); }
        }, true);
      }
      if (window.__yapperModActive) render();
    };
    ensureTab();
    // The settings dialog retains its scroll position between opens. The app's
    // own My Profile pane is about 3000px tall, so a retained scroll left the
    // nav tabs (Yapper Mod included) scrolled out of sight entirely and the
    // settings looked broken. Reset the scroll when the dialog appears.
    if (!window.__yapperModalScroll) {
      window.__yapperModalScroll = true;
      var resetScroll = () => {
        for (var m of document.querySelectorAll('.modal')) {
          if (m.__yapperReset) continue;
          m.__yapperReset = true;
          if (m.scrollTop > 0) m.scrollTop = 0;
        }
      };
      new MutationObserver(resetScroll).observe(document.body, { childList: true, subtree: true });
      // Opening the dialog is a click, which mutates nothing, so the observer
      // above never fires. Hook the settings button directly instead.
      document.addEventListener('click', (e) => {
        var b = e.target && e.target.closest ? e.target.closest('button,[role=button]') : null;
        if (!b || !/settings/i.test(String(b.getAttribute('aria-label') || b.getAttribute('title') || ''))) return;
        // Wait for React to mount the dialog, then rewind any retained scroll.
        // Clear the "already handled" marks first: React reuses the same
        // .modal node across opens, so a stale flag would skip every reopen.
        for (var m of document.querySelectorAll('.modal')) delete m.__yapperReset;
        for (var d of [80, 220, 500]) setTimeout(resetScroll, d);
      }, true);
    }
    // React decides which nav button carries .active. Mirror that decision
    // instead of assuming we own it, otherwise the nav and the overlay can
    // disagree about which tab is showing.
    var syncTabState = () => {
      var btn = document.getElementById(ID);
      if (!btn) return;
      var mine = btn.classList.contains('active');
      var panel = document.getElementById('yapperModPanel');
      if (!mine) {
        window.__yapperModActive = false;
        restyle(btn, false);
        if (panel && panel.parentElement) unmountPanel();
      } else {
        window.__yapperModActive = true;
        soloActive();
        render();
        var p = document.getElementById('yapperModPanel');
        var html = window.__yapperPanelHtml || '';
        if (p && html) {
          var keys = [];
          var re = /data-mod-key="([^"]+)"/g;
          var m;
          while ((m = re.exec(html))) keys.push(m[1]);
          keys.sort();
          var sig = keys.join(',') + '|' + (html.indexOf('yapperCssEditor') === -1 ? '-' : 'e');
          if (p.dataset.yapperSig !== sig) {
            p.innerHTML = html;
            p.dataset.yapperSig = sig;
            wire(p);
            refreshPanel();
            mountEditor();
          }
        }
      }
    };

    // React marks the tab it thinks is current with .active. When our tab is the
    // one on screen, theirs has to give it up or the nav highlights both.
    var soloActive = () => {
      var nav = document.querySelector(NAV);
      if (!nav) return;
      nav.querySelectorAll('button').forEach(b => {
        if (b.id !== ID && b.classList.contains('active')) b.classList.remove('active');
      });
    };

    ensureTab();
    refreshPanel();
    if (!window.__yapperModWatch) {
      window.__yapperModWatch = true;
      // Deliberately does NOT call refreshPanel(): rewriting innerHTML here
      // would re-trigger this observer forever and lock the page up. ensureTab
      // and render both converge to a no-op once the nodes exist.
      new MutationObserver(() => { ensureTab(); render(); })
        .observe(document.documentElement, { childList: true, subtree: true });
    }
    if (window.__yapperModOnOpen) {
      window.__yapperModOnOpen();
      window.__yapperModOnOpen = openTab;
    } else {
      window.__yapperModOnOpen = openTab;
    }
  })()`;
  contents.executeJavaScript(script, true).catch(() => {});
}

function attachTheme(window) {
  var wc = window.webContents;
  wc.on('dom-ready', () => applyTheme(wc));
  wc.on('did-finish-load', () => applyTheme(wc));
}

// Push the current settings into the live window. No restart needed.
function applyAll() {
  if (!win || win.isDestroyed()) return;
  try { win.setBackgroundColor('#141519'); } catch (e) {}
  // Square window corners, always. Applied explicitly rather than left to the
  // platform default so it does not depend on the `rounded` setting.
  if (typeof win.setRoundedCorners === 'function') {
    try { win.setRoundedCorners(false); } catch (e) {}
  }
  applyTheme(win.webContents);
}

// Pick up edits to custom.css without a restart.
try {
  fs.watchFile(customCssFile(), { interval: 1000 }, () => applyAll());
} catch { /* best effort */ }

ipcMain.handle('yapper-mod:css-read', () => {
  try { return fs.readFileSync(customCssFile(), 'utf8'); } catch { return ''; }
});
ipcMain.handle('yapper-mod:css-write', (_e, text) => {
  try {
    fs.mkdirSync(path.dirname(customCssFile()), { recursive: true });
    fs.writeFileSync(customCssFile(), String(text == null ? '' : text));
    applyAll();
    return true;
  } catch { return false; }
});

// Custom icon for one of the app's own native rail folders. Stored per folder
// name in settings.folderIcons and copied into userData/folder-icons so an
// animated GIF keeps animating and survives a restart.
// The app renames a folder whenever a server is added to or removed from it.
// Move the saved image/colour onto the new name so the folder keeps its
// customisation instead of dropping back to the default look.
ipcMain.handle('yapper-mod:folder-key-move', (_e, from, to) => {
  try {
    const a = String(from || '');
    const b = String(to || '');
    if (!a || !b || a === b) return false;
    if (settings.folderIcons && settings.folderIcons[a] && !settings.folderIcons[b]) {
      settings.folderIcons[b] = settings.folderIcons[a];
      delete settings.folderIcons[a];
    }
    if (settings.folderColours && settings.folderColours[a] && !settings.folderColours[b]) {
      settings.folderColours[b] = settings.folderColours[a];
      delete settings.folderColours[a];
    }
    saveSettings();
    return true;
  } catch { return false; }
});

ipcMain.handle('yapper-mod:custom-theme-save', (_e, key) => {
  try {
    var v = String(key || '');
    if (!v) delete settings.customTheme;
    else settings.customTheme = v;
    saveSettings();
    fixWinBg();
    return true;
  } catch { return false; }
});

// Downloading a voice message happens entirely in the main process.
//
// Two things rule out the obvious approaches: the audio lives on a different
// origin (R2), so a renderer-side fetch is blocked by CORS, and a cross-origin
// <a download> is ignored by the browser. Electron's own downloadURL was tried
// too, but without a will-download handler the file was silently dropped into
// the process working directory instead of the Downloads folder. Fetching the
// bytes here and writing them is the only approach that lands reliably.
var getFile = (u, depth = 0) => new Promise((resolve, reject) => {
  if (depth > 4) return reject(new Error('too many redirects'));
  var https = require('node:https');
  var req = https.get(u, { headers: { 'User-Agent': 'Yapper' } }, (res) => {
    var code = res.statusCode || 0;
    if (code >= 300 && code < 400 && res.headers.location) {
      res.resume();
      return resolve(getFile(new URL(res.headers.location, u).toString(), depth + 1));
    }
    if (code !== 200) { res.resume(); return reject(new Error('HTTP ' + code)); }
    var chunks = [];
    res.on('data', (c) => chunks.push(c));
    res.on('end', () => resolve(Buffer.concat(chunks)));
  });
  req.on('error', reject);
  req.setTimeout(45000, () => { req.destroy(new Error('timed out')); });
});

// app.getPath('downloads') resolved to the process working directory in this
// build, which dropped files into the project folder. os.homedir() is the one
// source that cannot be redirected, so Downloads is derived from that and
// created when missing.
var dlDir = () => {
  var os = require('node:os');
  var home = os.homedir();
  var dir = path.join(home, 'Downloads');
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* already there */ }
  return dir;
};

// Voice messages are served as .weba (WebM/Opus). You asked for them to land
// as .mp4, so the extension is forced. Note the bytes are still WebM: this is
// a relabel, not a re-encode, because ffmpeg is not installed here. Players
// that sniff the container (VLC, MPV, browsers) are fine; stricter ones that
// trust the extension may object.
var safeName = (raw, fallback) => {
  var base = String(raw || '').split('/').pop().split('?')[0] || fallback;
  var stem = base.replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 76);
  return (stem || fallback) + '.mp4';
};

ipcMain.handle('yapper-mod:download', async (_e, url) => {
  var u = String(url || '');
  if (!/^https?:\/\//i.test(u)) return { ok: false, error: 'bad url' };
  try {
    var name = safeName(u, 'voice-message');
    // Ask where to put it rather than silently dropping it in Downloads.
    var picked = await dialog.showSaveDialog(win, {
      title: 'Save voice message',
      defaultPath: path.join(dlDir(), name),
      filters: [
        { name: 'Audio', extensions: ['mp4', 'm4a', 'mp3', 'ogg', 'weba'] },
        { name: 'All files', extensions: ['*'] },
      ],
    });
    if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
    var buf = await getFile(u);
    fs.writeFileSync(picked.filePath, buf);
    return { ok: true, path: picked.filePath, bytes: buf.length };
  } catch (e) {
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
});

// Remembers that the Winhawk transparency notice has already been shown, so
// it is only ever displayed once.
ipcMain.handle('yapper-mod:winhawk-warned', () => {
  try {
    settings.winhawkWarned = true;
    saveSettings();
    return true;
  } catch { return false; }
});

ipcMain.handle('yapper-mod:folder-colour-save', (_e, folderName, css, strength) => {
  try {
    if (!settings.folderColours || typeof settings.folderColours !== 'object') settings.folderColours = {};
    if (!settings.folderStrength || typeof settings.folderStrength !== 'object') settings.folderStrength = {};
    var key = String(folderName);
    var v = String(css || '');
    if (!v) {
      delete settings.folderColours[key];
      delete settings.folderStrength[key];
    } else {
      settings.folderColours[key] = v;
      var n = Number(strength);
      settings.folderStrength[key] = Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 100;
    }
    saveSettings();
    return true;
  } catch { return false; }
});

ipcMain.handle('yapper-mod:folder-icon-pick', async (_e, folderName) => {
  var r = await dialog.showOpenDialog(win, {
    title: 'Choose an image for "' + String(folderName || 'folder') + '"',
    filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  try {
    var src = r.filePaths[0];
    var ext = String(src).split('.').pop().toLowerCase() || 'png';
    var safe = String(folderName || 'folder').replace(/[^a-z0-9_-]+/gi, '_');
    var dest = path.join(folderIconsDir(), safe + '.' + ext);
    fs.mkdirSync(folderIconsDir(), { recursive: true });
    fs.copyFileSync(src, dest);
    if (!settings.folderIcons || typeof settings.folderIcons !== 'object') settings.folderIcons = {};
    settings.folderIcons[String(folderName)] = safe + '.' + ext;
    saveSettings();
    applyAll();
    return { name: safe + '.' + ext };
  } catch { return null; }
});
ipcMain.handle('yapper-mod:folder-icon-clear', (_e, folderName) => {
  try {
    if (!settings.folderIcons) return false;
    var file = settings.folderIcons[String(folderName)];
    delete settings.folderIcons[String(folderName)];
    if (file) { try { fs.unlinkSync(path.join(folderIconsDir(), file)); } catch (e) {} }
    saveSettings();
    applyAll();
    return true;
  } catch { return false; }
});

ipcMain.handle('yapper-mod:gif-pick', async () => {
  var r = await dialog.showOpenDialog(win, {
    title: 'Choose an avatar decoration GIF',
    filters: [{ name: 'GIF image', extensions: ['gif'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  try {
    fs.copyFileSync(r.filePaths[0], decoPath());
    settings.decoFile = path.basename(r.filePaths[0]);
    settings.deco = true;
    saveSettings();
    applyAll();
    return { name: settings.decoFile };
  } catch { return null; }
});
ipcMain.handle('yapper-mod:gif-clear', () => {
  settings.decoFile = '';
  settings.deco = false;
  saveSettings();
  applyAll();
  return true;
});

ipcMain.handle('yapper-mod:bg-pick', async () => {
  var r = await dialog.showOpenDialog(win, {
    title: 'Choose a background image or video',
    filters: [{ name: 'All files', extensions: ['*'] }],
    properties: ['openFile'],
  });
  if (r.canceled || !r.filePaths.length) return null;
  try {
    // Remove any stale background.* from a previous pick so the new one is
    // the only file the renderer can resolve.
    try { for (var f of fs.readdirSync(app.getPath('userData'))) if (/^background\./i.test(f)) fs.unlinkSync(path.join(app.getPath('userData'), f)); } catch {}
    var src = r.filePaths[0];
    settings.bgKind = mediaKind(src);      // decided from the file, not the user
    var ext = String(src).split('.').pop().toLowerCase() || (settings.bgKind === 'video' ? 'mp4' : 'png');
    var dest = path.join(app.getPath('userData'), 'background.' + ext);
    fs.copyFileSync(src, dest);
    settings.bgFile = path.basename(dest);
    settings.bgMode = true;
    saveSettings();
    applyAll();
    return { name: settings.bgFile, kind: settings.bgKind };
  } catch { return null; }
});
ipcMain.handle('yapper-mod:bg-clear', () => {
  settings.bgFile = '';
  settings.bgMode = false;
  saveSettings();
  applyAll();
  return true;
});

ipcMain.handle('yapper-mod:get', () => settings);

// Hand a clicked link to the system browser instead of the app's own window.
ipcMain.handle('yapper-mod:open-external', (_e, url) => {
  try {
    var u = new URL(String(url));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    shell.openExternal(u.toString());
    return true;
  } catch { return false; }
});
ipcMain.handle('yapper-mod:set', (_e, patch) => {
  if (patch && typeof patch === 'object') {
    for (var k of Object.keys(DEFAULTS)) if (k in patch) settings[k] = patch[k];
    saveSettings();
    applyAll();
  }
  return settings;
});

// One copy of the app at a time: a second launch (or a yapper:// link) goes to the running one.
if (!app.requestSingleInstanceLock()) { app.quit(); }

var win = null;
var tray = null;
var quitting = false;

function openDeepLink(url) {
  // yapper://invite/abc  ->  https://www.yapper.website/invite/abc
  if (!win || typeof url !== 'string' || !url.startsWith('yapper://')) return;
  var rest = url.slice('yapper://'.length).replace(/^\/+/, '');
  win.loadURL(`${SITE}/${rest}`);
  show();
}

function show() {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// A transparent CSS background is useless unless the window itself stops
// painting its own opaque backdrop. Winhawk asks for a fully clear
// backgroundColor so the desktop / acrylic behind the window shows through.
var winhawkOn = () => settings.customTheme === 'ym-winhawk';
var winBg = () => (winhawkOn()
  ? '#00000000'
  : (settings.black ? '#000000' : '#141519'));

function fixWinBg() {
  try {
    if (typeof win === 'undefined' || !win || win.isDestroyed()) return;
    win.setBackgroundColor(winBg());
    win.invalidate();
  } catch { /* window not ready yet */ }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    // No `transparent: true` here on purpose. It makes the window layered
  // (WS_EX_LAYERED), which takes it out of DWM's composition path, so the
  // acrylic/mica backdrop below would never be drawn. A fully transparent
  // backgroundColor is enough to var the material show through.
  backgroundColor: winBg(),
  roundedCorners: false,
  hasShadow: true,
    icon: ICON,
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  // Real frosted glass (DWM acrylic/mica) was tried here four ways and DWM
  // always reported the backdrop as "unset", so it never drew. Left out rather
  // than kept as code that only looks like it works.
  win.once('ready-to-show', () => { if (!process.argv.includes('--hidden')) win.show(); });
  
  attachTheme(win);
  win.loadURL(SITE);

  // Links to other sites open in the normal browser; Yapper itself stays in the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    try {
      if (ALLOWED.has(new URL(url).hostname)) { win.loadURL(url); return { action: 'deny' }; }
    } catch { /* not a URL */ }
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    try { if (!ALLOWED.has(new URL(url).hostname)) { e.preventDefault(); void shell.openExternal(url); } } catch { e.preventDefault(); }
  });

  // Closing the window keeps Yapper in the tray (calls keep running), like Discord. Quit from the tray.
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on('closed', () => { win = null; });
}

function createTray() {
  var img = nativeImage.createFromPath(ICON).resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('Yapper');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Yapper', click: show },
    { type: 'separator' },
    { label: 'Check for updates', click: () => autoUpdater.checkForUpdatesAndNotify().catch(() => undefined) },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, visible: process.platform === 'win32',
      click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ['--hidden'] }) },
    { type: 'separator' },
    { label: 'Quit Yapper', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', show);
  tray.on('double-click', show);
}

app.setAsDefaultProtocolClient('yapper');
app.on('second-instance', (_e, argv) => { show(); openDeepLink(argv.find((a) => a.startsWith('yapper://'))); });
app.on('open-url', (e, url) => { e.preventDefault(); openDeepLink(url); });

app.whenReady().then(() => {
  // So the site knows it's inside the desktop app (lib/desktop.ts can check navigator.userAgent).
  app.userAgentFallback = `${app.userAgentFallback} YapperDesktop/${app.getVersion()}`;
  if (process.platform === 'win32') app.setAppUserModelId('website.yapper.desktop');
  // Match the forced dark page theme for native chrome: scrollbars, form controls, titlebar.
  nativeTheme.themeSource = 'dark';

  var ses = session.defaultSession;
// ---- No tracking (NoTrack / CrashReports) ----
// Telemetry and crash reports are refused at the session layer, so nothing
// gets out even if a page reaches for a socket instead of fetch.
var TRACK_PATH = /\/api\/v\d+\/(science|track|analytics)(\/|$|\?)/i;
var TRACK_HOST = /^([a-z0-9-]+\.)*(sentry\.io|google-analytics\.com|googletagmanager\.com|doubleclick\.net|segment\.(io|com)|amplitude\.com|mixpanel\.com|hotjar\.com)$/i;
if (settings.noTrack) {
  ses.webRequest.onBeforeRequest((details, cb) => {
    var u = null;
    try { u = new URL(details.url); } catch { /* not a url */ }
    if (u && (TRACK_PATH.test(u.pathname) || TRACK_HOST.test(u.hostname))) return cb({ cancel: true });
    cb({ cancel: false });
  });
}
  // Mic, camera and notifications: yes for Yapper, no for anything else.
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    var host = '';
    try { host = new URL(details.requestingUrl || wc.getURL()).hostname; } catch { /* ignore */ }
    cb(ALLOWED.has(host) && ['media', 'notifications', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => {
    try { return ALLOWED.has(new URL(origin).hostname); } catch { return false; }
  });
  // Screen sharing: hand the browser's getDisplayMedia the whole screen (the picker comes later).
  ses.setDisplayMediaRequestHandler(async (req, cb) => {
    try {
      var sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      var screen = sources.find((s) => s.id.startsWith('screen')) ?? sources[0];
      if (!screen) return cb({});
      cb({ video: screen, audio: 'loopback' });
    } catch { cb({}); }
  }, { useSystemPicker: true });

  createWindow();
  createTray();
  Menu.setApplicationMenu(null);

  ipcMain.on('yapper:badge', (_e, count) => {
    if (process.platform === 'darwin') app.dock?.setBadge(count > 0 ? String(count) : '');
    else if (win) win.setOverlayIcon(null, '');
    if (win && count > 0 && !win.isFocused()) win.flashFrame(true);
  });
  ipcMain.on('yapper:notify', (_e, n) => {
    if (!Notification.isSupported() || (win && win.isFocused())) return;
    var note = new Notification({ title: String(n?.title ?? 'Yapper').slice(0, 80), body: String(n?.body ?? '').slice(0, 180), icon: ICON, silent: true });
    note.on('click', () => { show(); if (n?.url) win?.loadURL(`${SITE}${n.url}`); });
    note.show();
  });

  // Updates: check at start and every 4 hours; installs when you quit.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  var check = () => autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  setTimeout(check, 10_000);
  setInterval(check, 4 * 3600_000);

  openDeepLink(process.argv.find((a) => a.startsWith('yapper://')));
});

app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* stays in the tray */ });
app.on('activate', () => { if (win) show(); else createWindow(); });
