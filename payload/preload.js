// preload.js
// this is the bridge. the website (the yapper page) gets window.yapperDesktop
// and thats it. node stuff does not come in here.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yapperDesktop', {

  version: process.env.npm_package_version || '',
  platform: process.platform,

  // number on the taskbar icon
  setBadge: function (n) {
    ipcRenderer.send('yapper:badge', Number(n) || 0);
  },

  // everything for the Yapcord tab
  mod: {

    get: function () {
      return ipcRenderer.invoke('yapper-mod:get');
    },

    openExternal: function (url) {
    return ipcRenderer.invoke('yapper-mod:open-external', url);
  },
  set: function (stuff) {
      return ipcRenderer.invoke('yapper-mod:set', stuff);
    },

    // background pic or vid
    bg: {
      pick: function () {
        return ipcRenderer.invoke('yapper-mod:bg-pick');
      },
      clear: function () {
        return ipcRenderer.invoke('yapper-mod:bg-clear');
      }
    },

    // the gif thing
    gif: {
      pick: function () {
        return ipcRenderer.invoke('yapper-mod:gif-pick');
      },
      clear: function () {
        return ipcRenderer.invoke('yapper-mod:gif-clear');
      }
    },

    // folder pic + folder colour. name is the folder name
    folderIcon: {
      pick: function (name) {
        return ipcRenderer.invoke('yapper-mod:folder-icon-pick', name);
      },
      clear: function (name) {
        return ipcRenderer.invoke('yapper-mod:folder-icon-clear', name);
      },
      // folder got renamed, move the saved pic + colour to the new name
      moveKey: function (from, to) {
        return ipcRenderer.invoke('yapper-mod:folder-key-move', from, to);
      },
      saveColour: function (name, css, howStrong) {
        return ipcRenderer.invoke('yapper-mod:folder-colour-save', name, css, howStrong);
      }
    },

    // getting a voice message off the server and onto the disk
    download: {
      file: function (url) {
        return ipcRenderer.invoke('yapper-mod:download', url);
      },
      check: function (url) {
        return ipcRenderer.invoke('yapper-mod:download-check', url);
      }
    },

    // themes. goes in the settings.json not localStorage because the app
    // deletes any localStorage key that isnt its own on boot
    customTheme: {
      save: function (key) {
        return ipcRenderer.invoke('yapper-mod:custom-theme-save', key);
      },
      warned: function () {
        return ipcRenderer.invoke('yapper-mod:winhawk-warned');
      }
    },

    // the css file you can type into
    css: {
      read: function () {
        return ipcRenderer.invoke('yapper-mod:css-read');
      },
      write: function (txt) {
        return ipcRenderer.invoke('yapper-mod:css-write', txt);
      }
    }
  },

  // popup notification
  notify: function (n) {
    ipcRenderer.send('yapper:notify', {
      title: n && n.title,
      body: n && n.body,
      url: n && n.url
    });
  }
});