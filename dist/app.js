const snapshot = window.PTAH_SNAPSHOT;
const marketSnapshot = window.PTAH_MARKET;
const costSnapshot = window.PTAH_COSTS;
const tradeSnapshot = window.PTAH_TRADES;
const assets = {
  relic: { ...snapshot.assets.relic, ...marketSnapshot.assets.relic },
  loom: { ...snapshot.assets.loom, ...marketSnapshot.assets.loom },
};
const costMaps = Object.fromEntries(
  Object.entries(costSnapshot.assets).map(([key, rows]) => [
    key,
    new Map(rows.map((row) => [row.address.toLowerCase(), row])),
  ]),
);

let asset = 'relic';
let page = 1;
let range = 10;
let filter = '';
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function fmtAddress(address) {
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}

function fmtMoney(value, digits = 2) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function holders() {
  const current = assets[asset];
  const costs = costMaps[asset];
  return current.top100.map((row, index) => ({
    ...row,
    rank: index + 1,
    share: (row.count / current.maxSupply) * 100,
    cost: costs.get(row.address.toLowerCase()),
  }));
}

function updateSummary() {
  const current = assets[asset];
  const list = holders();
  const cuts = [1, 10, 50, 100];
  const concentrations = cuts.map((count) => (
    list.slice(0, count).reduce((sum, holder) => sum + holder.count, 0) / current.maxSupply
  ) * 100);
  const top10 = concentrations[1];
  const coverage = current.demandCoverage * 100;

  $('#networkText').textContent = `BNB Chain · 持仓区块 ${snapshot.block.toLocaleString()}`;
  $('#holderCount').textContent = current.holders.toLocaleString();
  $('#supply').textContent = current.maxSupply.toLocaleString();
  $('#supplyNote').textContent = asset === 'relic'
    ? `当前存量 ${current.circulating.toLocaleString()} · 累计铸造 ${current.minted.toLocaleString()}`
    : `当前存量 ${current.circulating.toLocaleString()} · 10 Relics / Loom`;
  $('#bestBid').innerHTML = `${current.bestBid.toFixed(2)} <em>USDT</em>`;
  $('#marketCapNote').textContent = `当前存量市值 ${fmtMoney(current.marketCap)} USDT`;
  $('#depthTotal').innerHTML = `${fmtMoney(current.escrow)} <em>USDT</em>`;
  $('#depthNote').textContent = `${current.openOrders} 笔 · 总托管 ${fmtMoney(current.escrow)} USDT`;
  $('#sellSupply').textContent = current.potentialSellSupply.toLocaleString();
  $('#sellSupplyNote').textContent = `-20% 买盘承接 ${current.actionableQuantity.toLocaleString()} · 覆盖 ${coverage.toFixed(2)}%`;
  $('#top10').textContent = `${top10.toFixed(2)}%`;
  $('#ring').style.background = `conic-gradient(var(--gold) 0 ${top10}%,#24251f ${top10}% 100%)`;
  $('#ring strong').textContent = `${top10.toFixed(2)}%`;
  ['band1', 'band10', 'band50', 'band100'].forEach((id, index) => {
    $(`#${id}`).textContent = `${concentrations[index].toFixed(2)}%`;
    $$('.bands i')[index].style.width = `${Math.min(100, concentrations[index] / (asset === 'relic' ? 40 : 15) * 100)}%`;
  });
  $('#depthBest').textContent = `${current.bestBid.toFixed(2)} USDT`;
  $('#marketCap').textContent = `${fmtMoney(current.marketCap)} / ${fmtMoney(current.fdv)} USDT`;
  $('#costLine').textContent = `${current.costLine.toFixed(2)} / ${current.breakEven.toFixed(2)} USDT`;
  const marketTime = new Date(marketSnapshot.indexedAt);
  $('#marketSnapshot').textContent = `挂单快照 ${marketTime.toLocaleString('zh-CN', { hour12: false })}`;
}

function renderHolders() {
  const all = holders().filter((holder) => holder.address.includes(filter.toLowerCase()));
  const pages = Math.max(1, Math.ceil(all.length / 10));
  page = Math.min(page, pages);
  const rows = all.slice((page - 1) * 10, page * 10);
  $('#holderRows').innerHTML = rows.map((holder) => {
    const cost = holder.cost;
    const average = cost?.averageCost;
    const costText = average === null || average === undefined ? '—' : `${average.toFixed(2)} USDT`;
    const totalTitle = average === null || average === undefined
      ? '当前持仓未匹配到 Ptah Market 买入成交'
      : `已核验总买入成本 ${cost.totalCost.toFixed(2)} USDT；含 1% 卖方费回本价 ${cost.breakEven.toFixed(2)} USDT`;
    const coverageText = cost ? `${cost.knownQty}/${holder.count}` : `0/${holder.count}`;
    return `<tr>
      <td>${String(holder.rank).padStart(2, '0')}</td>
      <td class="wallet"><a href="https://bscscan.com/address/${holder.address}" target="_blank" rel="noopener" title="${holder.address}">${fmtAddress(holder.address)} ↗</a></td>
      <td class="amount">${holder.count.toLocaleString()}</td>
      <td><span class="share-bar"><i style="width:${Math.min(100, holder.share * (asset === 'relic' ? 2.5 : 7))}%"></i></span>${holder.share.toFixed(2)}%</td>
      <td class="amount" title="${totalTitle}">${costText}</td>
      <td class="change ${cost?.knownQty ? 'up' : ''}" title="其余持仓来自铸造、转入或缺少公开成交价">${coverageText} 可核验</td>
    </tr>`;
  }).join('') || '<tr><td colspan="6">没有匹配地址</td></tr>';
  $('#pageLabel').textContent = `${page} / ${pages}`;
  $('#tableInfo').textContent = `显示 ${all.length ? (page - 1) * 10 + 1 : 0}–${Math.min(page * 10, all.length)} / ${all.length}`;
}

function visibleLevels() {
  const current = assets[asset];
  const floor = current.bestBid * (1 - range / 100);
  return current.levels.filter((level) => level.price >= floor);
}

function renderChart() {
  const levels = visibleLevels();
  const current = assets[asset];
  let cumulative = 0;
  const data = levels.map((level) => {
    cumulative += level.quantity;
    return { ...level, cumulative };
  });
  const totalEscrow = data.reduce((sum, level) => sum + level.escrow, 0);
  const totalQuantity = data.reduce((sum, level) => sum + level.quantity, 0);
  let medianPrice = 0;
  let medianRunning = 0;
  for (const level of data) {
    medianRunning += level.quantity;
    if (medianRunning >= totalQuantity / 2) {
      medianPrice = level.price;
      break;
    }
  }
  const weightedPrice = totalQuantity ? totalEscrow / totalQuantity : 0;
  const max = Math.max(1, cumulative);
  const chartData = data.length > 12
    ? data.filter((_, index) => index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 12) === 0)
    : data;
  const x = (index) => chartData.length === 1 ? 365 : 55 + index * (620 / (chartData.length - 1));
  const y = (value) => 250 - value / max * 190;
  const points = chartData.map((level, index) => `${x(index)},${y(level.cumulative)}`);

  $('.chart-label').textContent = `最佳价下方 ${range}% · ${fmtMoney(totalEscrow)} USDT · ${cumulative.toLocaleString()} NFT`;
  $('#medianBid').textContent = `${medianPrice.toFixed(2)} USDT`;
  $('#weightedAvg').textContent = `${weightedPrice.toFixed(2)} USDT`;
  $('#linePath').setAttribute('d', points.length ? `M ${points.join(' L ')}` : '');
  $('#areaPath').setAttribute('d', points.length ? `M ${x(0)},250 L ${points.join(' L ')} L ${x(chartData.length - 1)},250 Z` : '');
  $('#gridLines').innerHTML = [0, 1, 2, 3, 4].map((index) => `<line x1="55" x2="675" y1="${60 + index * 47.5}" y2="${60 + index * 47.5}" stroke="#262721"/><text x="18" y="${64 + index * 47.5}" fill="#595a53" font-size="9">${Math.round(max * (4 - index) / 4)}</text>`).join('');
  $('#axisLabels').innerHTML = chartData.map((level, index) => `<text x="${x(index)}" y="277" text-anchor="middle" fill="#64645d" font-size="9">${level.price.toFixed(asset === 'loom' ? 0 : 2)}</text>`).join('') + '<text x="365" y="297" text-anchor="middle" fill="#66665f" font-size="9">挂单价 (USDT)</text>';
  $('#chartDots').innerHTML = chartData.map((level, index) => `<circle data-i="${index}" cx="${x(index)}" cy="${y(level.cumulative)}" r="8" fill="transparent" stroke="transparent" tabindex="0"/>`).join('');
  $('#orderRows').innerHTML = data.slice(0, 8).map((level) => `<div class="order-row"><span>${level.price.toFixed(2)}</span><span>${level.quantity}</span><span>${level.cumulative}</span><span class="depth-bg" style="width:${level.cumulative / max * 100}%"></span><span>${level.escrow.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDT</span></div>`).join('');
  $$('#chartDots circle').forEach((dot) => {
    const show = () => {
      const level = chartData[Number(dot.dataset.i)];
      const box = $('.chart-wrap').getBoundingClientRect();
      const tip = $('#tooltip');
      tip.style.display = 'block';
      tip.style.left = `${Math.min(box.width - 120, Number(dot.getAttribute('cx')) / 720 * box.width)}px`;
      tip.style.top = `${Number(dot.getAttribute('cy')) / 300 * box.height - 55}px`;
      tip.innerHTML = `<span>挂单价</span><strong>${level.price.toFixed(2)} USDT</strong><small>${level.orders} 笔 · 累计 ${level.cumulative} NFT</small>`;
    };
    dot.addEventListener('mouseenter', show);
    dot.addEventListener('focus', show);
    dot.addEventListener('mouseleave', () => { $('#tooltip').style.display = 'none'; });
    dot.addEventListener('blur', () => { $('#tooltip').style.display = 'none'; });
  });
}

function renderTrades() {
  const current = assets[asset];
  const trade = tradeSnapshot.assets[asset];
  const sample = trade.sample;
  const recent = trade.recent100;
  const averageChange = sample.average ? (recent.average / sample.average - 1) * 100 : 0;
  const bidDeviation = recent.average ? (current.bestBid / recent.average - 1) * 100 : 0;
  $('#tradeAvg100').textContent = `${recent.average.toFixed(2)} USDT`;
  $('#tradeAvgChange').textContent = `${averageChange >= 0 ? '+' : ''}${averageChange.toFixed(2)}% 相对样本均价`;
  $('#tradeAvgChange').className = averageChange >= 0 ? 'positive' : 'negative';
  $('#tradeAvgSample').textContent = `${sample.average.toFixed(2)} USDT`;
  const start = new Date(trade.sampleStart);
  const end = new Date(trade.sampleEnd);
  $('#tradeSampleRange').textContent = `${start.toLocaleString('zh-CN', { hour12: false })} — ${end.toLocaleTimeString('zh-CN', { hour12: false })}`;
  $('#tradeMedian').textContent = `${sample.median.toFixed(2)} USDT`;
  $('#tradeRange').textContent = `低 ${sample.low.toFixed(2)} · 高 ${sample.high.toFixed(2)}`;
  $('#bidDeviation').textContent = `${bidDeviation >= 0 ? '+' : ''}${bidDeviation.toFixed(2)}%`;
  $('#bidDeviation').className = bidDeviation >= 0 ? 'positive' : 'negative';
  $('#tradeSample').textContent = `最近 ${sample.count.toLocaleString()} 笔实际成交`;
  $('#tradeSnapshot').textContent = `交易历史快照 ${new Date(tradeSnapshot.generatedAt).toLocaleString('zh-CN', { hour12: false })}`;

  const series = trade.series.filter((point) => point.average !== null);
  const values = series.map((point) => point.average);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const x = (index) => series.length === 1 ? 450 : 55 + index * (790 / (series.length - 1));
  const y = (value) => 195 - (value - min) / span * 135;
  const points = series.map((point, index) => `${x(index)},${y(point.average)}`);
  $('#historyLine').setAttribute('d', points.length ? `M ${points.join(' L ')}` : '');
  $('#historyArea').setAttribute('d', points.length ? `M ${x(0)},205 L ${points.join(' L ')} L ${x(series.length - 1)},205 Z` : '');
  $('#historyGrid').innerHTML = [0, 1, 2, 3].map((index) => {
    const value = max - index * span / 3;
    return `<line x1="55" x2="845" y1="${60 + index * 45}" y2="${60 + index * 45}" stroke="#262721"/><text x="12" y="${64 + index * 45}" fill="#65645d" font-size="10">${value.toFixed(1)}</text>`;
  }).join('');
  $('#historyDots').innerHTML = series.map((point, index) => `<circle cx="${x(index)}" cy="${y(point.average)}" r="3.5" fill="#d7bd77"><title>${point.count} 笔 · ${point.average.toFixed(2)} USDT</title></circle>`).join('');
  $('#historyAxis').innerHTML = series.map((point, index) => `<text x="${x(index)}" y="229" text-anchor="middle" fill="#65645d" font-size="9">${new Date(point.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })}</text>`).join('');

  $('#tradeRows').innerHTML = trade.recent.slice(0, 6).map((row) => `<a class="trade-row" href="https://bscscan.com/tx/${row.tx}" target="_blank" rel="noopener"><span><b>#${row.tokenId}</b><small>Bid #${row.bidId}</small></span><strong>${row.price.toFixed(2)} USDT</strong><time>${new Date(row.filledAt).toLocaleTimeString('zh-CN', { hour12: false })}</time></a>`).join('');
}

function render() {
  updateSummary();
  renderHolders();
  renderChart();
  renderTrades();
}

function tick() {
  $('#clock').textContent = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} CST`;
}

$$('[data-asset]').forEach((button) => {
  button.onclick = () => {
    $$('[data-asset]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    asset = button.dataset.asset;
    page = 1;
    render();
  };
});
$$('[data-range]').forEach((button) => {
  button.onclick = () => {
    $$('[data-range]').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    range = Number(button.dataset.range);
    renderChart();
  };
});
$('#holderSearch').oninput = (event) => {
  filter = event.target.value.trim();
  page = 1;
  renderHolders();
};
$('#prevPage').onclick = () => { if (page > 1) { page -= 1; renderHolders(); } };
$('#nextPage').onclick = () => { if (page < 10) { page += 1; renderHolders(); } };
$('#refreshBtn').onclick = () => {
  const toast = $('#toast');
  toast.classList.add('show');
  render();
  setTimeout(() => toast.classList.remove('show'), 1800);
};

setInterval(tick, 1000);
tick();
render();
