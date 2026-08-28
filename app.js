import { auth, db } from "./firebase-config.js";
import {
  GoogleAuthProvider,
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  getIdTokenResult,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-auth.js";
import {
  get,
  onValue,
  ref,
  runTransaction,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/12.18.0/firebase-database.js";

const ADMIN_EMAIL = "oliveora72@gmail.com";
const appRoot = document.querySelector("#app");
const headerActions = document.querySelector("#header-actions");
const banner = document.querySelector("#global-banner");
const toastRegion = document.querySelector("#toast-region");
const googleProvider = new GoogleAuthProvider();

let currentUser = null;
let routeToken = 0;
let subscriptions = [];

document.querySelector("#current-year").textContent = new Date().getFullYear();
setPersistence(auth, browserLocalPersistence).catch(() => {});

function cleanSubscriptions() {
  subscriptions.forEach((unsubscribe) => unsubscribe?.());
  subscriptions = [];
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function formatRemaining(expiresAt) {
  const remaining = Number(expiresAt) - Date.now();
  if (remaining <= 0) return "Expirada";
  const minutes = Math.ceil(remaining / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.ceil(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.ceil(hours / 24)} dias`;
}

function notify(message, tone = "default") {
  const toast = document.createElement("div");
  toast.className = `toast toast-${tone}`;
  toast.textContent = message;
  toastRegion.append(toast);
  requestAnimationFrame(() => toast.classList.add("toast-visible"));
  setTimeout(() => {
    toast.classList.remove("toast-visible");
    setTimeout(() => toast.remove(), 250);
  }, 3600);
}

function friendlyError(error) {
  const code = error?.code || "";
  const messages = {
    "auth/email-already-in-use": "Este e-mail já possui uma conta.",
    "auth/invalid-credential": "E-mail ou senha incorretos.",
    "auth/invalid-email": "Digite um e-mail válido.",
    "auth/missing-password": "Digite sua senha.",
    "auth/weak-password": "Use uma senha com pelo menos 6 caracteres.",
    "auth/popup-closed-by-user": "A janela do Google foi fechada antes de concluir.",
    "auth/unauthorized-domain": "Adicione este domínio aos domínios autorizados do Firebase.",
    PERMISSION_DENIED: "As regras do Firebase ainda precisam ser publicadas.",
  };
  return messages[code] || messages[error?.message] || error?.message || "Não foi possível concluir agora.";
}

async function hasAdminAccess(user = currentUser) {
  if (!user) return false;
  if ((user.email || "").toLowerCase() === ADMIN_EMAIL) return true;
  try {
    const token = await getIdTokenResult(user);
    return token.claims.admin === true;
  } catch {
    return false;
  }
}

function navigate(path) {
  history.pushState({}, "", path);
  renderRoute();
}

document.addEventListener("click", (event) => {
  const routeLink = event.target.closest("[data-route]");
  if (!routeLink) return;
  const url = new URL(routeLink.href, location.origin);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  navigate(`${url.pathname}${url.search}${url.hash}`);
});

window.addEventListener("popstate", renderRoute);

async function updateHeader() {
  if (!currentUser) {
    headerActions.innerHTML = `
      <a class="button button-ghost" href="/login" data-route>Entrar</a>
      <a class="button button-primary button-small" href="/login?mode=register" data-route>Criar conta</a>
    `;
    return;
  }

  const admin = await hasAdminAccess();
  headerActions.innerHTML = `
    ${admin ? '<a class="button button-ghost desktop-only" href="/admin" data-route>Admin</a>' : ""}
    <a class="user-pill" href="/app" data-route aria-label="Abrir minha conta">
      <span>${escapeHtml((currentUser.displayName || currentUser.email || "U").charAt(0).toUpperCase())}</span>
      <strong>${escapeHtml(currentUser.displayName || "Minha conta")}</strong>
    </a>
  `;
}

function setPage(content, className = "") {
  appRoot.className = className;
  appRoot.innerHTML = content;
  appRoot.focus({ preventScroll: true });
}

function mascotMessage(title, text, tone = "violet") {
  return `
    <aside class="mascot-message mascot-message-${tone}">
      <img src="/assets/kage-mascot.webp" alt="Kage, mascote do KageSync" />
      <div>
        <span>Kage diz</span>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(text)}</p>
      </div>
    </aside>
  `;
}

function renderHome() {
  const primaryHref = currentUser ? "/app" : "/login?mode=register";
  const primaryLabel = currentUser ? "Abrir meu painel" : "Criar minha conta";
  setPage(
    `
      <section class="hero section-shell">
        <div class="hero-copy">
          <div class="eyebrow"><span></span> Feito para jogar do seu jeito</div>
          <h1>Seu controle.<br /><span>Seu ritmo.</span></h1>
          <p class="hero-lead">Mapeamento preciso, perfis inteligentes e configuração simples em uma experiência criada para quem leva cada partida a sério.</p>
          <div class="hero-actions">
            <a class="button button-primary button-large" href="${primaryHref}" data-route>${primaryLabel} <span aria-hidden="true">→</span></a>
            <a class="button button-outline button-large" href="#recursos">Conhecer recursos</a>
          </div>
          <div class="trust-row">
            <div><strong>1 dispositivo</strong><span>por licença</span></div>
            <div><strong>Perfis rápidos</strong><span>prontos para jogar</span></div>
            <div><strong>Firebase</strong><span>conta sincronizada</span></div>
          </div>
        </div>

        <div class="hero-visual" aria-label="Kage, mascote do KageSync">
          <div class="orbit orbit-one"></div>
          <div class="orbit orbit-two"></div>
          <div class="hero-glow"></div>
          <img class="hero-mascot" src="/assets/kage-mascot.webp" alt="Kage, personagem anime do KageSync" />
          <div class="floating-chip chip-top"><span class="live-dot"></span> Sistema online</div>
          <div class="floating-chip chip-bottom"><strong>Precisão</strong><span>sem complicação</span></div>
        </div>
      </section>

      <section class="feature-band" id="recursos">
        <div class="section-shell">
          <div class="section-heading">
            <div><span class="section-index">01</span><h2>Tudo que você precisa<br />antes da partida</h2></div>
            <p>Menos tempo configurando. Mais tempo jogando com um controle que responde como você espera.</p>
          </div>
          <div class="feature-grid">
            <article class="feature-card feature-card-primary">
              <span class="feature-icon">⌁</span>
              <div><small>CONTROLE</small><h3>Mapeamento preciso</h3><p>Organize teclas, mouse e ações com perfis preparados para cada jogo.</p></div>
              <span class="feature-number">01</span>
            </article>
            <article class="feature-card">
              <span class="feature-icon">◎</span>
              <div><small>PERFIL</small><h3>Pronto para começar</h3><p>Novos usuários recebem uma base organizada e podem personalizar quando quiserem.</p></div>
              <span class="feature-number">02</span>
            </article>
            <article class="feature-card">
              <span class="feature-icon">↯</span>
              <div><small>RESPOSTA</small><h3>Experiência leve</h3><p>Fluxo direto, telas limpas e acesso rápido às opções mais importantes.</p></div>
              <span class="feature-number">03</span>
            </article>
          </div>
        </div>
      </section>

      <section class="steps-section section-shell" id="como-funciona">
        <div class="section-heading compact">
          <div><span class="section-index">02</span><h2>Entre. Ative.<br />Comece a jogar.</h2></div>
        </div>
        <div class="steps-grid">
          <article><span>1</span><h3>Crie sua conta</h3><p>Use e-mail ou Google para manter sua licença ligada ao seu perfil.</p></article>
          <article><span>2</span><h3>Resgate sua key</h3><p>Entre no Discord, receba sua key e ative diretamente no painel.</p></article>
          <article><span>3</span><h3>Abra o KageSync</h3><p>Use a mesma conta no aplicativo e continue a configuração.</p></article>
        </div>
      </section>

      <section class="security-section" id="seguranca">
        <div class="section-shell security-inner">
          <div class="security-copy">
            <span class="section-index">03</span>
            <h2>Sua licença fica<br />com você.</h2>
            <p>Cada key pode ser vinculada a apenas um dispositivo. A conta guarda o estado da licença e recebe avisos e atualizações oficiais do KageSync.</p>
            <a class="text-link" href="/login?mode=register" data-route>Criar conta protegida <span>→</span></a>
          </div>
          ${mascotMessage("Eu te acompanho por aqui", "No painel você vê a licença, os avisos oficiais e tudo que precisa para começar.")}
        </div>
      </section>
    `,
    "page-home",
  );
}

function renderAuth() {
  if (currentUser) {
    navigate("/app");
    return;
  }
  const mode = new URLSearchParams(location.search).get("mode") === "register" ? "register" : "login";
  setPage(
    `
      <section class="auth-page section-shell">
        <div class="auth-art">
          <div class="auth-orb"></div>
          <img src="/assets/kage-mascot.webp" alt="Kage, mascote do KageSync" />
          <div class="auth-quote"><span>Kage diz</span><strong>Que bom ter você aqui.</strong><p>Crie sua conta para ligar a key ao seu perfil e continuar no aplicativo.</p></div>
        </div>
        <div class="auth-card">
          <a class="back-link" href="/" data-route>← Voltar ao início</a>
          <div class="auth-tabs" role="tablist">
            <button class="auth-tab ${mode === "login" ? "active" : ""}" data-auth-mode="login" type="button">Entrar</button>
            <button class="auth-tab ${mode === "register" ? "active" : ""}" data-auth-mode="register" type="button">Criar conta</button>
          </div>
          <div class="auth-heading">
            <span>${mode === "login" ? "BEM-VINDO DE VOLTA" : "COMECE AGORA"}</span>
            <h1>${mode === "login" ? "Entre na sua conta" : "Crie sua conta"}</h1>
            <p>${mode === "login" ? "Acesse sua licença e os avisos do KageSync." : "Leva menos de um minuto para começar."}</p>
          </div>
          <form id="auth-form" class="stack-form" data-mode="${mode}">
            ${mode === "register" ? '<label>Seu nome<input name="name" autocomplete="name" maxlength="48" placeholder="Como podemos te chamar?" required /></label>' : ""}
            <label>E-mail<input type="email" name="email" autocomplete="email" placeholder="voce@email.com" required /></label>
            <label>Senha<input type="password" name="password" autocomplete="${mode === "login" ? "current-password" : "new-password"}" minlength="6" placeholder="Mínimo de 6 caracteres" required /></label>
            ${mode === "register" ? '<label>Confirmar senha<input type="password" name="confirmPassword" autocomplete="new-password" minlength="6" placeholder="Repita a senha" required /></label>' : ""}
            ${mode === "login" ? '<button class="forgot-link" type="button" id="forgot-password">Esqueci minha senha</button>' : ""}
            <button class="button button-primary button-full" type="submit">${mode === "login" ? "Entrar" : "Criar minha conta"}</button>
          </form>
          <div class="auth-divider"><span>ou continue com</span></div>
          <button class="button button-google button-full" id="google-auth" type="button"><span class="google-g">G</span> Google</button>
          <p class="auth-terms">Ao continuar, você concorda em usar uma licença apenas no dispositivo permitido.</p>
        </div>
      </section>
    `,
    "page-auth",
  );

  document.querySelectorAll("[data-auth-mode]").forEach((button) => {
    button.addEventListener("click", () => navigate(`/login${button.dataset.authMode === "register" ? "?mode=register" : ""}`));
  });

  document.querySelector("#auth-form").addEventListener("submit", handleEmailAuth);
  document.querySelector("#google-auth").addEventListener("click", handleGoogleAuth);
  document.querySelector("#forgot-password")?.addEventListener("click", handlePasswordReset);
}

async function handleEmailAuth(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector("button[type=submit]");
  const data = new FormData(form);
  const email = String(data.get("email") || "").trim();
  const password = String(data.get("password") || "");
  const mode = form.dataset.mode;

  if (mode === "register" && password !== data.get("confirmPassword")) {
    notify("As senhas não são iguais.", "error");
    return;
  }

  button.disabled = true;
  button.textContent = "Aguarde…";
  try {
    if (mode === "register") {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      const name = String(data.get("name") || "Usuário").trim();
      await updateProfile(result.user, { displayName: name });
      await set(ref(db, `users/${result.user.uid}`), {
        name,
        email: result.user.email,
        createdAt: Date.now(),
        role: email.toLowerCase() === ADMIN_EMAIL ? "admin" : "user",
      });
      notify("Conta criada. Bem-vindo ao KageSync!", "success");
    } else {
      await signInWithEmailAndPassword(auth, email, password);
      notify("Login realizado.", "success");
    }
    navigate("/app");
  } catch (error) {
    notify(friendlyError(error), "error");
    button.disabled = false;
    button.textContent = mode === "login" ? "Entrar" : "Criar minha conta";
  }
}

async function handleGoogleAuth() {
  const button = document.querySelector("#google-auth");
  button.disabled = true;
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const userRef = ref(db, `users/${result.user.uid}`);
    const existing = await get(userRef);
    if (!existing.exists()) {
      await set(userRef, {
        name: result.user.displayName || "Usuário",
        email: result.user.email,
        createdAt: Date.now(),
        role: (result.user.email || "").toLowerCase() === ADMIN_EMAIL ? "admin" : "user",
      });
    }
    notify("Conta conectada com o Google.", "success");
    navigate("/app");
  } catch (error) {
    notify(friendlyError(error), "error");
    button.disabled = false;
  }
}

async function handlePasswordReset() {
  const email = document.querySelector("input[name=email]").value.trim();
  if (!email) {
    notify("Digite seu e-mail primeiro.", "error");
    return;
  }
  try {
    await sendPasswordResetEmail(auth, email);
    notify("Enviamos o link de recuperação para seu e-mail.", "success");
  } catch (error) {
    notify(friendlyError(error), "error");
  }
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value.trim().toUpperCase());
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function loadCurrentLicense(userData) {
  if (!userData?.licenseHash) return null;
  try {
    const snapshot = await get(ref(db, `keys/${userData.licenseHash}`));
    return snapshot.exists() ? { hash: userData.licenseHash, ...snapshot.val() } : null;
  } catch {
    return null;
  }
}

async function renderDashboard(token) {
  if (!currentUser) {
    navigate("/login");
    return;
  }

  setPage(
    `<section class="dashboard-shell section-shell"><div class="loading-card"><span class="spinner"></span><p>Preparando seu painel…</p></div></section>`,
    "page-dashboard",
  );

  try {
    const [userSnapshot, settingsSnapshot, systemSnapshot] = await Promise.all([
      get(ref(db, `users/${currentUser.uid}`)),
      get(ref(db, "settings")),
      get(ref(db, "system")),
    ]);
    if (token !== routeToken) return;
    const userData = userSnapshot.val() || {};
    const settings = settingsSnapshot.val() || {};
    const system = systemSnapshot.val() || {};
    const license = await loadCurrentLicense(userData);
    if (token !== routeToken) return;
    paintDashboard(userData, settings, system, license);
  } catch (error) {
    setPage(
      `<section class="dashboard-shell section-shell">${mascotMessage("Falta só uma etapa", "As regras do Firebase ainda precisam ser publicadas para liberar o painel.", "red")}<div class="setup-card"><h2>Não consegui abrir sua conta</h2><p>${escapeHtml(friendlyError(error))}</p><button class="button button-outline" id="retry-dashboard">Tentar novamente</button></div></section>`,
      "page-dashboard",
    );
    document.querySelector("#retry-dashboard").addEventListener("click", renderRoute);
  }
}

function paintDashboard(userData, settings, system, license) {
  const isExpired = license && Number(license.expiresAt) <= Date.now();
  const isRevoked = license?.status === "revoked";
  const licenseActive = license && !isExpired && !isRevoked;
  const invite = settings.discordInvite || "";
  const announcement = system.broadcast;

  setPage(
    `
      <section class="dashboard-shell section-shell">
        <div class="dashboard-topbar">
          <div>
            <span class="eyebrow eyebrow-plain">PAINEL KAGESYNC</span>
            <h1>Olá, ${escapeHtml(userData.name || currentUser.displayName || "jogador")}.</h1>
            <p>Acompanhe sua licença e os avisos oficiais por aqui.</p>
          </div>
          <div class="dashboard-actions">
            ${(currentUser.email || "").toLowerCase() === ADMIN_EMAIL ? '<a class="button button-outline" href="/admin" data-route>Abrir admin</a>' : ""}
            <button class="button button-ghost danger-text" id="sign-out">Sair</button>
          </div>
        </div>

        ${system.appDisabled ? `<div class="danger-banner"><strong>Aplicativo temporariamente desativado</strong><p>${escapeHtml(system.disabledReason || "Aguarde um novo aviso da equipe KageSync.")}</p></div>` : ""}
        ${announcement?.message ? mascotMessage(announcement.title || "Aviso oficial", announcement.message, announcement.tone || "violet") : mascotMessage("Seu painel está pronto", "Aqui você resgata sua key e acompanha o tempo restante da licença.")}

        <div class="dashboard-grid">
          <article class="panel-card license-card ${licenseActive ? "active-license" : ""}">
            <div class="panel-card-head"><div><span>MINHA LICENÇA</span><h2>${licenseActive ? "KageSync ativo" : license ? "Licença indisponível" : "Nenhuma key ativa"}</h2></div><span class="status-badge ${licenseActive ? "status-success" : "status-muted"}">${licenseActive ? "ATIVA" : isRevoked ? "REVOGADA" : isExpired ? "EXPIRADA" : "SEM KEY"}</span></div>
            ${
              license
                ? `<div class="license-details"><div><span>KEY</span><strong>${escapeHtml(license.codeMasked || "KAGE-••••-••••-••••")}</strong></div><div><span>TEMPO RESTANTE</span><strong>${formatRemaining(license.expiresAt)}</strong></div><div><span>DISPOSITIVOS</span><strong>${Number(license.maxDevices || 1)} permitido</strong></div><div><span>VALIDADE</span><strong>${formatDate(license.expiresAt)}</strong></div></div>`
                : `<div class="empty-license"><span>◇</span><p>Quando você resgatar uma key, os detalhes vão aparecer aqui.</p></div>`
            }
          </article>

          <article class="panel-card redeem-card">
            <div class="panel-card-head"><div><span>ATIVAÇÃO</span><h2>Resgatar uma key</h2></div><span class="panel-icon">⌁</span></div>
            <p>Digite exatamente a key que você recebeu. Ela ficará ligada a esta conta.</p>
            <form id="redeem-form" class="inline-form">
              <input name="key" autocomplete="off" placeholder="KAGE-XXXX-XXXX-XXXX" aria-label="Key KageSync" required />
              <button class="button button-primary" type="submit">Ativar</button>
            </form>
            <small>Uma key ativa pode ser usada em apenas um dispositivo.</small>
          </article>

          <article class="panel-card discord-card">
            <div class="panel-card-head"><div><span>COMUNIDADE</span><h2>Discord KageSync</h2></div><span class="panel-icon">#</span></div>
            <p>Entre no servidor para acompanhar novidades e receber as instruções para obter sua key.</p>
            ${invite ? `<a class="button button-discord button-full" href="${escapeHtml(invite)}" target="_blank" rel="noopener">Entrar no Discord ↗</a>` : '<button class="button button-disabled button-full" disabled>Convite será publicado em breve</button>'}
          </article>

          <article class="panel-card update-card">
            <div class="panel-card-head"><div><span>APLICATIVO</span><h2>${system.update?.version ? `Versão ${escapeHtml(system.update.version)}` : "Atualizações"}</h2></div><span class="panel-icon">↓</span></div>
            <p>${escapeHtml(system.update?.message || "O download oficial aparecerá aqui quando a primeira versão for liberada.")}</p>
            ${system.update?.url ? `<a class="button button-outline button-full" href="${escapeHtml(system.update.url)}" target="_blank" rel="noopener">Baixar atualização</a>` : '<button class="button button-disabled button-full" disabled>Nenhuma versão publicada</button>'}
          </article>
        </div>
      </section>
    `,
    "page-dashboard",
  );

  document.querySelector("#sign-out").addEventListener("click", async () => {
    await signOut(auth);
    notify("Você saiu da conta.");
    navigate("/");
  });
  document.querySelector("#redeem-form").addEventListener("submit", handleRedeemKey);

  subscriptions.push(
    onValue(ref(db, "system/broadcast"), (snapshot) => {
      if (!snapshot.exists()) return;
      const value = snapshot.val();
      banner.hidden = false;
      banner.innerHTML = `<strong>${escapeHtml(value.title || "KageSync")}</strong><span>${escapeHtml(value.message || "")}</span>`;
    }),
  );
}

async function handleRedeemKey(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button");
  const key = String(new FormData(event.currentTarget).get("key") || "").trim().toUpperCase();
  if (!/^KAGE-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(key)) {
    notify("Confira o formato da key.", "error");
    return;
  }

  button.disabled = true;
  button.textContent = "Verificando…";
  try {
    const hash = await sha256(key);
    const keyRef = ref(db, `keys/${hash}`);
    const keySnapshot = await get(keyRef);
    const keyData = keySnapshot.val();
    if (!keyData || keyData.status !== "active" || Number(keyData.expiresAt) <= Date.now()) {
      throw new Error("Esta key não existe, expirou ou já pertence a outra conta.");
    }

    const claimResult = await runTransaction(ref(db, `keys/${hash}/claimedBy`), (claimedBy) => {
      if (claimedBy && claimedBy !== currentUser.uid) return;
      return currentUser.uid;
    });

    if (!claimResult.committed || claimResult.snapshot.val() !== currentUser.uid) {
      throw new Error("Esta key não existe, expirou ou já pertence a outra conta.");
    }

    const claimedAtRef = ref(db, `keys/${hash}/claimedAt`);
    const claimedAtSnapshot = await get(claimedAtRef);
    if (!claimedAtSnapshot.exists()) await set(claimedAtRef, Date.now());

    await update(ref(db, `users/${currentUser.uid}`), { licenseHash: hash, updatedAt: Date.now() });
    notify("Key ativada com sucesso!", "success");
    renderRoute();
  } catch (error) {
    notify(friendlyError(error), "error");
    button.disabled = false;
    button.textContent = "Ativar";
  }
}

function keyStatus(key) {
  if (key.status === "revoked") return { label: "REVOGADA", className: "status-danger" };
  if (Number(key.expiresAt) <= Date.now()) return { label: "EXPIRADA", className: "status-muted" };
  if (key.claimedBy) return { label: "EM USO", className: "status-info" };
  return { label: "ATIVA", className: "status-success" };
}

async function renderAdmin(token) {
  if (!currentUser) {
    navigate("/login");
    return;
  }
  if (!(await hasAdminAccess())) {
    notify("Esta área é exclusiva do administrador.", "error");
    navigate("/app");
    return;
  }

  setPage(`<section class="admin-shell section-shell"><div class="loading-card"><span class="spinner"></span><p>Carregando central de controle…</p></div></section>`, "page-admin");
  try {
    const [keysSnapshot, usersSnapshot, systemSnapshot, settingsSnapshot] = await Promise.all([
      get(ref(db, "keys")),
      get(ref(db, "users")),
      get(ref(db, "system")),
      get(ref(db, "settings")),
    ]);
    if (token !== routeToken) return;
    paintAdmin(keysSnapshot.val() || {}, usersSnapshot.val() || {}, systemSnapshot.val() || {}, settingsSnapshot.val() || {});
  } catch (error) {
    setPage(`<section class="admin-shell section-shell">${mascotMessage("O painel está protegido", "Publique as regras do Firebase para liberar as ferramentas administrativas.", "red")}<div class="setup-card"><h2>Configuração necessária</h2><p>${escapeHtml(friendlyError(error))}</p><p>Use o arquivo <strong>database.rules.json</strong> deste projeto no Realtime Database.</p></div></section>`, "page-admin");
  }
}

function paintAdmin(keys, users, system, settings) {
  const keyEntries = Object.entries(keys).sort(([, a], [, b]) => Number(b.createdAt) - Number(a.createdAt));
  const activeCount = keyEntries.filter(([, key]) => keyStatus(key).label === "ATIVA").length;
  const claimedCount = keyEntries.filter(([, key]) => Boolean(key.claimedBy)).length;
  const userCount = Object.keys(users).length;

  setPage(
    `
      <section class="admin-shell section-shell">
        <div class="admin-topbar">
          <div><span class="eyebrow eyebrow-plain">CENTRAL DE CONTROLE</span><h1>Admin KageSync</h1><p>Licenças, comunicação e estado do aplicativo em um só lugar.</p></div>
          <div class="dashboard-actions"><a class="button button-outline" href="/app" data-route>Ver como usuário</a><button class="button button-ghost danger-text" id="admin-sign-out">Sair</button></div>
        </div>

        <div class="stat-grid">
          <article><span>KEYS TOTAIS</span><strong>${keyEntries.length}</strong><small>Todas as licenças</small></article>
          <article><span>DISPONÍVEIS</span><strong>${activeCount}</strong><small>Prontas para resgate</small></article>
          <article><span>EM USO</span><strong>${claimedCount}</strong><small>Ligadas a contas</small></article>
          <article><span>USUÁRIOS</span><strong>${userCount}</strong><small>Contas cadastradas</small></article>
        </div>

        <div class="admin-layout">
          <div class="admin-main">
            <article class="admin-card">
              <div class="admin-card-title"><div><span>LICENÇAS</span><h2>Gerador de keys</h2></div><span class="panel-icon">＋</span></div>
              <form id="generate-key-form" class="form-grid">
                <label>Quantidade<input type="number" name="quantity" min="1" max="25" value="1" required /></label>
                <label>Duração<select name="duration"><option value="60">1 hora</option><option value="1440">1 dia</option><option value="10080">7 dias</option><option value="43200" selected>30 dias</option><option value="custom">Personalizada</option></select></label>
                <label class="custom-duration" hidden>Minutos<input type="number" name="customMinutes" min="1" value="60" /></label>
                <button class="button button-primary" type="submit">Gerar keys</button>
              </form>
              <div id="generated-keys"></div>
            </article>

            <article class="admin-card keys-card">
              <div class="admin-card-title"><div><span>GERENCIAMENTO</span><h2>Keys criadas</h2></div><span class="table-count">${keyEntries.length}</span></div>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>Key</th><th>Status</th><th>Validade</th><th>Usuário</th><th>Ações</th></tr></thead>
                  <tbody>
                    ${
                      keyEntries.length
                        ? keyEntries
                            .map(([hash, key]) => {
                              const status = keyStatus(key);
                              return `<tr><td><code>${escapeHtml(key.code || key.codeMasked || "Oculta")}</code></td><td><span class="status-badge ${status.className}">${status.label}</span></td><td>${formatDate(key.expiresAt)}<small>${formatRemaining(key.expiresAt)}</small></td><td>${key.claimedBy ? `<span class="uid-text">${escapeHtml(key.claimedBy.slice(0, 9))}…</span>` : "—"}</td><td><div class="table-actions"><button data-copy-key="${escapeHtml(key.code || "")}" title="Copiar key">Copiar</button><button data-key-action="${key.status === "revoked" ? "activate" : "revoke"}" data-key-hash="${hash}" class="${key.status === "revoked" ? "" : "danger-text"}">${key.status === "revoked" ? "Ativar" : "Revogar"}</button></div></td></tr>`;
                            })
                            .join("")
                        : '<tr><td colspan="5" class="empty-table">Nenhuma key criada ainda.</td></tr>'
                    }
                  </tbody>
                </table>
              </div>
            </article>
          </div>

          <aside class="admin-side">
            <article class="admin-card">
              <div class="admin-card-title"><div><span>AVISOS</span><h2>Mensagem global</h2></div><span class="panel-icon">✦</span></div>
              <form id="broadcast-form" class="stack-form compact-form">
                <label>Título<input name="title" maxlength="60" value="${escapeHtml(system.broadcast?.title || "")}" placeholder="Novidade KageSync" /></label>
                <label>Mensagem<textarea name="message" maxlength="260" rows="4" placeholder="Mensagem que aparecerá para os usuários">${escapeHtml(system.broadcast?.message || "")}</textarea></label>
                <label>Estilo<select name="tone"><option value="violet" ${system.broadcast?.tone !== "red" ? "selected" : ""}>Roxo</option><option value="red" ${system.broadcast?.tone === "red" ? "selected" : ""}>Alerta vermelho</option></select></label>
                <button class="button button-primary button-full" type="submit">Publicar mensagem</button>
              </form>
            </article>

            <article class="admin-card">
              <div class="admin-card-title"><div><span>APLICATIVO</span><h2>Atualização</h2></div><span class="panel-icon">↓</span></div>
              <form id="update-form" class="stack-form compact-form">
                <label>Versão<input name="version" value="${escapeHtml(system.update?.version || "")}" placeholder="1.0.0" /></label>
                <label>Link do APK<input type="url" name="url" value="${escapeHtml(system.update?.url || "")}" placeholder="https://..." /></label>
                <label>Descrição<textarea name="message" rows="3" maxlength="180">${escapeHtml(system.update?.message || "")}</textarea></label>
                <label class="check-row"><input type="checkbox" name="required" ${system.update?.required ? "checked" : ""} /><span>Atualização obrigatória</span></label>
                <button class="button button-outline button-full" type="submit">Salvar atualização</button>
              </form>
            </article>

            <article class="admin-card danger-card">
              <div class="admin-card-title"><div><span>CONTROLE REMOTO</span><h2>Estado do aplicativo</h2></div><span class="status-light ${system.appDisabled ? "off" : "on"}"></span></div>
              <form id="app-state-form" class="stack-form compact-form">
                <label class="switch-row"><span><strong>Desativar aplicativo</strong><small>Bloqueia o uso até ser reativado</small></span><input type="checkbox" name="disabled" ${system.appDisabled ? "checked" : ""} /></label>
                <label>Motivo<textarea name="reason" rows="3" maxlength="180" placeholder="Manutenção temporária">${escapeHtml(system.disabledReason || "")}</textarea></label>
                <button class="button ${system.appDisabled ? "button-outline" : "button-danger"} button-full" type="submit">Salvar estado</button>
              </form>
            </article>

            <article class="admin-card">
              <div class="admin-card-title"><div><span>COMUNIDADE</span><h2>Configurar Discord</h2></div><span class="panel-icon">#</span></div>
              <form id="discord-form" class="stack-form compact-form">
                <label>Link do convite<input type="url" name="invite" value="${escapeHtml(settings.discordInvite || "")}" placeholder="https://discord.gg/..." /></label>
                <label>ID do servidor<input name="serverId" value="${escapeHtml(settings.discordServerId || "")}" placeholder="000000000000000000" /></label>
                <button class="button button-outline button-full" type="submit">Salvar Discord</button>
              </form>
            </article>
          </aside>
        </div>
      </section>
    `,
    "page-admin",
  );

  bindAdminEvents();
}

function randomKeyPart(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const values = new Uint32Array(length);
  crypto.getRandomValues(values);
  return [...values].map((value) => alphabet[value % alphabet.length]).join("");
}

function createKeyCode() {
  return `KAGE-${randomKeyPart()}-${randomKeyPart()}-${randomKeyPart()}`;
}

function bindAdminEvents() {
  document.querySelector("#admin-sign-out").addEventListener("click", async () => {
    await signOut(auth);
    navigate("/");
  });

  const durationSelect = document.querySelector("select[name=duration]");
  durationSelect.addEventListener("change", () => {
    document.querySelector(".custom-duration").hidden = durationSelect.value !== "custom";
  });

  document.querySelector("#generate-key-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button");
    const data = new FormData(form);
    const quantity = Math.min(25, Math.max(1, Number(data.get("quantity")) || 1));
    const minutes = data.get("duration") === "custom" ? Number(data.get("customMinutes")) : Number(data.get("duration"));
    if (!minutes || minutes < 1) return notify("Informe uma duração válida.", "error");
    button.disabled = true;
    button.textContent = "Gerando…";
    try {
      const updates = {};
      const generated = [];
      for (let index = 0; index < quantity; index += 1) {
        const code = createKeyCode();
        const hash = await sha256(code);
        generated.push(code);
        updates[`keys/${hash}`] = {
          code,
          codeMasked: `${code.slice(0, 10)}-••••-••••`,
          status: "active",
          createdAt: Date.now(),
          expiresAt: Date.now() + minutes * 60000,
          durationMinutes: minutes,
          maxDevices: 1,
          createdBy: currentUser.uid,
        };
      }
      await update(ref(db), updates);
      document.querySelector("#generated-keys").innerHTML = `<div class="generated-box"><strong>Keys geradas</strong>${generated.map((key) => `<button type="button" data-copy-key="${key}"><code>${key}</code><span>Copiar</span></button>`).join("")}</div>`;
      notify(`${quantity} key${quantity > 1 ? "s" : ""} gerada${quantity > 1 ? "s" : ""}.`, "success");
      setTimeout(renderRoute, 900);
    } catch (error) {
      notify(friendlyError(error), "error");
      button.disabled = false;
      button.textContent = "Gerar keys";
    }
  });

  document.querySelector("#broadcast-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await set(ref(db, "system/broadcast"), { title: data.get("title") || "KageSync", message: data.get("message") || "", tone: data.get("tone") || "violet", publishedAt: Date.now() });
    notify("Mensagem publicada para os usuários.", "success");
  });

  document.querySelector("#update-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await set(ref(db, "system/update"), { version: data.get("version") || "", url: data.get("url") || "", message: data.get("message") || "", required: data.get("required") === "on", publishedAt: Date.now() });
    notify("Atualização salva.", "success");
  });

  document.querySelector("#app-state-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await update(ref(db, "system"), { appDisabled: data.get("disabled") === "on", disabledReason: data.get("reason") || "", stateUpdatedAt: Date.now() });
    notify("Estado do aplicativo atualizado.", "success");
    renderRoute();
  });

  document.querySelector("#discord-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await update(ref(db, "settings"), { discordInvite: data.get("invite") || "", discordServerId: data.get("serverId") || "", updatedAt: Date.now() });
    notify("Configuração do Discord salva.", "success");
  });

  document.querySelectorAll("[data-copy-key]").forEach((button) => {
    button.addEventListener("click", async () => {
      const key = button.dataset.copyKey;
      if (!key) return;
      await navigator.clipboard.writeText(key);
      notify("Key copiada.", "success");
    });
  });

  document.querySelectorAll("[data-key-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      const status = button.dataset.keyAction === "revoke" ? "revoked" : "active";
      await update(ref(db, `keys/${button.dataset.keyHash}`), { status, statusUpdatedAt: Date.now() });
      notify(status === "revoked" ? "Key revogada." : "Key reativada.", "success");
      renderRoute();
    });
  });
}

async function renderRoute() {
  routeToken += 1;
  const token = routeToken;
  cleanSubscriptions();
  banner.hidden = true;
  updateHeader();

  const path = location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/login") return renderAuth();
  if (path === "/app") return renderDashboard(token);
  if (path === "/admin") return renderAdmin(token);
  renderHome();
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  renderRoute();
});
