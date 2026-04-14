const htmlRoot = document.documentElement;
const themeToggle = document.getElementById("theme-toggle");
const mobileMenuBtn = document.getElementById("mobile-menu");
const navLinks = document.getElementById("nav-links");
const navItems = document.querySelectorAll(".nav-item");
const authOpenBtn = document.getElementById("auth-open-btn");
const authOverlay = document.getElementById("auth-overlay");
const authCloseBtn = document.getElementById("auth-close-btn");
const authTitle = document.getElementById("auth-title");
const authSubtitle = document.getElementById("auth-subtitle");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authSubmitBtn = document.getElementById("auth-submit-btn");
const authSwitchLabel = document.getElementById("auth-switch-label");
const authSwitchBtn = document.getElementById("auth-switch-btn");
const authNote = document.getElementById("auth-note");

const startBtn = document.getElementById("start-btn");
const stopBtn = document.getElementById("stop-btn");
const uploadBtn = document.getElementById("upload-btn");
const fileInput = document.getElementById("file-input");

const copyBtn = document.getElementById("copy-btn");
const openBtn = document.getElementById("open-btn");
const clearBtn = document.getElementById("clear-btn");
const resultText = document.getElementById("result-text");
const statusEl = document.getElementById("status");
const toast = document.getElementById("toast");
const readerWrap = document.getElementById("reader-wrap");
const accountCurrent = document.getElementById("account-current");
const accountTotal = document.getElementById("account-total");

const THEME_KEY = "scanpro-theme";
const USERS_KEY = "scanpro-users-v1";
const SESSION_KEY = "scanpro-session-v1";
const BACKEND_BASE_URL = resolveBackendBaseUrl();

let scanner = null;
let scannerRunning = false;
let lastResult = "";
let authMode = "register";
let currentScanMode = "qr";

initializeTheme();
initializeAuthState();
renderAuthMode();
bindEvents();
applyInitialSectionFromHash();

function bindEvents() {
  themeToggle.addEventListener("click", toggleTheme);

  mobileMenuBtn.addEventListener("click", () => {
    navLinks.classList.toggle("open");
  });

  document.querySelectorAll(".nav-links a").forEach((link) => {
    link.addEventListener("click", () => navLinks.classList.remove("open"));
  });
  navItems.forEach((item) => {
    item.addEventListener("click", () => {
      const section = item.dataset.section;
      if (!section) return;
      setActiveSection(section);
      navLinks.classList.remove("open");
    });
  });

  authOpenBtn.addEventListener("click", onAuthButtonClick);
  authCloseBtn.addEventListener("click", closeAuthOverlay);
  authSwitchBtn.addEventListener("click", switchAuthMode);
  authSubmitBtn.addEventListener("click", submitAuth);

  authOverlay.addEventListener("click", (event) => {
    if (event.target === authOverlay) closeAuthOverlay();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAuthOverlay();
  });

  startBtn.addEventListener("click", startScan);
  stopBtn.addEventListener("click", stopScan);
  uploadBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", scanFromImage);

  copyBtn.addEventListener("click", copyResult);
  openBtn.addEventListener("click", openResult);
  clearBtn.addEventListener("click", clearResult);

  window.addEventListener("hashchange", applyInitialSectionFromHash);
}

function applyInitialSectionFromHash() {
  const sectionId = window.location.hash.replace("#", "").trim();
  if (!sectionId) return;

  const validSection = Array.from(navItems).some((item) => item.dataset.section === sectionId);
  if (!validSection) return;
  setActiveSection(sectionId);
}

function initializeTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const activeTheme = saved || (systemDark ? "dark" : "light");
  htmlRoot.setAttribute("data-theme", activeTheme);
  updateThemeIcon(activeTheme);
}

function initializeAuthState() {
  const sessionEmail = localStorage.getItem(SESSION_KEY);
  if (sessionEmail) {
    setLoggedInUI(sessionEmail);
  } else {
    setLoggedOutUI();
  }
  refreshAccountDetails();
}

function toggleTheme() {
  const current = htmlRoot.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  htmlRoot.setAttribute("data-theme", next);
  localStorage.setItem(THEME_KEY, next);
  updateThemeIcon(next);
}

function updateThemeIcon(theme) {
  themeToggle.innerHTML =
    theme === "dark"
      ? '<i class="fa-solid fa-sun"></i>'
      : '<i class="fa-solid fa-moon"></i>';
}

function onAuthButtonClick() {
  const isLoggedIn = authOpenBtn.dataset.authState === "logged-in";
  if (isLoggedIn) {
    logoutAccount();
    return;
  }
  openAuthOverlay();
}

function openAuthOverlay() {
  authOverlay.classList.add("open");
  authOverlay.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  authEmail.focus();
}

function closeAuthOverlay() {
  authOverlay.classList.remove("open");
  authOverlay.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

function switchAuthMode() {
  authMode = authMode === "register" ? "login" : "register";
  renderAuthMode();
}

function renderAuthMode() {
  const isRegister = authMode === "register";
  authTitle.textContent = isRegister ? "Create Account" : "Welcome Back";
  authSubtitle.textContent = isRegister
    ? "Register to continue scanning."
    : "Login to your existing account.";
  authSubmitBtn.innerHTML = isRegister
    ? '<i class="fa-solid fa-user-plus"></i> Register'
    : '<i class="fa-solid fa-right-to-bracket"></i> Login';
  authSwitchLabel.textContent = isRegister
    ? "Already have an account?"
    : "Need a new account?";
  authSwitchBtn.textContent = isRegister ? "Login" : "Register";
}

async function submitAuth() {
  const email = authEmail.value.trim().toLowerCase();
  const password = authPassword.value.trim();
  if (!email || !password) {
    showToast("Please fill all fields.");
    return;
  }

  if (!isValidEmail(email)) {
    showToast("Please enter a valid email.");
    return;
  }

  if (authMode === "register") {
    await registerAccount(email, password);
  } else {
    await loginAccount(email, password);
  }
}

async function registerAccount(email, password) {
  const backendResult = await backendRegister(email, password);
  if (backendResult.kind === "success") {
    localStorage.setItem(SESSION_KEY, email);
    setLoggedInUI(email);
    await refreshAccountDetails();
    authNote.textContent = "Account created successfully.";
    showToast("Registration successful.");
    clearAuthFields();
    closeAuthOverlay();
    return;
  }

  if (backendResult.kind === "exists") {
    authNote.textContent = "Account already exists. Please login.";
    showToast("Account already exists.");
    authMode = "login";
    renderAuthMode();
    return;
  }

  const users = getUsers();
  const exists = users.some((user) => user.email === email);
  if (exists) {
    authNote.textContent = "Account already exists. Please login.";
    showToast("Account already exists.");
    authMode = "login";
    renderAuthMode();
    return;
  }

  users.push({
    email,
    password,
    createdAt: new Date().toISOString()
  });
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
  localStorage.setItem(SESSION_KEY, email);
  setLoggedInUI(email);
  await refreshAccountDetails();
  authNote.textContent = "Server offline. Saved only on this device.";
  showToast("Saved locally. Run server for shared accounts.");
  clearAuthFields();
  closeAuthOverlay();
}

async function loginAccount(email, password) {
  const backendResult = await backendLogin(email, password);
  if (backendResult.kind === "success") {
    localStorage.setItem(SESSION_KEY, email);
    setLoggedInUI(email);
    await refreshAccountDetails();
    authNote.textContent = "Login successful.";
    showToast("Welcome back.");
    clearAuthFields();
    closeAuthOverlay();
    return;
  }

  if (backendResult.kind === "not-found") {
    authNote.textContent = "No account found. Please register first.";
    showToast("Account not found.");
    authMode = "register";
    renderAuthMode();
    return;
  }

  if (backendResult.kind === "wrong-password") {
    authNote.textContent = "Incorrect password. Try again.";
    showToast("Wrong password.");
    return;
  }

  const users = getUsers();
  const user = users.find((entry) => entry.email === email);
  if (!user) {
    authNote.textContent = "No account found. Please register first.";
    showToast("Account not found.");
    authMode = "register";
    renderAuthMode();
    return;
  }

  if (user.password !== password) {
    authNote.textContent = "Incorrect password. Try again.";
    showToast("Wrong password.");
    return;
  }

  localStorage.setItem(SESSION_KEY, email);
  setLoggedInUI(email);
  await refreshAccountDetails();
  authNote.textContent = "Login successful (local mode).";
  showToast("Welcome back.");
  clearAuthFields();
  closeAuthOverlay();
}

function logoutAccount() {
  localStorage.removeItem(SESSION_KEY);
  setLoggedOutUI();
  refreshAccountDetails();
  showToast("Logged out.");
}

function setLoggedInUI(email) {
  authOpenBtn.dataset.authState = "logged-in";
  authOpenBtn.innerHTML = `<i class="fa-solid fa-right-from-bracket"></i> Logout (${email})`;
  authOpenBtn.classList.add("logged-in");
}

function setLoggedOutUI() {
  authOpenBtn.dataset.authState = "logged-out";
  authOpenBtn.innerHTML = '<i class="fa-regular fa-user"></i> Login';
  authOpenBtn.classList.remove("logged-in");
}

async function refreshAccountDetails() {
  const users = getUsers();
  const current = localStorage.getItem(SESSION_KEY);
  accountCurrent.textContent = `Current user: ${current || "Not logged in"}`;

  const backendCount = await fetchBackendAccountCount();
  if (typeof backendCount === "number") {
    accountTotal.textContent = `Registered accounts: ${backendCount}`;
    return;
  }

  accountTotal.textContent = `Registered accounts: ${users.length}`;
}

function clearAuthFields() {
  authEmail.value = "";
  authPassword.value = "";
}

function getUsers() {
  const raw = localStorage.getItem(USERS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("Users data corrupted, resetting:", error);
    return [];
  }
}

function resolveBackendBaseUrl() {
  const configuredBaseUrl = normalizeBaseUrl(window.SCANPRO_CONFIG?.API_BASE_URL || "");
  if (configuredBaseUrl) return configuredBaseUrl;

  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (isLocalhost) return window.location.origin;

  return "";
}

function normalizeBaseUrl(url) {
  const cleaned = String(url).trim();
  if (!cleaned) return "";
  return cleaned.replace(/\/+$/, "");
}

function buildApiUrl(path) {
  return BACKEND_BASE_URL ? `${BACKEND_BASE_URL}${path}` : path;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function backendRegister(email, password) {
  try {
    const response = await fetch(buildApiUrl("/api/register"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (response.status === 201) return { kind: "success" };
    if (response.status === 409) return { kind: "exists" };
    return { kind: "error" };
  } catch (error) {
    return { kind: "offline" };
  }
}

async function backendLogin(email, password) {
  try {
    const response = await fetch(buildApiUrl("/api/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    if (response.status === 200) return { kind: "success" };
    if (response.status === 404) return { kind: "not-found" };
    if (response.status === 401) return { kind: "wrong-password" };
    return { kind: "error" };
  } catch (error) {
    return { kind: "offline" };
  }
}

async function fetchBackendAccountCount() {
  try {
    const response = await fetch(buildApiUrl("/api/account-stats"));
    if (!response.ok) return null;
    const data = await response.json();
    if (typeof data.totalUsers === "number") return data.totalUsers;
    return null;
  } catch (error) {
    return null;
  }
}

async function startScan() {
  if (!localStorage.getItem(SESSION_KEY)) {
    showToast("Please login first.");
    openAuthOverlay();
    return;
  }

  if (scannerRunning) return;

  if (!window.Html5Qrcode) {
    setStatus("Scanner library failed to load.", false);
    showToast("Scanner initialization failed.");
    return;
  }

  if (!isCameraAllowedByContext()) {
    setStatus("Camera needs HTTPS on mobile. Use HTTPS or scan from image.", false);
    showToast("Camera blocked by browser security.");
    return;
  }

  try {
    scanner = new Html5Qrcode("reader");
    readerWrap.classList.add("active");
    scannerRunning = true;
    setControlsState(true);
    setStatus("Starting camera...", false);

    const config = getScannerConfig();
    const cameraInput = await resolveBestCameraInput();

    await scanner.start(
      cameraInput,
      config,
      (decodedText, decodedResult) => onScanSuccess(decodedText, decodedResult),
      () => {}
    );

    setStatus(`Camera is live. Point at ${currentScanMode.toUpperCase()} code.`, false);
  } catch (error) {
    console.error(error);
    scannerRunning = false;
    readerWrap.classList.remove("active");
    setControlsState(false);

    if (!isCameraAllowedByContext()) {
      setStatus("Camera blocked: open the site in HTTPS on mobile.", false);
      showToast("Use HTTPS or image upload for scanning.");
    } else {
      setStatus("Camera access denied or unavailable.", false);
      showToast("Unable to start scanner.");
    }
  }
}

function isCameraAllowedByContext() {
  const isLocalhost = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  return window.isSecureContext || isLocalhost;
}

async function resolveBestCameraInput() {
  if (!window.Html5Qrcode || typeof Html5Qrcode.getCameras !== "function") {
    return { facingMode: "environment" };
  }

  try {
    const cameras = await Html5Qrcode.getCameras();
    if (!Array.isArray(cameras) || cameras.length === 0) {
      return { facingMode: "environment" };
    }

    const rearCamera = cameras.find((camera) => /back|rear|environment/i.test(camera.label || ""));
    return rearCamera ? rearCamera.id : cameras[0].id;
  } catch (error) {
    return { facingMode: "environment" };
  }
}

async function stopScan() {
  if (!scannerRunning || !scanner) return;
  try {
    await scanner.stop();
    await scanner.clear();
  } catch (error) {
    console.warn("Stop scan warning:", error);
  } finally {
    scannerRunning = false;
    readerWrap.classList.remove("active");
    setControlsState(false);
    setStatus("Scanner stopped.", false);
  }
}

async function scanFromImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;

  if (!window.Html5Qrcode) {
    setStatus("Scanner library failed to load.", false);
    return;
  }

  try {
    if (!scanner) scanner = new Html5Qrcode("reader");
    const decodedText = await scanner.scanFile(file, true);
    onScanSuccess(decodedText);
  } catch (error) {
    console.error(error);
    setStatus("No code found in selected image.", false);
    showToast("Image scan failed.");
  } finally {
    fileInput.value = "";
  }
}

async function onScanSuccess(decodedText) {
  if (!decodedText) return;
  if (decodedText === lastResult) return;

  lastResult = decodedText;
  resultText.value = decodedText;
  setStatus(`${currentScanMode.toUpperCase()} scan successful.`, true);
  showToast("Code detected successfully.");
  playSuccessTone();

  sendResultToBackend(decodedText).catch((err) => console.debug("Backend hook skipped:", err));
}

function setActiveSection(sectionId) {
  document.querySelectorAll("main section").forEach((section) => {
    if (section.id === sectionId || section.id === "home") {
      section.classList.remove("hidden");
    } else if (section.classList.contains("scanner-section") || section.classList.contains("info-section")) {
      section.classList.add("hidden");
    }
  });

  navItems.forEach((item) => item.classList.toggle("active", item.dataset.section === sectionId));

  if (sectionId === "scanner-barcode") {
    currentScanMode = "barcode";
    setStatus("Barcode mode selected.", false);
  } else if (sectionId === "scanner-qr") {
    currentScanMode = "qr";
    setStatus("QR mode selected.", false);
  } else {
    stopScan();
  }
}

function getScannerConfig() {
  const base = {
    fps: 12,
    qrbox: { width: 250, height: 250 },
    aspectRatio: 1.4
  };

  if (!window.Html5QrcodeSupportedFormats) {
    return base;
  }

  if (currentScanMode === "qr") {
    return {
      ...base,
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
    };
  }

  return {
    ...base,
    formatsToSupport: [
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      Html5QrcodeSupportedFormats.CODE_93,
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.ITF,
      Html5QrcodeSupportedFormats.CODABAR
    ]
  };
}

function setStatus(message, isSuccess) {
  statusEl.textContent = message;
  statusEl.classList.toggle("success", Boolean(isSuccess));
}

function setControlsState(isScanning) {
  startBtn.disabled = isScanning;
  stopBtn.disabled = !isScanning;
}

function clearResult() {
  resultText.value = "";
  lastResult = "";
  setStatus("Result cleared. Ready to scan.", false);
}

async function copyResult() {
  const value = resultText.value.trim();
  if (!value) {
    showToast("No result to copy.");
    return;
  }

  try {
    await navigator.clipboard.writeText(value);
    showToast("Copied to clipboard.");
  } catch (error) {
    console.error(error);
    showToast("Copy failed.");
  }
}

function openResult() {
  const value = resultText.value.trim();
  if (!value) {
    showToast("No result available.");
    return;
  }

  const isUrl = /^https?:\/\//i.test(value);
  const target = isUrl
    ? value
    : `https://www.google.com/search?q=${encodeURIComponent(value)}`;
  window.open(target, "_blank", "noopener,noreferrer");
}

async function sendResultToBackend(result) {
  const endpoint = buildApiUrl("/api/scan-result");

  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      result,
      timestamp: new Date().toISOString()
    })
  });
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast._timer);
  showToast._timer = window.setTimeout(() => {
    toast.classList.remove("show");
  }, 1900);
}

function playSuccessTone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.05;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (error) {
    console.debug("Audio feedback unavailable:", error);
  }
}
