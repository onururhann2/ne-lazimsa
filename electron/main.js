// Stakip — Electron masaüstü kabuğu
// index.html olduğu gibi yüklenir; uygulama mantığı değişmez.
const { app, BrowserWindow, shell, Menu, session, dialog } = require('electron');
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

// ── OTOMATİK GÜNCELLEME ──
// Sürümler GitHub Releases üzerinden dağıtılır. Depo herkese açık olduğu
// için indirme sırasında token gerekmez; token yalnızca YAYINLAMA sırasında
// (npm run release) gerekir.
const { autoUpdater } = require('electron-updater');

let updateUiState = 'idle';   // idle | checking | downloading | ready
let manualCheck = false;      // kullanıcı menüden mi tetikledi

function initUpdater() {
  // Geliştirme modunda app-update.yml bulunmaz; denemek hataya yol açar
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => { updateUiState = 'checking'; });

  autoUpdater.on('update-available', (info) => {
    updateUiState = 'downloading';
    if (mainWindow) {
      mainWindow.setTitle('Stakip — yeni sürüm indiriliyor (' + info.version + ')');
    }
  });

  autoUpdater.on('update-not-available', () => {
    updateUiState = 'idle';
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Güncelleme',
        message: 'En güncel sürümü kullanıyorsunuz.',
        detail: 'Yüklü sürüm: ' + app.getVersion(),
        buttons: ['Tamam']
      });
    }
  });

  autoUpdater.on('download-progress', (p) => {
    if (mainWindow) {
      mainWindow.setTitle('Stakip — güncelleme indiriliyor %' + Math.round(p.percent));
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    updateUiState = 'ready';
    if (mainWindow) mainWindow.setTitle('Stakip');
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Güncelleme Hazır',
      message: 'Yeni sürüm indirildi: ' + info.version,
      detail: 'Uygulama yeniden başlatıldığında güncelleme uygulanacak. Şimdi yeniden başlatmak ister misiniz?',
      buttons: ['Şimdi Yeniden Başlat', 'Daha Sonra'],
      defaultId: 0,
      cancelId: 1
    }).then(({ response }) => {
      // Satış sırasında zorla kapatma yok; kullanıcı "Daha Sonra" derse
      // güncelleme uygulamayı kapattığında kendiliğinden uygulanır.
      if (response === 0) {
        setImmediate(() => autoUpdater.quitAndInstall());
      }
    });
  });

  autoUpdater.on('error', (err) => {
    updateUiState = 'idle';
    if (mainWindow) mainWindow.setTitle('Stakip');
    console.error('Güncelleme hatası:', err);
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: 'Güncelleme Denetlenemedi',
        message: 'Sunucuya ulaşılamadı.',
        detail: String((err && err.message) || err),
        buttons: ['Tamam']
      });
    }
  });

  // Açılışta bir kez, sonra saatte bir sessizce denetle
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 8000);
  setInterval(() => {
    if (updateUiState === 'idle') autoUpdater.checkForUpdates().catch(() => {});
  }, 60 * 60 * 1000);
}

function checkForUpdatesManually() {
  if (!app.isPackaged) {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Güncelleme',
      message: 'Geliştirme modunda güncelleme denetlenmez.',
      detail: 'Bu özellik yalnızca kurulmuş uygulamada çalışır.',
      buttons: ['Tamam']
    });
    return;
  }
  if (updateUiState === 'ready') {
    autoUpdater.quitAndInstall();
    return;
  }
  if (updateUiState !== 'idle') return;   // zaten indiriyor
  manualCheck = true;
  autoUpdater.checkForUpdates().catch(() => {});
}


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
    title: 'Stakip',
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
        { label: 'Güncellemeleri Denetle', click: () => checkForUpdatesManually() },
        { type: 'separator' },
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
  initUpdater();

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
