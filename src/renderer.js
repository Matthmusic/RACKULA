const api = window.racula
const EMBEDDED_LAYOUT_FIX_CSS = `
html,
body {
  width: 100% !important;
  min-width: 100% !important;
  min-height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
}

body {
  max-width: none !important;
}

body > #root,
body > #app,
body > #__next,
body > main:first-child,
body > div:first-child {
  width: 100% !important;
  max-width: none !important;
  min-height: 100vh !important;
  margin: 0 !important;
  padding: 0 !important;
}
`

const state = {
  config: {
    targetUrl: '',
  },
  connectionStatus: {
    state: 'checking',
    url: '',
    checkedAt: null,
    reason: 'startup',
    message: '',
  },
  hasLoadedSuccessfully: false,
  loadedUrl: '',
  pendingLoad: false,
  isMaximized: false,
}

const elements = {
  updateBanner: document.getElementById('update-banner'),
  updateBannerText: document.getElementById('update-banner-text'),
  updateActionButton: document.getElementById('update-action-button'),
  targetUrl: document.getElementById('target-url'),
  statusPill: document.getElementById('status-pill'),
  statusText: document.getElementById('status-text'),
  topBanner: document.getElementById('top-banner'),
  webviewFrame: document.getElementById('webview-frame'),
  webview: document.getElementById('target-webview'),
  fallbackPanel: document.getElementById('fallback-panel'),
  fallbackEyebrow: document.getElementById('fallback-eyebrow'),
  fallbackTitle: document.getElementById('fallback-title'),
  fallbackCopy: document.getElementById('fallback-copy'),
  reloadButton: document.getElementById('reload-button'),
  settingsButton: document.getElementById('settings-button'),
  retryButton: document.getElementById('retry-button'),
  fallbackSettingsButton: document.getElementById('fallback-settings-button'),
  minimizeButton: document.getElementById('minimize-button'),
  maximizeButton: document.getElementById('maximize-button'),
  closeButton: document.getElementById('close-button'),
  settingsOverlay: document.getElementById('settings-overlay'),
  settingsForm: document.getElementById('settings-form'),
  settingsCloseButton: document.getElementById('settings-close-button'),
  settingsCancelButton: document.getElementById('settings-cancel-button'),
  settingsSaveButton: document.getElementById('settings-save-button'),
  settingsError: document.getElementById('settings-error'),
  targetUrlInput: document.getElementById('target-url-input'),
}

function normalizeUrl(value) {
  const parsed = new URL(String(value || '').trim())
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('L URL doit commencer par http:// ou https://')
  }
  return parsed.toString()
}

function truncateUrl(value, maxLength = 68) {
  if (!value) return ''
  if (value.length <= maxLength) return value
  return `${value.slice(0, Math.max(28, Math.floor(maxLength / 2) - 3))} ... ${value.slice(-24)}`
}

function setStatusPill(status) {
  elements.statusPill.classList.remove('status-checking', 'status-connected', 'status-disconnected')

  if (status.state === 'connected') {
    elements.statusPill.classList.add('status-connected')
    elements.statusText.textContent = 'Connecte'
    return
  }

  if (status.state === 'disconnected') {
    elements.statusPill.classList.add('status-disconnected')
    elements.statusText.textContent = 'Hors ligne'
    return
  }

  elements.statusPill.classList.add('status-checking')
  elements.statusText.textContent = 'Verification'
}

function setBanner(message) {
  if (!message) {
    elements.topBanner.classList.add('hidden')
    elements.topBanner.textContent = ''
    return
  }

  elements.topBanner.textContent = message
  elements.topBanner.classList.remove('hidden')
}

function updateWindowButton() {
  elements.maximizeButton.textContent = state.isMaximized ? 'o' : '[]'
  elements.maximizeButton.setAttribute('aria-label', state.isMaximized ? 'Restaurer' : 'Maximiser')
}

function updateTitlebar() {
  elements.targetUrl.textContent = truncateUrl(state.config.targetUrl || 'Aucune adresse configuree')
  elements.targetUrl.title = state.config.targetUrl || ''
  setStatusPill(state.connectionStatus)
  updateWindowButton()
}

function updateFallback() {
  if (state.connectionStatus.state === 'connected' && !state.hasLoadedSuccessfully) {
    elements.fallbackEyebrow.textContent = 'Page distante'
    elements.fallbackTitle.textContent = 'Chargement de la page...'
    elements.fallbackCopy.textContent =
      'La connexion est disponible. Racula attend le chargement complet avant d afficher le contenu.'
    return
  }

  if (state.connectionStatus.state === 'disconnected') {
    elements.fallbackEyebrow.textContent = 'Connexion impossible'
    elements.fallbackTitle.textContent = 'La page cible ne repond pas.'
    elements.fallbackCopy.textContent = state.connectionStatus.message
      ? `${state.connectionStatus.message}. Verifie l adresse ou le service distant, puis relance un test.`
      : 'Le service distant ne repond pas pour le moment. Verifie le reseau ou l URL configuree.'
    return
  }

  elements.fallbackEyebrow.textContent = 'Connexion distante'
  elements.fallbackTitle.textContent = 'Verification de la connexion...'
  elements.fallbackCopy.textContent =
    'Racula verifie si l adresse cible repond avant d afficher la page.'
}

function syncMainView() {
  const shouldShowWebview = state.hasLoadedSuccessfully
  elements.webviewFrame.classList.toggle('hidden', !shouldShowWebview)
  elements.fallbackPanel.classList.toggle('hidden', shouldShowWebview)
  updateFallback()
}

function resetLoadedView() {
  state.hasLoadedSuccessfully = false
  state.loadedUrl = ''
  state.pendingLoad = false
  elements.webview.src = 'about:blank'
  syncMainView()
}

function openSettings() {
  elements.settingsOverlay.classList.remove('hidden')
  elements.settingsOverlay.setAttribute('aria-hidden', 'false')
  elements.targetUrlInput.value = state.config.targetUrl || ''
  elements.settingsError.classList.add('hidden')
  elements.settingsError.textContent = ''
  window.requestAnimationFrame(() => {
    elements.targetUrlInput.focus()
    elements.targetUrlInput.select()
  })
}

function closeSettings() {
  elements.settingsOverlay.classList.add('hidden')
  elements.settingsOverlay.setAttribute('aria-hidden', 'true')
}

function handleConnectionStatus(status) {
  if (status?.url && state.config.targetUrl && status.url !== state.config.targetUrl) {
    return
  }

  state.connectionStatus = status
  updateTitlebar()
  updateFallback()

  if (status.state === 'connected') {
    setBanner('')
    if (!state.hasLoadedSuccessfully || state.loadedUrl !== state.config.targetUrl || state.pendingLoad) {
      state.pendingLoad = false
      loadTargetIntoWebview()
    }
  } else if (status.state === 'disconnected') {
    state.pendingLoad = false
    if (state.hasLoadedSuccessfully && state.loadedUrl === state.config.targetUrl) {
      setBanner('Connexion perdue. La derniere page chargee reste affichee.')
    } else {
      setBanner('')
    }
  } else if (!state.hasLoadedSuccessfully) {
    setBanner('')
  }

  syncMainView()
}

function loadTargetIntoWebview({ forceReload = false } = {}) {
  const targetUrl = state.config.targetUrl
  if (!targetUrl) {
    return
  }

  state.pendingLoad = true

  if (forceReload && state.hasLoadedSuccessfully && state.loadedUrl === targetUrl) {
    if (typeof elements.webview.reloadIgnoringCache === 'function') {
      elements.webview.reloadIgnoringCache()
    } else {
      elements.webview.reload()
    }
    return
  }

  if (elements.webview.src !== targetUrl) {
    elements.webview.src = targetUrl
  }
}

async function refreshConnection(reason = 'manual', { reloadOnSuccess = true } = {}) {
  try {
    const status = await api.checkConnection(reason)
    handleConnectionStatus(status)

    if (
      reloadOnSuccess &&
      status.state === 'connected' &&
      state.hasLoadedSuccessfully &&
      state.loadedUrl === state.config.targetUrl
    ) {
      loadTargetIntoWebview({ forceReload: true })
    }
  } catch (error) {
    handleConnectionStatus({
      state: 'disconnected',
      url: state.config.targetUrl,
      checkedAt: new Date().toISOString(),
      reason,
      message: error?.message || 'Connexion impossible',
    })
  }
}

async function handleSaveSettings(event) {
  event.preventDefault()
  elements.settingsError.classList.add('hidden')
  elements.settingsError.textContent = ''

  try {
    const normalizedUrl = normalizeUrl(elements.targetUrlInput.value)
    const previousUrl = state.config.targetUrl
    const urlChanged = normalizedUrl !== previousUrl

    if (urlChanged) {
      state.config = { targetUrl: normalizedUrl }
      state.connectionStatus = {
        state: 'checking',
        url: normalizedUrl,
        checkedAt: null,
        reason: 'settings',
        message: '',
      }
      setBanner('')
      updateTitlebar()
      resetLoadedView()
    }

    elements.settingsSaveButton.disabled = true
    const savedConfig = await api.saveConfig({ targetUrl: normalizedUrl })
    state.config = savedConfig
    updateTitlebar()
    closeSettings()
  } catch (error) {
    elements.settingsError.textContent = error?.message || 'Impossible d enregistrer la configuration.'
    elements.settingsError.classList.remove('hidden')
  } finally {
    elements.settingsSaveButton.disabled = false
  }
}

function wireEvents() {
  elements.reloadButton.addEventListener('click', () => {
    state.pendingLoad = !state.hasLoadedSuccessfully
    void refreshConnection('manual', { reloadOnSuccess: true })
  })

  elements.retryButton.addEventListener('click', () => {
    state.pendingLoad = true
    void refreshConnection('retry', { reloadOnSuccess: false })
  })

  elements.settingsButton.addEventListener('click', openSettings)
  elements.fallbackSettingsButton.addEventListener('click', openSettings)
  elements.settingsCloseButton.addEventListener('click', closeSettings)
  elements.settingsCancelButton.addEventListener('click', closeSettings)
  elements.minimizeButton.addEventListener('click', () => api.windowMinimize())
  elements.maximizeButton.addEventListener('click', async () => {
    state.isMaximized = await api.windowToggleMaximize()
    updateWindowButton()
  })
  elements.closeButton.addEventListener('click', () => api.windowClose())
  elements.settingsForm.addEventListener('submit', handleSaveSettings)

  elements.settingsOverlay.addEventListener('click', (event) => {
    if (event.target === elements.settingsOverlay) {
      closeSettings()
    }
  })

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.settingsOverlay.classList.contains('hidden')) {
      closeSettings()
    }
  })

  elements.webview.addEventListener('did-start-loading', () => {
    if (!state.hasLoadedSuccessfully) {
      state.connectionStatus = {
        ...state.connectionStatus,
        state: 'checking',
      }
      updateTitlebar()
      updateFallback()
    }
  })

  elements.webview.addEventListener('dom-ready', () => {
    const currentUrl = typeof elements.webview.getURL === 'function' ? elements.webview.getURL() : ''
    if (!currentUrl || currentUrl === 'about:blank') {
      return
    }

    if (typeof elements.webview.insertCSS === 'function') {
      elements.webview.insertCSS(EMBEDDED_LAYOUT_FIX_CSS).catch(() => {})
    }
  })

  elements.webview.addEventListener('did-finish-load', () => {
    const currentUrl = typeof elements.webview.getURL === 'function' ? elements.webview.getURL() : ''
    if (!currentUrl || currentUrl === 'about:blank') {
      return
    }

    state.hasLoadedSuccessfully = true
    state.pendingLoad = false
    state.loadedUrl = currentUrl
    setBanner(state.connectionStatus.state === 'disconnected' ? 'Connexion perdue. La derniere page chargee reste affichee.' : '')
    syncMainView()
  })

  elements.webview.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3) {
      return
    }

    state.hasLoadedSuccessfully = false
    state.loadedUrl = ''
    state.pendingLoad = false
    handleConnectionStatus({
      state: 'disconnected',
      url: state.config.targetUrl,
      checkedAt: new Date().toISOString(),
      reason: 'webview-load',
      message: event.errorDescription || 'Chargement impossible',
    })
  })
}

const updateState = { phase: 'idle', version: '' }

function renderUpdateBanner() {
  const { phase, version } = updateState
  if (phase === 'idle' || phase === 'error') {
    elements.updateBanner.classList.add('hidden')
    return
  }
  elements.updateBanner.classList.remove('hidden')
  if (phase === 'available') {
    elements.updateBannerText.textContent = `Mise à jour v${version} disponible`
    elements.updateActionButton.textContent = 'Télécharger'
    elements.updateActionButton.style.display = ''
    elements.updateActionButton.onclick = () => {
      updateState.phase = 'downloading'
      renderUpdateBanner()
      api.downloadUpdate()
    }
  } else if (phase === 'downloading') {
    elements.updateBannerText.textContent = `Téléchargement en cours…`
    elements.updateActionButton.style.display = 'none'
  } else if (phase === 'downloaded') {
    elements.updateBannerText.textContent = `v${version} prête — redémarrage requis`
    elements.updateActionButton.textContent = 'Installer et relancer'
    elements.updateActionButton.style.display = ''
    elements.updateActionButton.onclick = () => api.installUpdate()
  }
}

function handleUpdateEvent(data) {
  switch (data?.type) {
    case 'available':
      updateState.phase = 'available'
      updateState.version = data.info?.version || ''
      break
    case 'progress':
      updateState.phase = 'downloading'
      break
    case 'downloaded':
      updateState.phase = 'downloaded'
      updateState.version = data.info?.version || ''
      break
    case 'error':
    case 'not-available':
      updateState.phase = data.type === 'error' ? 'error' : 'idle'
      break
  }
  renderUpdateBanner()
}

async function init() {
  if (!api) {
    document.body.innerHTML = '<div style="padding:24px;color:#fff;background:#111">Racula doit etre lance via Electron.</div>'
    return
  }

  api.onUpdateEvent(handleUpdateEvent)
  api.checkUpdate()

  api.onConnectionStatus((status) => {
    handleConnectionStatus(status)
  })

  api.onConfigUpdated((config) => {
    state.config = config
    updateTitlebar()
  })

  api.onWindowState((windowState) => {
    state.isMaximized = !!windowState?.isMaximized
    updateWindowButton()
  })

  wireEvents()

  const appState = await api.getAppState()
  state.config = appState.config
  state.connectionStatus = appState.connectionStatus
  state.isMaximized = !!appState.isMaximized

  updateTitlebar()
  syncMainView()

  if (state.connectionStatus.state === 'connected') {
    loadTargetIntoWebview()
  } else if (state.connectionStatus.state === 'checking' || !state.connectionStatus.checkedAt) {
    state.pendingLoad = true
    void refreshConnection('startup', { reloadOnSuccess: false })
  }
}

void init()
