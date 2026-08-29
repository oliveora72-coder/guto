const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const state = {
  demo: false,
  config: { provider: 'sandbox' },
  user: null,
  merchant: null,
  dashboard: null,
  charges: [],
  links: [],
  customers: [],
  withdrawals: [],
  apiKeys: [],
  webhooks: [],
  admin: null,
};

const demoData = () => {
  const now = Date.now();
  const charges = [
    ['Mariana Alves','mariana@email.com','pix',12990,'approved',now-12*60_000],
    ['João Vitor','joao@email.com','card',8990,'approved',now-48*60_000],
    ['Nina Costa','nina@email.com','pix',24900,'action_required',now-2*3600_000],
    ['Carlos Lima','carlos@email.com','card',5990,'rejected',now-5*3600_000],
    ['Loja Estação','contato@estacao.com','pix',48000,'approved',now-26*3600_000],
    ['Ana Beatriz','ana@email.com','pix',7500,'refunded',now-50*3600_000],
  ].map((x,i)=>({id:`bff23c${i}0-704d-4b7b-8a0b-0b92e35f120${i}`,external_reference:`pedido-${1042+i}`,payer_name:x[0],payer_email:x[1],method:x[2],amount_cents:x[3],fee_cents:Math.round(x[3]*.0199)+49,net_amount_cents:x[3]-(Math.round(x[3]*.0199)+49),status:x[4],created_at:new Date(x[5]).toISOString()}));
  const approved = charges.filter(c=>c.status==='approved');
  return {
    user:{id:'demo-user',name:'Christian',email:'demo@spacepay.com',role:'admin'},
    merchant:{id:'demo-merchant',name:'Space Store',email:'demo@spacepay.com',slug:'space-store',status:'active',kyc_status:'approved',fee_bps:199,fixed_fee_cents:49,balance_available_cents:124890,balance_pending_cents:24900,balance_reserved_cents:0,created_at:new Date(now-120*86400_000).toISOString()},
    charges,
    metrics:{gross_volume_cents:approved.reduce((s,c)=>s+c.amount_cents,0),net_volume_cents:approved.reduce((s,c)=>s+c.net_amount_cents,0),fees_cents:approved.reduce((s,c)=>s+c.fee_cents,0),approved_count:approved.length,pending_count:1,approval_rate:73.4,refunds_cents:7500},
    links:[{id:'l1',slug:'consultoria-space-a1b2',title:'Consultoria premium',description:'Sessão individual de estratégia e configuração.',amount_cents:19990,active:true,created_at:new Date(now-4*86400_000).toISOString()},{id:'l2',slug:'plano-pro-c3d4',title:'Plano Pro',description:'Acesso mensal aos recursos avançados.',amount_cents:4990,active:true,created_at:new Date(now-2*86400_000).toISOString()}],
    customers:[{id:'c1',name:'Mariana Alves',email:'mariana@email.com',phone:'(11) 99999-0011',created_at:new Date(now-80*86400_000).toISOString()},{id:'c2',name:'João Vitor',email:'joao@email.com',phone:'(21) 98888-3322',created_at:new Date(now-42*86400_000).toISOString()}],
    withdrawals:[{id:'w1',pix_key_masked:'123********456',amount_cents:35000,status:'paid',created_at:new Date(now-7*86400_000).toISOString(),paid_at:new Date(now-6*86400_000).toISOString()}],
    apiKeys:[{id:'k1',name:'Chave de desenvolvimento',prefix:'sp_test_q7Mk8L',mode:'test',scopes:['charges:read','charges:write'],created_at:new Date(now-20*86400_000).toISOString()}],
    webhooks:[{id:'h1',url:'https://exemplo.com/webhooks/spacepay',description:'Produção',events:['charge.updated','refund.updated'],active:true,failure_count:0,created_at:new Date(now-14*86400_000).toISOString()}],
  };
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
}
function formatMoney(cents = 0) { return new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(cents)/100); }
function formatDate(value, compact=false) { if(!value)return '—'; return new Intl.DateTimeFormat('pt-BR',compact?{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}:{day:'2-digit',month:'short',year:'numeric'}).format(new Date(value)); }
function shortId(value) { const text=String(value||''); return text.length>13?`${text.slice(0,8)}…${text.slice(-4)}`:text; }
const statusName = status => ({approved:'Aprovada',pending:'Pendente',action_required:'Aguardando',rejected:'Recusada',failed:'Falhou',refunded:'Reembolsada',partially_refunded:'Parcial',created:'Criada',paid:'Pago',requested:'Solicitado',in_review:'Em análise',active:'Ativo',suspended:'Suspenso',blocked:'Bloqueado'}[status]||status||'—');
const statusBadge = status => `<span class="status ${escapeHtml(status)}">${escapeHtml(statusName(status))}</span>`;

function toast(message, type='success') {
  const el=document.createElement('div'); el.className=`toast ${type}`; el.innerHTML=`<b>${type==='error'?'!':'✓'}</b><span>${escapeHtml(message)}</span>`;
  $('#toast-region').append(el); setTimeout(()=>el.remove(),4500);
}
function setBusy(button,busy){if(!button)return;button.disabled=busy;if(busy){button.dataset.label=button.innerHTML;button.textContent='Processando…'}else if(button.dataset.label){button.innerHTML=button.dataset.label;delete button.dataset.label}}

async function api(route,{method='GET',body,headers={}}={}) {
  const [path,...query]=route.split('&');
  const response=await fetch(`/api?route=${encodeURIComponent(path)}${query.length?`&${query.join('&')}`:''}`,{method,credentials:'include',headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({error:{message:'Resposta inválida do servidor.'}}));
  if(!response.ok) throw new Error(data.error?.message||`Erro ${response.status}`);
  return data;
}

function showAuth(){state.demo=false;$('#auth-screen').classList.remove('hidden');$('#app-shell').classList.add('hidden')}
function showApp(){
  $('#auth-screen').classList.add('hidden');$('#app-shell').classList.remove('hidden');
  const name=state.user?.name||'Usuário'; $('#side-user-name').textContent=name;$('#side-user-email').textContent=state.user?.email||'';$('#welcome-name').textContent=name.split(' ')[0];$('#avatar').textContent=name.split(' ').slice(0,2).map(x=>x[0]).join('').toUpperCase();
  $('#admin-nav').classList.toggle('hidden',!['admin','support','analyst'].includes(state.user?.role));
  const sandbox=state.demo||state.config.provider==='sandbox';$('#environment-badge').innerHTML=`<i></i> ${sandbox?'SANDBOX':'PRODUÇÃO'}`;
  navigate(location.hash.replace('#','')||'overview');
}

function navigate(view){
  if(view==='docs'){view='developers'}
  if(!$(`#view-${view}`))view='overview';
  $$('.view').forEach(el=>el.classList.toggle('active',el.id===`view-${view}`));
  $$('.nav-item').forEach(el=>el.classList.toggle('active',el.dataset.view===view));
  const titles={overview:'Visão geral',transactions:'Transações',links:'Links de pagamento',balance:'Saldo e saques',customers:'Clientes',developers:'Desenvolvedores',settings:'Configurações',admin:'Administração'};
  $('#page-title').textContent=titles[view];$('#breadcrumb').textContent=`PAINEL / ${titles[view].toUpperCase()}`;location.hash=view;$('.sidebar').classList.remove('open');
  loadView(view).catch(error=>toast(error.message,'error'));
}

async function bootstrapSession(){
  const paymentMatch=location.hash.match(/^#pay\/([a-z0-9-]+)$/i);
  if(paymentMatch){await renderPublicCheckout(paymentMatch[1]);return}
  try{state.config=await api('public/config')}catch{}
  try{const session=await api('auth/me');state.user=session.user;state.merchant=session.merchant;showApp();await loadOverview()}catch{showAuth()}
}

async function renderPublicCheckout(slug){
  document.body.innerHTML=`<div id="toast-region" class="toast-region" aria-live="polite"></div><main class="checkout-screen"><section class="checkout-brand"><a class="brand brand-large" href="/"><span class="brand-mark">S</span><span>SPACE<span>PAY</span></span></a><div><span class="eyebrow">CHECKOUT PROTEGIDO</span><h1>Pagamento simples.<br><em>Confirmação rápida.</em></h1><p>Seus dados são enviados de forma segura. A Space Pay não armazena dados de cartão.</p></div><small>🔒 CONEXÃO SEGURA · PIX</small></section><section class="checkout-panel"><div id="checkout-content" class="checkout-card"><div class="checkout-loading">Carregando cobrança…</div></div></section></main>`;
  try{
    const result=await api(`public/payment-links/${slug}`),link=result.data;
    $('#checkout-content').innerHTML=`<header><span class="eyebrow">PAGAR PARA</span><strong>${escapeHtml(link.merchant_name)}</strong></header><div class="checkout-product"><div><h2>${escapeHtml(link.title)}</h2><p>${escapeHtml(link.description||'Pagamento via Space Pay.')}</p></div>${link.amount_cents?`<strong>${formatMoney(link.amount_cents)}</strong>`:''}</div><form id="public-checkout-form"><label>Nome completo<input name="name" required minlength="2" placeholder="Seu nome"></label><label>E-mail<input name="email" type="email" required placeholder="voce@email.com"></label>${link.amount_cents?'':`<label>Valor<input name="amount" required inputmode="decimal" placeholder="R$ 0,00"></label>`}<button class="btn primary wide" type="submit">Gerar PIX →</button></form><footer><span>◆ PIX processado com segurança</span><span>Pedido expira em 30 minutos</span></footer>`;
    $('#public-checkout-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button',e.currentTarget);setBusy(button,true);try{const paid=await api(`public/payment-links/${slug}/checkout`,{method:'POST',headers:{'X-Idempotency-Key':idempotency()},body:formObject(e.currentTarget)}),charge=paid.data;$('#checkout-content').innerHTML=`<div class="pix-success"><span class="success-icon">◆</span><span class="eyebrow">PIX GERADO</span><h2>${formatMoney(charge.amount_cents)}</h2><p>Copie o código abaixo e pague no aplicativo do seu banco.</p>${charge.pix_qr_base64?`<img src="data:image/png;base64,${escapeHtml(charge.pix_qr_base64)}" alt="QR Code PIX">`:''}<code id="public-pix-code">${escapeHtml(charge.pix_copy_paste||'')}</code><button id="copy-public-pix" class="btn primary wide">Copiar código PIX</button><small>A confirmação será atualizada automaticamente após o pagamento.</small></div>`;$('#copy-public-pix').addEventListener('click',()=>navigator.clipboard.writeText($('#public-pix-code').textContent).then(()=>toast('Código PIX copiado.')))}catch(error){toast(error.message,'error');setBusy(button,false)}})
  }catch(error){$('#checkout-content').innerHTML=`<div class="checkout-error"><b>!</b><h2>Link indisponível</h2><p>${escapeHtml(error.message)}</p><a class="btn secondary" href="/">Voltar</a></div>`}
}

async function loadOverview(){
  if(state.demo){renderOverview();return}
  const data=await api('dashboard');state.dashboard=data;state.merchant=data.merchant;state.charges=data.recent_charges||[];renderOverview();
}
function renderOverview(){
  const metrics=state.demo?state.dashboard.metrics:state.dashboard?.metrics||{};const merchant=state.merchant||{};
  $('#metric-volume').textContent=formatMoney(metrics.gross_volume_cents);$('#metric-approved').textContent=metrics.approved_count||0;$('#metric-balance').textContent=formatMoney(merchant.balance_available_cents);$('#metric-rate').textContent=`${metrics.approval_rate||0}%`;$('#metric-fees').textContent=formatMoney(metrics.fees_cents);$('#pending-count').textContent=metrics.pending_count||0;
  $('#balance-available').textContent=formatMoney(merchant.balance_available_cents);$('#balance-pending').textContent=formatMoney(merchant.balance_pending_cents);$('#balance-reserved').textContent=formatMoney(merchant.balance_reserved_cents);
  const rows=state.charges.slice(0,7);renderTransactionRows($('#recent-transactions'),rows,false);$('#recent-empty').classList.toggle('hidden',rows.length>0);
  const max=Math.max(...[12,28,19,44,35,67,54].map((x,i)=>x+(metrics.approved_count||0)*i));$('#volume-chart').innerHTML=[12,28,19,44,35,67,54].map((x,i)=>`<i class="bar" style="height:${Math.max(5,(x+(metrics.approved_count||0)*i)/max*94)}%" data-value="${formatMoney((x+(metrics.approved_count||0)*i)*1000)}"></i>`).join('');
  const pix=state.charges.filter(c=>c.method==='pix').length,card=state.charges.filter(c=>c.method==='card').length,total=pix+card;const pixPct=total?Math.round(pix/total*100):0;$('#method-total').textContent=total;$('#pix-share').textContent=`${pixPct}%`;$('#card-share').textContent=`${100-pixPct}%`;$('#method-donut').style.background=`conic-gradient(var(--green) 0 ${pixPct}%,var(--purple) ${pixPct}% 100%)`;
  renderMerchantDetails();
}

function renderTransactionRows(target,rows,actions=true){
  target.innerHTML=rows.map(c=>`<tr><td><div class="tx-id"><span class="tx-icon">${c.method==='pix'?'◆':'▰'}</span><span class="cell-main"><strong>${escapeHtml(c.external_reference||shortId(c.id))}</strong><small>${escapeHtml(shortId(c.id))}</small></span></div></td><td><span class="cell-main"><strong>${escapeHtml(c.payer_name||'Cliente')}</strong><small>${escapeHtml(c.payer_email||'')}</small></span></td><td>${c.method==='pix'?'PIX':'Cartão'}</td><td><strong>${formatMoney(c.amount_cents)}</strong>${actions?`<small style="display:block;color:#626d7a">${formatMoney(c.net_amount_cents)} líquido</small>`:''}</td>${actions?'':`<td>${statusBadge(c.status)}</td>`}<td>${actions?statusBadge(c.status):formatDate(c.created_at,true)}</td>${actions?`<td><button class="text-button" data-charge-action="${escapeHtml(c.id)}">Detalhes →</button></td>`:''}</tr>`).join('');
}

async function loadTransactions(){if(!state.demo){const q=new URLSearchParams();const s=$('#transaction-status').value,term=$('#transaction-search').value;if(s)q.set('status',s);if(term)q.set('search',term);const result=await api(`v1/charges&${q}`);state.charges=result.data||[]}renderTransactionRows($('#transactions-table'),state.charges,true)}
async function loadLinks(){if(!state.demo){const r=await api('v1/payment-links');state.links=r.data||[]}$('#links-grid').innerHTML=state.links.length?state.links.map(link=>`<article class="item-card"><header><span class="status ${link.active?'active':'rejected'}">${link.active?'Ativo':'Inativo'}</span><button class="icon-button">⋮</button></header><div><h3>${escapeHtml(link.title)}</h3><p>${escapeHtml(link.description||'Link de cobrança Space Pay.')}</p></div><footer><strong>${link.amount_cents?formatMoney(link.amount_cents):'Valor livre'}</strong><button data-copy="${escapeHtml(`${location.origin}/#pay/${link.slug}`)}">Copiar link</button></footer></article>`).join(''):'<div class="empty"><b>⌁</b><strong>Nenhum link criado</strong><span>Crie um checkout compartilhável.</span></div>'}
async function loadCustomers(){if(!state.demo){const r=await api('v1/customers');state.customers=r.data||[]}$('#customers-table').innerHTML=state.customers.map(c=>`<tr><td><strong>${escapeHtml(c.name)}</strong></td><td>${escapeHtml(c.email||'—')}</td><td>${escapeHtml(c.phone||'—')}</td><td>${formatDate(c.created_at)}</td></tr>`).join('')}
async function loadWithdrawals(){if(!state.demo){const r=await api('v1/withdrawals');state.withdrawals=r.data||[]}$('#withdrawals-table').innerHTML=state.withdrawals.map(w=>`<tr><td>${escapeHtml(shortId(w.id))}</td><td>${escapeHtml(w.pix_key_masked)}</td><td><strong>${formatMoney(w.amount_cents)}</strong></td><td>${statusBadge(w.status)}</td><td>${formatDate(w.created_at)}</td></tr>`).join('');renderOverview()}
async function loadDevelopers(){if(!state.demo){const [keys,hooks]=await Promise.all([api('v1/api-keys'),api('v1/webhook-endpoints')]);state.apiKeys=keys.data||[];state.webhooks=hooks.data||[]}$('#api-keys-list').innerHTML=state.apiKeys.length?state.apiKeys.map(k=>`<div class="stack-item"><i>{ }</i><span><strong>${escapeHtml(k.name)}</strong><small>${escapeHtml(k.prefix)}•••• · ${escapeHtml(k.mode)}</small></span><button data-revoke-key="${escapeHtml(k.id)}">Revogar</button></div>`).join(''):'<div class="empty"><strong>Nenhuma chave</strong><span>Gere uma chave para integrar.</span></div>';$('#webhooks-list').innerHTML=state.webhooks.length?state.webhooks.map(h=>`<div class="stack-item"><i>↗</i><span><strong>${escapeHtml(h.description||'Webhook')}</strong><small>${escapeHtml(h.url)} · ${h.failure_count||0} falhas</small></span>${statusBadge(h.active?'active':'rejected')}</div>`).join(''):'<div class="empty"><strong>Nenhum endpoint</strong><span>Receba eventos em tempo real.</span></div>'}
function renderMerchantDetails(){const m=state.merchant||{};$('#merchant-details').innerHTML=[['Nome',m.name],['E-mail',m.email],['Identificador',m.slug],['KYC',statusName(m.kyc_status)],['Status',statusName(m.status)],['Taxa',`${(Number(m.fee_bps||0)/100).toFixed(2)}% + ${formatMoney(m.fixed_fee_cents)}`]].map(([a,b])=>`<dt>${a}</dt><dd>${escapeHtml(b||'—')}</dd>`).join('');const live=!state.demo&&state.config.provider!=='sandbox';$('#provider-state').textContent=live?'Credenciais de produção configuradas':'Modo sandbox ativo';$('#provider-badge').className=`status ${live?'active':'pending'}`;$('#provider-badge').textContent=live?'ATIVO':'SANDBOX'}
async function loadAdmin(){if(state.demo){const d=state.dashboard;state.admin={metrics:{merchants:12,active_merchants:10,pending_kyc:2,volume_cents:d.metrics.gross_volume_cents*18,revenue_cents:d.metrics.fees_cents*18,pending_withdrawals:1},merchants:[state.merchant,{...state.merchant,id:'m2',name:'Loja Orion',email:'orion@email.com',kyc_status:'in_review',balance_available_cents:82300}],withdrawals:[{id:'aw1',merchant_id:'m2',pix_key_masked:'or***com',amount_cents:45000,status:'requested'}]}}else{const [overview,merchants]=await Promise.all([api('admin/overview'),api('admin/merchants')]);state.admin={...overview,merchants:merchants.data||[]}}
  const m=state.admin.metrics;$('#admin-metrics').innerHTML=[['Lojistas',m.merchants],['Ativos',m.active_merchants],['Volume 30 dias',formatMoney(m.volume_cents)],['Receita',formatMoney(m.revenue_cents)]].map(([a,b])=>`<article class="metric"><span>${a.toUpperCase()}</span><strong>${b}</strong></article>`).join('');$('#merchants-table').innerHTML=(state.admin.merchants||[]).map(x=>`<tr><td><strong>${escapeHtml(x.name)}</strong></td><td>${escapeHtml(x.email)}</td><td>${statusBadge(x.kyc_status)}</td><td>${statusBadge(x.status)}</td><td>${formatMoney(x.balance_available_cents)}</td><td>${formatDate(x.created_at)}</td></tr>`).join('');$('#admin-withdrawals').innerHTML=(state.admin.withdrawals||[]).map(w=>`<tr><td>${escapeHtml(shortId(w.merchant_id))}</td><td>${escapeHtml(w.pix_key_masked)}</td><td>${formatMoney(w.amount_cents)}</td><td>${statusBadge(w.status)}</td><td><button class="text-button" data-admin-approve="${escapeHtml(w.id)}">Aprovar</button></td></tr>`).join('')}

async function loadView(view){if(view==='overview')return loadOverview();if(view==='transactions')return loadTransactions();if(view==='links')return loadLinks();if(view==='balance')return loadWithdrawals();if(view==='customers')return loadCustomers();if(view==='developers')return loadDevelopers();if(view==='settings')return renderMerchantDetails();if(view==='admin')return loadAdmin()}

function formObject(form){return Object.fromEntries(new FormData(form).entries())}
function showSecret(title,value){$('#secret-title').textContent=title;$('#secret-value').textContent=value;$('#secret-dialog').showModal()}
function idempotency(){return `${Date.now()}-${crypto.randomUUID()}`}

$('#login-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type=submit]',e.currentTarget);setBusy(button,true);try{const result=await api('auth/login',{method:'POST',body:formObject(e.currentTarget)});state.user=result.user;state.merchant=result.merchant;showApp();await loadOverview();toast('Login realizado com sucesso.')}catch(error){toast(error.message,'error')}finally{setBusy(button,false)}});
$('#register-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type=submit]',e.currentTarget);setBusy(button,true);try{const result=await api('auth/register',{method:'POST',body:formObject(e.currentTarget)});state.user=result.user;state.merchant=result.merchant;showApp();await loadOverview();toast('Sua conta foi criada.')}catch(error){toast(error.message,'error')}finally{setBusy(button,false)}});
$('#demo-button').addEventListener('click',()=>{const d=demoData();state.demo=true;state.user=d.user;state.merchant=d.merchant;state.charges=d.charges;state.links=d.links;state.customers=d.customers;state.withdrawals=d.withdrawals;state.apiKeys=d.apiKeys;state.webhooks=d.webhooks;state.dashboard={merchant:d.merchant,metrics:d.metrics,recent_charges:d.charges};showApp();renderOverview();toast('Demonstração carregada. Nenhum dinheiro real será movimentado.')});
$('#logout-button').addEventListener('click',async()=>{if(!state.demo)await api('auth/logout',{method:'POST'}).catch(()=>{});showAuth()});
$$('[data-auth-tab]').forEach(button=>button.addEventListener('click',()=>{$$('[data-auth-tab]').forEach(b=>b.classList.toggle('active',b===button));$('#login-form').classList.toggle('hidden',button.dataset.authTab!=='login');$('#register-form').classList.toggle('hidden',button.dataset.authTab!=='register')}));
$$('.nav-item').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.view)));$$('[data-go]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.go)));$('#menu-button').addEventListener('click',()=>$('.sidebar').classList.toggle('open'));$('#refresh-button').addEventListener('click',()=>loadOverview().then(()=>toast('Dados atualizados.')));window.addEventListener('hashchange',()=>{if(!$('#app-shell').classList.contains('hidden'))navigate(location.hash.slice(1))});
$$('[data-open-charge]').forEach(button=>button.addEventListener('click',()=>$('#charge-dialog').showModal()));$$('[data-dialog]').forEach(button=>button.addEventListener('click',()=>document.getElementById(button.dataset.dialog).showModal()));$$('.dialog-close').forEach(button=>button.addEventListener('click',()=>button.closest('dialog').close()));

$('#charge-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type=submit]',e.currentTarget),v=formObject(e.currentTarget);setBusy(button,true);try{let charge;if(state.demo){charge={id:crypto.randomUUID(),external_reference:`pedido-${Date.now()}`,payer_name:v.payer_name,payer_email:v.payer_email,method:v.method,status:'action_required',amount_cents:Math.round(Number(v.amount.replace(',','.'))*100),fee_cents:99,net_amount_cents:Math.round(Number(v.amount.replace(',','.'))*100)-99,created_at:new Date().toISOString(),pix_copy_paste:`000201SPACEPAYDEMO${Date.now()}`};state.charges.unshift(charge);state.dashboard.recent_charges=state.charges;state.dashboard.metrics.pending_count++;}else{const result=await api('v1/charges',{method:'POST',headers:{'X-Idempotency-Key':idempotency()},body:{amount:v.amount,method:v.method,payer:{name:v.payer_name,email:v.payer_email},description:v.description}});charge=result.data}e.currentTarget.closest('dialog').close();e.currentTarget.reset();renderOverview();toast('Cobrança criada.');if(charge.pix_copy_paste)showSecret('PIX copia e cola',charge.pix_copy_paste)}catch(error){toast(error.message,'error')}finally{setBusy(button,false)}});

$('#link-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type=submit]',e.currentTarget),v=formObject(e.currentTarget);setBusy(button,true);try{const link=state.demo?{id:crypto.randomUUID(),slug:`${v.title.toLowerCase().replace(/\W+/g,'-')}-${Date.now().toString(36)}`,title:v.title,description:v.description,amount_cents:v.amount?Math.round(Number(v.amount.replace(',','.'))*100):null,active:true,created_at:new Date().toISOString()}:(await api('v1/payment-links',{method:'POST',body:v})).data;state.links.unshift(link);e.currentTarget.closest('dialog').close();e.currentTarget.reset();await loadLinks();toast('Link criado.')}catch(error){toast(error.message,'error')}finally{setBusy(button,false)}});
$('#customer-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type=submit]',e.currentTarget),v=formObject(e.currentTarget);setBusy(button,true);try{const customer=state.demo?{id:crypto.randomUUID(),...v,created_at:new Date().toISOString()}:(await api('v1/customers',{method:'POST',body:v})).data;state.customers.unshift(customer);e.currentTarget.closest('dialog').close();e.currentTarget.reset();await loadCustomers();toast('Cliente cadastrado.')}catch(error){toast(error.message,'error')}finally{setBusy(button,false)}});
$('#withdrawal-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type=submit]',e.currentTarget),v=formObject(e.currentTarget);setBusy(button,true);try{const withdrawal=state.demo?{id:crypto.randomUUID(),amount_cents:Math.round(Number(v.amount.replace(',','.'))*100),pix_key_masked:`${v.pix_key.slice(0,3)}••••${v.pix_key.slice(-3)}`,status:'paid',created_at:new Date().toISOString()}:(await api('v1/withdrawals',{method:'POST',body:v})).data;state.withdrawals.unshift(withdrawal);e.currentTarget.closest('dialog').close();e.currentTarget.reset();await loadWithdrawals();toast('Solicitação de saque criada.')}catch(error){toast(error.message,'error')}finally{setBusy(button,false)}});
$('#key-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type=submit]',e.currentTarget),v=formObject(e.currentTarget);setBusy(button,true);try{let item;if(state.demo){const secret=`sp_${v.mode}_${crypto.randomUUID().replaceAll('-','')}`;item={id:crypto.randomUUID(),name:v.name,prefix:secret.slice(0,16),mode:v.mode,scopes:['charges:read','charges:write'],created_at:new Date().toISOString(),secret}}else item=(await api('v1/api-keys',{method:'POST',body:v})).data;state.apiKeys.unshift(item);e.currentTarget.closest('dialog').close();await loadDevelopers();showSecret('Chave de API',item.secret);toast('Chave criada.')}catch(error){toast(error.message,'error')}finally{setBusy(button,false)}});
$('#webhook-form').addEventListener('submit',async e=>{e.preventDefault();const button=$('button[type=submit]',e.currentTarget),v=formObject(e.currentTarget);setBusy(button,true);try{let item;if(state.demo){const secret=`whsec_${crypto.randomUUID().replaceAll('-','')}`;item={id:crypto.randomUUID(),url:v.url,description:v.description,events:['charge.updated','refund.updated'],active:true,failure_count:0,created_at:new Date().toISOString(),secret}}else item=(await api('v1/webhook-endpoints',{method:'POST',body:v})).data;state.webhooks.unshift(item);e.currentTarget.closest('dialog').close();await loadDevelopers();showSecret('Segredo do webhook',item.secret);toast('Endpoint adicionado.')}catch(error){toast(error.message,'error')}finally{setBusy(button,false)}});

document.addEventListener('click',async e=>{const copy=e.target.closest('[data-copy]');if(copy){await navigator.clipboard.writeText(copy.dataset.copy);toast('Copiado para a área de transferência.')}const revoke=e.target.closest('[data-revoke-key]');if(revoke){if(state.demo)state.apiKeys=state.apiKeys.filter(k=>k.id!==revoke.dataset.revokeKey);else await api(`v1/api-keys/${revoke.dataset.revokeKey}/revoke`,{method:'POST'});await loadDevelopers();toast('Chave revogada.')}const approve=e.target.closest('[data-admin-approve]');if(approve){if(state.demo){state.admin.withdrawals=state.admin.withdrawals.filter(w=>w.id!==approve.dataset.adminApprove)}else await api(`admin/withdrawals/${approve.dataset.adminApprove}/approve`,{method:'POST',body:{}});await loadAdmin();toast('Saque aprovado.')}const action=e.target.closest('[data-charge-action]');if(action){const charge=state.charges.find(c=>c.id===action.dataset.chargeAction);if(charge?.pix_copy_paste)showSecret('PIX copia e cola',charge.pix_copy_paste);else toast(`Transação ${shortId(action.dataset.chargeAction)}: ${statusName(charge?.status)}`)}});
$('#copy-code').addEventListener('click',()=>navigator.clipboard.writeText($('#quick-code').textContent).then(()=>toast('Exemplo copiado.')));$('#copy-secret').addEventListener('click',()=>navigator.clipboard.writeText($('#secret-value').textContent).then(()=>toast('Segredo copiado.')));
let searchTimer;$('#transaction-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadTransactions().catch(error=>toast(error.message,'error')),350)});$('#transaction-status').addEventListener('change',()=>loadTransactions().catch(error=>toast(error.message,'error')));

bootstrapSession();
