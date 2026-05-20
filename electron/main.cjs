const { app, BrowserWindow, globalShortcut, ipcMain, Menu, shell } = require('electron')
const fs = require('fs/promises')
const path = require('path')
const http = require('http')
const https = require('https')

const APP_ID = 'com.matthmusic.racula'
const DEFAULT_CONFIG = {
  targetUrl: 'http://192.168.1.114:52520',
}
const REQUEST_TIMEOUT_MS = 3000
const HEARTBEAT_INTERVAL_MS = 5000

let mainWindow = null
let appConfig = { ...DEFAULT_CONFIG }
let connectionStatus = {
  state: 'checking',
  url: DEFAULT_CONFIG.targetUrl,
  checkedAt: null,
  reason: 'startup',
  message: '',
}
let heartbeatTimer = null
let latestCheckToken = 0

function isDev() {
  return process.env.NODE_ENV === 'development'
}

function resolveAppPath(...segments) {
  return path.join(app.getAppPath(), ...segments)
}

function getConfigPath() {
  return path.join(app.getPath('userData'), 'config.json')
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function sendToRenderer(channel, payload) {
  if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents) {
    return
  }
  mainWindow.webContents.send(channel, payload)
}

function validateHttpUrl(value) {
  const parsed = new URL(String(value || '').trim())
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('L URL doit commencer par http:// ou https://')
  }
  return parsed.toString()
}

function sanitizeConfig(rawConfig) {
  try {
    return {
      targetUrl: validateHttpUrl(rawConfig?.targetUrl || DEFAULT_CONFIG.targetUrl),
    }
  } catch {
    return { ...DEFAULT_CONFIG }
  }
}

async function loadConfigFromDisk() {
  try {
    const fileContent = await fs.readFile(getConfigPath(), 'utf8')
    appConfig = sanitizeConfig(JSON.parse(fileContent))
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('[Racula] Failed to load config, using defaults.', error)
    }
    appConfig = { ...DEFAULT_CONFIG }
  }
}

async function saveConfigToDisk(config) {
  const configPath = getConfigPath()
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

function buildAppState() {
  return {
    config: clone(appConfig),
    connectionStatus: clone(connectionStatus),
    isMaximized: !!(mainWindow && !mainWindow.isDestroyed() && mainWindow.isMaximized()),
  }
}

function sameStatus(left, right) {
  return (
    left.state === right.state &&
    left.url === right.url &&
    left.message === right.message &&
    left.reason === right.reason
  )
}

function updateConnectionStatus(nextStatus, { force = false } = {}) {
  const mergedStatus = {
    ...connectionStatus,
    ...nextStatus,
  }
  const shouldBroadcast = force || !sameStatus(connectionStatus, mergedStatus)
  connectionStatus = mergedStatus
  if (shouldBroadcast) {
    sendToRenderer('connection-status', connectionStatus)
  }
  return connectionStatus
}

function probeUrl(targetUrl, timeoutMs = REQUEST_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(targetUrl)
    const client = parsedUrl.protocol === 'https:' ? https : http
    const request = client.request(
      parsedUrl,
      {
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Racula/0.1.0',
          Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        },
      },
      (response) => {
        const result = {
          statusCode: response.statusCode || 0,
          statusMessage: response.statusMessage || '',
        }
        response.destroy()
        resolve(result)
      },
    )

    request.on('timeout', () => {
      request.destroy(new Error(`Timeout apres ${timeoutMs} ms`))
    })

    request.on('error', (error) => {
      reject(error)
    })

    request.end()
  })
}

async function performConnectionCheck({ reason = 'manual', announceChecking = false } = {}) {
  const url = appConfig.targetUrl
  const checkToken = ++latestCheckToken

  if (announceChecking) {
    updateConnectionStatus(
      {
        state: 'checking',
        url,
        checkedAt: new Date().toISOString(),
        reason,
        message: '',
      },
      { force: true },
    )
  }

  try {
    const response = await probeUrl(url)
    if (checkToken !== latestCheckToken) {
      return clone(connectionStatus)
    }

    return updateConnectionStatus(
      {
        state: 'connected',
        url,
        checkedAt: new Date().toISOString(),
        reason,
        message: response.statusCode ? `HTTP ${response.statusCode}` : '',
      },
      { force: announceChecking || reason !== 'heartbeat' },
    )
  } catch (error) {
    if (checkToken !== latestCheckToken) {
      return clone(connectionStatus)
    }

    return updateConnectionStatus(
      {
        state: 'disconnected',
        url,
        checkedAt: new Date().toISOString(),
        reason,
        message: error?.message || 'Connexion impossible',
      },
      { force: announceChecking || reason !== 'heartbeat' },
    )
  }
}

function clearHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function scheduleHeartbeat() {
  clearHeartbeat()
  heartbeatTimer = setInterval(() => {
    void performConnectionCheck({ reason: 'heartbeat', announceChecking: false })
  }, HEARTBEAT_INTERVAL_MS)
}

function registerWebviewGuards() {
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview') {
      return
    }

    contents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: '#09111f',
    icon: resolveAppPath('build', 'racula.ico'),
    title: 'Racula',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      sandbox: false,
    },
  })

  mainWindow.webContents.on('will-attach-webview', (_event, webPreferences, params) => {
    delete webPreferences.preload
    delete webPreferences.preloadURL
    webPreferences.nodeIntegration = false
    webPreferences.contextIsolation = true
    webPreferences.webSecurity = true
    params.allowpopups = false
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.on('maximize', () => {
    sendToRenderer('window-state', { isMaximized: true })
  })

  mainWindow.on('unmaximize', () => {
    sendToRenderer('window-state', { isMaximized: false })
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'))

  mainWindow.once('ready-to-show', () => {
    sendToRenderer('window-state', { isMaximized: mainWindow.isMaximized() })
    void performConnectionCheck({ reason: 'startup', announceChecking: true })
  })
}

ipcMain.handle('app:get-state', () => buildAppState())

ipcMain.handle('config:save', async (_event, nextConfig) => {
  const targetUrl = validateHttpUrl(nextConfig?.targetUrl)
  appConfig = { targetUrl }
  latestCheckToken += 1
  await saveConfigToDisk(appConfig)
  sendToRenderer('config-updated', clone(appConfig))
  await performConnectionCheck({ reason: 'settings', announceChecking: true })
  return clone(appConfig)
})

ipcMain.handle('connection:check', async (_event, reason = 'manual') => {
  return performConnectionCheck({ reason, announceChecking: true })
})

ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize()
  }
})

ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return false
  }

  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow.maximize()
  }

  const isMaximized = mainWindow.isMaximized()
  sendToRenderer('window-state', { isMaximized })
  return isMaximized
})

ipcMain.handle('window:close', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close()
  }
})

app.whenReady().then(async () => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(APP_ID)
  }

  await loadConfigFromDisk()
  Menu.setApplicationMenu(null)
  registerWebviewGuards()
  createWindow()
  scheduleHeartbeat()

  if (isDev()) {
    globalShortcut.register('Control+Shift+I', () => {
      const focusedWindow = BrowserWindow.getFocusedWindow()
      if (focusedWindow) {
        focusedWindow.webContents.toggleDevTools({ mode: 'detach' })
      }
    })

    globalShortcut.register('F12', () => {
      const focusedWindow = BrowserWindow.getFocusedWindow()
      if (focusedWindow) {
        focusedWindow.webContents.toggleDevTools({ mode: 'detach' })
      }
    })
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  clearHeartbeat()
  globalShortcut.unregisterAll()
})
