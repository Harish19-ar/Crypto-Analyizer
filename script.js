const API = "https://api.coingecko.com/api/v3";
const state = {
  coins: [], trending: [], favorites: JSON.parse(localStorage.getItem("cryptoFavorites") || "[]"),
  currency: "usd", currencySymbol: "$", exchangeRate: 1, activeSection: "market", selected: null,
  theme: localStorage.getItem("cryptoTheme") || "dark"
};
const $ = (id) => document.getElementById(id);
const fmt = (n, decimals = 2) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  return new Intl.NumberFormat("en-US", {maximumFractionDigits: decimals}).format(n);
};
const compact = (n) => {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return "—";
  const abs = Math.abs(n);
  if (abs >= 1e12) return "$" + (n/1e12).toFixed(2) + "T";
  if (abs >= 1e9) return "$" + (n/1e9).toFixed(2) + "B";
  if (abs >= 1e6) return "$" + (n/1e6).toFixed(2) + "M";
  if (abs >= 1e3) return "$" + (n/1e3).toFixed(1) + "K";
  return "$" + fmt(n);
};
const price = (n) => {
  if (n == null) return "—";
  const x = Number(n);
  const decimals = x >= 1000 ? 2 : x >= 1 ? 2 : x >= .01 ? 4 : 7;
  return state.currencySymbol + fmt(x * state.exchangeRate, decimals);
};
const money = (n) => {
  if (n == null) return "—";
  const x = Number(n) * state.exchangeRate;
  if (state.currency === "inr") {
    const abs = Math.abs(x);
    if(abs >= 1e12) return "₹" + (x/1e12).toFixed(2) + "T";
    if(abs >= 1e9) return "₹" + (x/1e9).toFixed(2) + "B";
    if(abs >= 1e6) return "₹" + (x/1e6).toFixed(2) + "M";
    return "₹" + fmt(x, 0);
  }
  return compact(x);
};
const changeEl = (v) => `<span class="${v >= 0 ? "positive" : "negative"}">${v >= 0 ? "+" : ""}${fmt(v,2)}%</span>`;
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}
async function loadData() {
  try {
    const [coins, global, trending] = await Promise.all([
      getJSON(`${API}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=50&page=1&sparkline=true&price_change_percentage=7d`),
      getJSON(`${API}/global`),
      getJSON(`${API}/search/trending`)
    ]);
    state.coins = coins;
    state.trending = trending.coins || [];
    const total = global.data.total_market_cap.usd;
    const volume = global.data.total_volume.usd;
    const btc = global.data.market_cap_percentage.btc;
    $("marketCap").textContent = money(total);
    $("volume").textContent = money(volume);
    $("btcDominance").textContent = fmt(btc, 1) + "%";
    $("activeCoins").textContent = fmt(global.data.active_cryptocurrencies, 0);
    const mcChange = global.data.market_cap_change_percentage_24h_usd;
    $("marketCapChange").innerHTML = `${changeEl(mcChange)} vs yesterday`;
    $("lastUpdated").textContent = "Updated " + new Date().toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"});
    renderTrending();
    renderTable();
    updateWatchCount();
    if (state.selected) openDetail(state.selected.id, false);
  } catch (err) {
    console.error(err);
    $("coinTable").innerHTML = `<tr><td colspan="9" class="loading-row">Unable to load live data. Check your internet connection and try again.</td></tr>`;
    $("trendingList").innerHTML = `<div style="padding:20px;color:var(--muted);font-size:11px;grid-column:1/-1">Live market data is temporarily unavailable.</div>`;
    showToast("Could not refresh market data");
  }
}
function renderTrending() {
  const list = state.trending.slice(0, 4);
  if (!list.length) return;
  $("trendingList").innerHTML = list.map(item => {
    const c = item.item;
    const market = state.coins.find(x => x.id === c.id);
    const ch = market?.price_change_percentage_24h ?? 0;
    return `<div class="trend-card">
      <div class="coin-logo"><img src="${esc(c.small || c.thumb)}" alt=""></div>
      <div><div class="trend-name">${esc(c.name)}</div><div class="trend-symbol">${esc(c.symbol)}</div></div>
      <div class="trend-price">${market ? price(market.current_price) : "Trending"}<small>${market ? changeEl(ch) : "Rank #"+(c.market_cap_rank || "—")}</small></div>
    </div>`;
  }).join("");
}
function getVisibleCoins() {
  let data = [...state.coins];
  const q = $("searchInput").value.trim().toLowerCase();
  if (state.activeSection === "watchlist") data = data.filter(c => state.favorites.includes(c.id));
  if (state.activeSection === "trending") {
    const ids = state.trending.map(x => x.item.id);
    data = data.filter(c => ids.includes(c.id));
  }
  if (q) data = data.filter(c => c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q));
  const sort = $("sortSelect").value;
  data.sort((a,b) => {
    if(sort==="price_desc") return b.current_price-a.current_price;
    if(sort==="price_asc") return a.current_price-b.current_price;
    if(sort==="change_desc") return (b.price_change_percentage_24h ?? -Infinity)-(a.price_change_percentage_24h ?? -Infinity);
    if(sort==="change_asc") return (a.price_change_percentage_24h ?? Infinity)-(b.price_change_percentage_24h ?? Infinity);
    return (b.market_cap ?? 0)-(a.market_cap ?? 0);
  });
  return data;
}
function sparklineSVG(values) {
  if (!values || values.length < 2) return "";
  const clean = values.slice(-30);
  const min = Math.min(...clean), max = Math.max(...clean), range = max-min || 1;
  const pts = clean.map((v,i) => `${(i/(clean.length-1))*80},${26-((v-min)/range)*22}`).join(" ");
  const up = clean[clean.length-1] >= clean[0];
  return `<svg class="mini-chart" viewBox="0 0 80 28" preserveAspectRatio="none"><polyline fill="none" stroke="${up ? "var(--green)" : "var(--red)"}" stroke-width="2" points="${pts}"/></svg>`;
}
function renderTable() {
  const data = getVisibleCoins();
  $("resultCount").textContent = `${data.length} assets`;
  $("tableTitle").textContent = state.activeSection === "watchlist" ? "Your Watchlist" : state.activeSection === "trending" ? "Trending Assets" : "Cryptocurrency Market";
  if (!data.length) {
    $("coinTable").innerHTML = `<tr><td colspan="9" class="loading-row">No assets found.</td></tr>`;
    return;
  }
  $("coinTable").innerHTML = data.map((c,i) => {
    const saved = state.favorites.includes(c.id);
    return `<tr data-id="${esc(c.id)}">
      <td class="rank">${c.market_cap_rank || i+1}</td>
      <td><div class="asset"><div class="coin-logo"><img src="${esc(c.image)}" alt=""></div><div><span class="asset-name">${esc(c.name)}</span><span class="asset-symbol">${esc(c.symbol)}</span></div></div></td>
      <td class="price">${price(c.current_price)}</td>
      <td>${changeEl(c.price_change_percentage_24h ?? 0)}</td>
      <td>${changeEl(c.price_change_percentage_7d_in_currency ?? 0)}</td>
      <td>${money(c.market_cap)}</td>
      <td>${money(c.total_volume)}</td>
      <td>${sparklineSVG(c.sparkline_in_7d?.price)}</td>
      <td><button class="star ${saved ? "saved" : ""}" data-favorite="${esc(c.id)}" title="${saved ? "Remove from watchlist" : "Add to watchlist"}">${saved ? "★" : "☆"}</button></td>
    </tr>`;
  }).join("");
  document.querySelectorAll("#coinTable tr[data-id]").forEach(row => {
    row.addEventListener("click", e => {
      if (e.target.closest("[data-favorite]")) return;
      openDetail(row.dataset.id);
    });
  });
  document.querySelectorAll("[data-favorite]").forEach(btn => btn.addEventListener("click", e => {
    e.stopPropagation(); toggleFavorite(btn.dataset.favorite);
  }));
}
function toggleFavorite(id) {
  if (state.favorites.includes(id)) state.favorites = state.favorites.filter(x => x !== id);
  else state.favorites.push(id);
  localStorage.setItem("cryptoFavorites", JSON.stringify(state.favorites));
  updateWatchCount(); renderTable();
  showToast(state.favorites.includes(id) ? "Added to watchlist" : "Removed from watchlist");
}
function updateWatchCount() { $("watchCount").textContent = state.favorites.length; }
function openDetail(id, scroll=true) {
  const coin = state.coins.find(c => c.id === id);
  if (!coin) return;
  state.selected = coin;
  $("detailCard").classList.remove("hidden");
  $("detailIdentity").innerHTML = `<div class="detail-identity"><div class="coin-logo" style="width:42px;height:42px"><img src="${esc(coin.image)}" alt=""></div><div><h3>${esc(coin.name)}</h3><p>${esc(coin.symbol.toUpperCase())} · Rank #${coin.market_cap_rank || "—"}</p></div></div>`;
  $("detailPrice").textContent = price(coin.current_price);
  $("detailChange").innerHTML = changeEl(coin.price_change_percentage_24h ?? 0);
  $("detailMetrics").innerHTML = [
    ["Market Cap", money(coin.market_cap)],["24h Volume",money(coin.total_volume)],
    ["24h High",price(coin.high_24h)],["24h Low",price(coin.low_24h)]
  ].map(x=>`<div class="metric"><span>${x[0]}</span><strong>${x[1]}</strong></div>`).join("");
  drawChart(coin.sparkline_in_7d?.price || []);
  if(scroll) $("detailCard").scrollIntoView({behavior:"smooth",block:"center"});
}
function drawChart(values) {
  const canvas = $("priceChart"), rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width*dpr; canvas.height = 220*dpr;
  const ctx = canvas.getContext("2d"); ctx.scale(dpr,dpr);
  const w=rect.width,h=220,pad=10; if(!values.length) return;
  const vals=values.slice(-168), min=Math.min(...vals), max=Math.max(...vals), range=max-min||1;
  const pts=vals.map((v,i)=>[pad+(i/(vals.length-1))*(w-pad*2),h-pad-((v-min)/range)*(h-pad*2)]);
  ctx.beginPath(); pts.forEach((p,i)=>i?ctx.lineTo(p[0],p[1]):ctx.moveTo(p[0],p[1]));
  ctx.lineWidth=2; ctx.strokeStyle=getComputedStyle(document.body).getPropertyValue("--accent"); ctx.stroke();
  ctx.lineTo(pts[pts.length-1][0],h);ctx.lineTo(pts[0][0],h);ctx.closePath();
  const grad=ctx.createLinearGradient(0,0,0,h); grad.addColorStop(0,"rgba(139,124,255,.20)");grad.addColorStop(1,"rgba(139,124,255,0)");
  ctx.fillStyle=grad;ctx.fill();
}
function setCurrency(currency) {
  state.currency = currency; state.currencySymbol = currency === "inr" ? "₹" : "$";
  state.exchangeRate = currency === "inr" ? 83.5 : 1;
  document.querySelectorAll(".currency").forEach(b=>b.classList.toggle("active",b.dataset.currency===currency));
  renderTrending(); renderTable();
  if(state.selected) openDetail(state.selected.id,false);
  showToast(`Currency switched to ${currency.toUpperCase()}`);
}
function setSection(section) {
  state.activeSection=section;
  document.querySelectorAll(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.section===section));
  const title={market:"Crypto Market",watchlist:"Watchlist",trending:"Trending"}[section];
  $("pageTitle").textContent=title;
  $("marketSection").scrollIntoView({behavior:"smooth",block:"start"});
  renderTable();
  $("sidebar").classList.remove("open");$("overlay").classList.remove("show");
}
function showToast(message) {
  const t=$("toast");t.textContent=message;t.classList.add("show");clearTimeout(window.toastTimer);
  window.toastTimer=setTimeout(()=>t.classList.remove("show"),2200);
}
document.querySelectorAll(".nav-item").forEach(b=>b.addEventListener("click",()=>setSection(b.dataset.section)));
document.querySelectorAll(".currency").forEach(b=>b.addEventListener("click",()=>setCurrency(b.dataset.currency)));
$("searchInput").addEventListener("input",renderTable);
$("sortSelect").addEventListener("change",renderTable);
$("refreshBtn").addEventListener("click",()=>{ $("refreshBtn").classList.add("spin");loadData().finally(()=>setTimeout(()=>$("refreshBtn").classList.remove("spin"),400)); });
$("viewTrending").addEventListener("click",()=>setSection("trending"));
$("closeDetail").addEventListener("click",()=>{$("detailCard").classList.add("hidden");state.selected=null});
$("menuBtn").addEventListener("click",()=>{$("sidebar").classList.add("open");$("overlay").classList.add("show")});
$("overlay").addEventListener("click",()=>{$("sidebar").classList.remove("open");$("overlay").classList.remove("show")});
$("themeBtn").addEventListener("click",()=>{
  state.theme=state.theme==="dark"?"light":"dark";document.body.classList.toggle("light",state.theme==="light");
  localStorage.setItem("cryptoTheme",state.theme); if(state.selected) drawChart(state.selected.sparkline_in_7d?.price||[]);
});
if(state.theme==="light") document.body.classList.add("light");
window.addEventListener("resize",()=>{if(state.selected) drawChart(state.selected.sparkline_in_7d?.price||[])});
loadData();
setInterval(loadData, 60000);
