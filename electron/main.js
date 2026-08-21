// NE LAZIMSA — Electron masaüstü kabuğu
// index.html olduğu gibi yüklenir; uygulama mantığı değişmez.
const { app, BrowserWindow, shell, Menu, session } = require('electron');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const STATE_FILE = path.join(app.getPath('userData'), 'window-state.json');

// Pencere boyut/konumunu hatırla
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveState(win) {
  try {
    if (win.isMinimized()) return;
    const b = win.getBounds();
    fs.writeFileSync(STATE_FILE, JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch (e) { /* kaydedilemezse sorun değil */ }
}

let mainWindow = null;

function createWindow() {
  const s = loadState();

  mainWindow = new BrowserWindow({
    width: s.width || 1440,
    height: s.height || 900,
    x: s.x,
    y: s.y,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#0b1220',           // ilk boyamada beyaz parlama olmasın
    autoHideMenuBar: true,
    title: 'NE LAZIMSA',
    webPreferences: {
      // Sayfanın Node'a ihtiyacı yok; kapalı tutmak güvenli
      nodeIntegration: false,
      contextIsolation: true,
      spellcheck: false
    }
  });

  if (s.maximized) mainWindow.maximize();
  mainWindow.once('ready-to-show', () => mainWindow.show());

  mainWindow.loadFile(path.join(ROOT, 'index.html'));

  ['resize', 'move', 'close'].forEach(ev =>
    mainWindow.on(ev, () => saveState(mainWindow))
  );
  mainWindow.on('closed', () => { mainWindow = null; });

  // Dış bağlantılar (wa.me, Supabase paneli, tedarikçi siteleri) varsayılan
  // tarayıcıda açılsın — uygulama içinde yeni pencere açılmasın.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  // Uygulama içi gezinmeyi yalnızca kendi dosyamıza izin ver
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
}

app.whenReady().then(() => {
  // Barkod okuma için kamera izni
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(permission === 'media' || permission === 'notifications');
  });

  // Sade menü: yalnızca gerekli kısayollar
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Uygulama',
      submenu: [
        { role: 'reload', label: 'Yenile' },
        { role: 'forceReload', label: 'Önbelleği Temizleyip Yenile' },
        { type: 'separator' },
        { role: 'toggleDevTools', label: 'Geliştirici Araçları' },
        { type: 'separator' },
        { role: 'quit', label: 'Çıkış' }
      ]
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'resetZoom', label: 'Yakınlaştırmayı Sıfırla' },
        { role: 'zoomIn', label: 'Yakınlaştır' },
        { role: 'zoomOut', label: 'Uzaklaştır' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Tam Ekran' }
      ]
    },
    {
      label: 'Düzen',
      submenu: [
        { role: 'undo', label: 'Geri Al' },
        { role: 'redo', label: 'Yinele' },
        { type: 'separator' },
        { role: 'cut', label: 'Kes' },
        { role: 'copy', label: 'Kopyala' },
        { role: 'paste', label: 'Yapıştır' },
        { role: 'selectAll', label: 'Tümünü Seç' }
      ]
    }
  ]));

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Tek örnek: ikinci kez açılırsa mevcut pencereyi öne getir
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
