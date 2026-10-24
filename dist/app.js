const snapshot = window.PTAH_SNAPSHOT;
const marketSnapshot = window.PTAH_MARKET;
const costSnapshot = window.PTAH_COSTS;
const timelineSnapshot = window.PTAH_TIMELINE;
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
let historyMode = 'hybrid';
let historyRange = 'all';
let historyScale = 'all';
let historySeries = 'hybrid';
let timelineAsset = 'all';
let timelineCursorRatio = null;
let hoverTime = null;
let timelineView = null;
let timelineResizeObserver;
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

function depthSummary(assetKey) {
  const current = assets[assetKey];
  const levels = current.levels.filter((level) => level.price >= current.bestBid * (1 - range / 100));
  const quantity = levels.reduce((sum, level) => sum + level.quantity, 0);
  const escrow = levels.reduce((sum, level) => sum + level.escrow, 0);
  let running = 0; let median = 0;
  for (const level of levels) {
    running += level.quantity;
    if (running >= quantity / 2) { median = level.price; break; }
  }
  const weighted = quantity ? escrow / quantity : 0;
  const gap = current.bestBid ? Math.max(0, (current.bestBid - median) / current.bestBid * 100) : 0;
  const maxShare = quantity ? Math.max(...levels.map((level) => level.quantity)) / quantity * 100 : 0;
  const coverage = quantity / Math.max(1, current.circulating) * 100;
  return { current, levels, quantity, escrow, median, weighted, gap, maxShare, coverage };
}

function renderComparison() {
  const markup = ['relic', 'loom'].map((key) => {
    const summary = depthSummary(key);
    const label = key === 'relic' ? 'Relics · NFT' : 'Looms · 矿机';
    const bars = summary.levels.slice(0, 8);
    const max = Math.max(1, ...bars.map((level) => level.quantity));
    return `<button type="button" class="compare-card ${key === asset ? 'selected' : ''}" data-market-asset="${key}"><header><strong>${label}</strong><span>${summary.current.openOrders.toLocaleString()} 笔挂单</span></header><div class="compare-values"><div><small>最佳价</small><b>${summary.current.bestBid.toFixed(2)}</b></div><div><small>数量中位价</small><b>${summary.median.toFixed(2)}</b></div><div><small>${range}% 可承接</small><b>${summary.quantity.toLocaleString()}</b></div><div><small>流通量覆盖</small><b>${summary.coverage.toFixed(2)}%</b></div></div><div class="compare-bars">${bars.map((level) => `<i style="height:${Math.max(8, level.quantity / max * 100)}%" title="${level.price.toFixed(2)} USDT · ${level.quantity.toLocaleString()} NFT"></i>`).join('')}</div><small class="compare-foot">中位价距最佳价 ${summary.gap.toFixed(1)}% · 最大单档占比 ${summary.maxShare.toFixed(1)}%</small></button>`;
  }).join('');
  $('#compareGrid').innerHTML = markup;
  $$('[data-market-asset]').forEach((button) => button.onclick = () => {
    asset = button.dataset.marketAsset;
    $$('[data-asset]').forEach((item) => item.classList.toggle('active', item.dataset.asset === asset));
    render();
  });
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
  const medianGap = current.bestBid ? Math.max(0, (current.bestBid - medianPrice) / current.bestBid * 100) : 0;
  const nearQuantity = data.filter((level) => level.price >= current.bestBid * (1 - Math.min(range, 10) / 100)).reduce((sum, level) => sum + level.quantity, 0);
  const concentration = totalQuantity ? nearQuantity / totalQuantity * 100 : 0;
  const coverage = totalQuantity / Math.max(1, current.circulating) * 100;
  const maxShare = totalQuantity ? Math.max(...data.map((level) => level.quantity)) / totalQuantity * 100 : 0;
  const max = Math.max(1, cumulative);
  const chartData = data.length > 12
    ? data.filter((_, index) => index === 0 || index === data.length - 1 || index % Math.ceil(data.length / 12) === 0)
    : data;
  const floorPrice = current.bestBid * (1 - range / 100);
  const priceSpan = Math.max(0.000001, current.bestBid - floorPrice);
  const x = (price) => 55 + (current.bestBid - price) / priceSpan * 620;
  const y = (value) => 250 - value / max * 190;
  const points = chartData.map((level) => `${x(level.price)},${y(level.cumulative)}`);

  $('.chart-label').textContent = `${range}% 价格带 · ${fmtMoney(totalEscrow)} USDT · ${cumulative.toLocaleString()} NFT`;
  $('#medianBid').textContent = `${medianPrice.toFixed(2)} USDT`;
  $('#weightedAvg').textContent = `${weightedPrice.toFixed(2)} USDT`;
  $('#medianGap').textContent = `${medianGap.toFixed(1)}%`;
  $('#depthScore').textContent = `${coverage.toFixed(2)}%`;
  $('#depthConcentration').textContent = `${maxShare.toFixed(1)}%`;
  $('#depthQuantity').textContent = `${nearQuantity.toLocaleString()} NFT`;
  $('#depthExplainText').textContent = `当前 ${range}% 价格带可承接 ${totalQuantity.toLocaleString()} NFT；其中 ${concentration.toFixed(1)}% 集中在最佳价附近，曲线越陡代表承接越集中。`;
  $('#linePath').setAttribute('d', points.length ? `M ${points.join(' L ')}` : '');
  $('#areaPath').setAttribute('d', points.length ? `M ${x(chartData[0].price)},250 L ${points.join(' L ')} L ${x(chartData[chartData.length - 1].price)},250 Z` : '');
  $('#gridLines').innerHTML = [0, 1, 2, 3, 4].map((index) => `<line x1="55" x2="675" y1="${60 + index * 47.5}" y2="${60 + index * 47.5}" stroke="#262721"/><text x="18" y="${64 + index * 47.5}" fill="#595a53" font-size="9">${Math.round(max * (4 - index) / 4)}</text>`).join('');
  $('#axisLabels').innerHTML = [0, 1, 2, 3, 4].map((index) => { const price = current.bestBid - priceSpan * index / 4; const label = index === 0 ? '最佳价' : `-${(range * index / 4).toFixed(1)}%`; return `<text x="${55 + index * 155}" y="277" text-anchor="middle" fill="#64645d" font-size="9">${label} · ${price.toFixed(asset === 'loom' ? 0 : 2)}</text>`; }).join('') + '<text x="365" y="297" text-anchor="middle" fill="#66665f" font-size="9">价格区间 (USDT / 距最佳价)</text>';
  $('#chartDots').innerHTML = chartData.map((level, index) => `<circle data-i="${index}" cx="${x(level.price)}" cy="${y(level.cumulative)}" r="8" fill="transparent" stroke="transparent" tabindex="0"/>`).join('');
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

function quantile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function priceRows(rows) {
  return rows.filter((row) => Number.isFinite(row[1]) && row[1] > 0);
}

function trimmedRows(rows, low = 0.01, high = 0.99) {
  return priceRows(rows);
}

function drawTimelineCanvas(canvas, lineSeries, sharedDomain, startTime, endTime, scaleType = 'linear') {
  const context = canvas.getContext('2d');
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const padding = { left: 54, right: 18, top: 14, bottom: 31 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  if (plotWidth <= 0 || plotHeight <= 0) {
    context.fillStyle = '#77756d';
    context.font = '11px sans-serif';
    context.fillText('该时间范围内暂无记录', padding.left, height / 2);
    return { points: [], bounds: { ...padding, plotWidth, plotHeight }, domain: sharedDomain || [0, 1], startTime, endTime };
  }

  const allRows = lineSeries.flatMap((series) => series.rows);
  const sortedPrices = allRows.map((row) => row[1]).filter((value) => value > 0).sort((a, b) => a - b);
  let minPrice = sharedDomain?.[0] ?? (historyScale === 'focus' ? quantile(sortedPrices, 0.01) : sortedPrices[0]);
  let maxPrice = sharedDomain?.[1] ?? (historyScale === 'focus' ? quantile(sortedPrices, 0.99) : sortedPrices[sortedPrices.length - 1]);
  if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice) || minPrice <= 0) { minPrice = 0.01; maxPrice = 1; }
  if (minPrice === maxPrice) { minPrice *= 0.98; maxPrice *= 1.02; }
  const logMin = Math.log10(minPrice); const logMax = Math.log10(maxPrice);
  const px = (timestamp) => padding.left + (timestamp - startTime) / Math.max(1, endTime - startTime) * plotWidth;
  const py = (price) => {
    const value = scaleType === 'log' ? Math.log10(Math.max(minPrice, price)) : price;
    const top = scaleType === 'log' ? logMax : maxPrice;
    const bottom = scaleType === 'log' ? logMin : minPrice;
    return padding.top + (top - value) / Math.max(0.000001, top - bottom) * plotHeight;
  };

  context.font = '9px sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + plotHeight * index / 4;
    const value = scaleType === 'log'
      ? Math.pow(10, logMax - (logMax - logMin) * index / 4)
      : maxPrice - (maxPrice - minPrice) * index / 4;
    context.strokeStyle = '#262721';
    context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
    context.fillStyle = '#77756d';
    context.fillText(value >= 100 ? value.toFixed(0) : value.toFixed(2), padding.left - 8, y);
  }
  const ticks = 4;
  context.textAlign = 'center';
  context.textBaseline = 'top';
  const axisLabels = [];
  for (let index = 0; index <= ticks; index += 1) {
    const time = startTime + (endTime - startTime) * index / ticks;
    const x = padding.left + plotWidth * index / ticks;
    axisLabels.push({ time, x });
    context.fillStyle = '#77756d';
    context.fillText(new Date(time * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }), x, height - padding.bottom + 9);
  }

  lineSeries.forEach((series) => {
    const rows = series.rows;
    const marks = series.bubbleRows || rows;
    if (!rows.length) return;
    context.strokeStyle = series.color;
    context.fillStyle = series.fill || series.color;
    context.lineWidth = series.width || 1.25;
    if (series.kind === 'trade' && historyMode !== 'bubble') {
      context.beginPath();
      rows.forEach((row, index) => { const x = px(row[0]); const y = py(row[1]); if (index) context.lineTo(x, y); else context.moveTo(x, y); });
      context.stroke();
    }
    if (historyMode !== 'line' || series.kind === 'bid') {
      const quantities = series.kind === 'bid' ? marks.map((row) => row[3]).filter((value) => value > 0).sort((a, b) => a - b) : [];
      const q90 = Math.max(1, quantile(quantities, 0.9));
      const stride = Math.max(1, Math.ceil(marks.length / Math.max(900, plotWidth * 2)));
      for (let index = 0; index < marks.length; index += stride) {
        const row = marks[index];
        const radius = series.kind === 'bid' ? 2.2 + Math.min(7, Math.sqrt(Math.max(0, row[3]) / q90) * 4) : (historyMode === 'bubble' ? 2.1 : 1.75);
        context.beginPath(); context.arc(px(row[0]), py(row[1]), radius, 0, Math.PI * 2); context.fill();
      }
    }
  });
  return { points: allRows, bounds: { ...padding, plotWidth, plotHeight, width, height }, domain: [minPrice, maxPrice], startTime, endTime, axisLabels, scaleType };
}

function medianValue(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function credibleBids(trades, bids) {
  const validTrades = priceRows(trades).sort((a, b) => a[0] - b[0]);
  const globalMedian = medianValue(validTrades.map((row) => row[1]));
  const rows = [];
  let excluded = 0;
  for (const bid of bids) {
    if (!Number.isFinite(bid[1]) || bid[1] <= 0) { excluded += 1; continue; }
    let low = 0; let high = validTrades.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (validTrades[middle][0] <= bid[0]) low = middle + 1; else high = middle;
    }
    const nearby = validTrades.slice(Math.max(0, low - 30), Math.min(validTrades.length, low + 8));
    const reference = nearby.length >= 5 ? medianValue(nearby.map((row) => row[1])) : globalMedian;
    const plausible = reference > 0 && bid[1] >= reference * 0.35 && bid[1] <= reference * 1.75;
    if (plausible) rows.push(bid); else excluded += 1;
  }
  return { rows, excluded };
}

function drawVolume(rows, startTime, endTime) {
  const canvas = $('#volumeTimeline');
  const context = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, rect.width); const height = Math.max(1, rect.height);
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0); context.clearRect(0, 0, width, height);
  const pad = { left: 54, right: 18, top: 10, bottom: 30 };
  const plotWidth = width - pad.left - pad.right; const plotHeight = height - pad.top - pad.bottom;
  const bucketCount = Math.max(24, Math.min(100, Math.floor(plotWidth / 8)));
  const buckets = Array.from({ length: bucketCount }, () => ({ count: 0, usdt: 0 }));
  const duration = Math.max(1, endTime - startTime);
  for (const row of rows) {
    const index = Math.max(0, Math.min(bucketCount - 1, Math.floor((row[0] - startTime) / duration * bucketCount)));
    buckets[index].count += 1; buckets[index].usdt += row[1];
  }
  const maxCount = Math.max(1, ...buckets.map((bucket) => bucket.count));
  const movingAverage = buckets.map((_, index) => {
    const window = buckets.slice(Math.max(0, index - 3), index + 1);
    return window.reduce((sum, bucket) => sum + bucket.count, 0) / window.length;
  });
  context.strokeStyle = '#262721'; context.fillStyle = '#69b78f'; context.font = '9px sans-serif';
  context.textAlign = 'right'; context.textBaseline = 'middle';
  for (let index = 0; index <= 2; index += 1) {
    const y = pad.top + plotHeight * index / 2;
    context.beginPath(); context.moveTo(pad.left, y); context.lineTo(width - pad.right, y); context.stroke();
    context.fillStyle = '#77756d'; context.fillText(Math.round(maxCount * (2 - index) / 2), pad.left - 8, y);
  }
  const gap = 1;
  const barWidth = Math.max(1, plotWidth / bucketCount - gap);
  buckets.forEach((bucket, index) => {
    const barHeight = bucket.count / maxCount * plotHeight;
    const x = pad.left + index * plotWidth / bucketCount;
    context.fillStyle = bucket.count ? '#76ad8d' : '#38463c';
    context.fillRect(x, pad.top + plotHeight - barHeight, barWidth, barHeight);
  });
  context.strokeStyle = '#d8bd72'; context.lineWidth = 1.5; context.beginPath();
  movingAverage.forEach((value, index) => {
    const x = pad.left + (index + 0.5) * plotWidth / bucketCount;
    const y = pad.top + plotHeight - value / maxCount * plotHeight;
    if (index) context.lineTo(x, y); else context.moveTo(x, y);
  });
  context.stroke();
  context.fillStyle = '#77756d'; context.textAlign = 'center'; context.textBaseline = 'top';
  const axisLabels = [];
  for (let index = 0; index <= 4; index += 1) {
    const time = startTime + duration * index / 4;
    const x = pad.left + plotWidth * index / 4;
    axisLabels.push({ time, x });
    context.fillText(new Date(time * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }), x, height - pad.bottom + 8);
  }
  const totalUsdt = rows.reduce((sum, row) => sum + row[1], 0);
  $('#volumeNow').textContent = `${rows.length.toLocaleString()} NFT · ${totalUsdt.toLocaleString(undefined, { maximumFractionDigits: 1 })} USDT`;
  const latestBucket = buckets[buckets.length - 1];
  $('#volumeRate').textContent = `${latestBucket.count} NFT · ${latestBucket.usdt.toFixed(2)} USDT`;
  return { buckets, movingAverage, startTime, endTime, pad, plotWidth, plotHeight, bounds: { width, height } };
}

function renderTimeline() {
  if (!timelineSnapshot) return;
  const marketKeys = timelineAsset === 'all' ? ['relic', 'loom'] : [timelineAsset];
  const seriesByMarket = Object.fromEntries(marketKeys.map((key) => [key, timelineSnapshot.assets[key]]));
  const allTrades = marketKeys.flatMap((key) => seriesByMarket[key].trades);
  const allBids = marketKeys.flatMap((key) => seriesByMarket[key].bids);
  const allTimelineRows = [...allTrades, ...allBids];
  const fullStart = allTimelineRows.reduce((value, row) => Math.min(value, row[0]), Infinity);
  const fullEnd = allTimelineRows.reduce((value, row) => Math.max(value, row[0]), 0);
  if (!Number.isFinite(fullStart) || fullEnd < fullStart) return;
  const duration = ({ '24h': 86400, '6h': 21600, '1h': 3600 })[historyRange];
  const startTime = historyRange === 'all' ? fullStart : Math.max(fullStart, fullEnd - duration);
  const endTime = fullEnd;
  const marketData = Object.fromEntries(marketKeys.map((key) => {
    const source = seriesByMarket[key];
    const trades = source.trades.filter((row) => row[0] >= startTime && row[0] <= endTime);
    const rawBids = source.bids.filter((row) => row[0] >= startTime && row[0] <= endTime);
    const credible = credibleBids(source.trades, rawBids);
    return [key, { trades, tradePlot: trimmedRows(trades), bids: credible.rows, bidPlot: trimmedRows(credible.rows), excluded: credible.excluded }];
  }));
  const trades = marketKeys.flatMap((key) => marketData[key].trades).sort((a, b) => a[0] - b[0]);
  const visibleTradeRows = marketKeys.flatMap((key) => marketData[key].tradePlot).sort((a, b) => a[0] - b[0]);
  const lineColors = { relicTrade: '#d8bd72', relicBid: '#69b78f', loomTrade: '#d58a68', loomBid: '#86a9d2' };
  const lineSeries = [];
  for (const key of marketKeys) {
    const data = marketData[key];
    const includeTrades = historySeries !== 'bid';
    const includeBids = historySeries !== 'trade';
    const prefix = key === 'relic' ? 'relic' : 'loom';
    if (includeTrades) lineSeries.push({ id: `${key}Trade`, market: key, kind: 'trade', rows: data.tradePlot, color: lineColors[`${prefix}Trade`] });
    if (includeBids) lineSeries.push({ id: `${key}Bid`, market: key, kind: 'bid', rows: data.bidPlot, color: lineColors[`${prefix}Bid`] });
  }
  const combined = lineSeries.flatMap((line) => line.rows.map((row) => row[1])).sort((a, b) => a - b);
  const commonDomain = combined.length
    ? [historyScale === 'focus' ? quantile(combined, 0.01) : combined[0], historyScale === 'focus' ? quantile(combined, 0.99) : combined[combined.length - 1]]
    : [0.1, 1];
  const priceScale = timelineAsset === 'all' ? 'log' : 'linear';
  const tradeView = drawTimelineCanvas($('#tradeTimeline'), lineSeries, commonDomain, startTime, endTime, priceScale);
  $('#bidTimeline').style.display = 'none';
  const volumeView = drawVolume(visibleTradeRows, startTime, endTime);
  const lastBucket = volumeView.buckets[volumeView.buckets.length - 1] || { count: 0, usdt: 0 };
  $('#volumeRate').textContent = `${lastBucket.count} NFT · ${lastBucket.usdt.toFixed(2)} USDT`;
  $('#tradeTimeline').style.display = 'block';
  const marketName = timelineAsset === 'all' ? 'NFT + 矿机' : timelineAsset === 'relic' ? 'Relics' : 'Looms';
  const titles = { trade: [`${marketName} 成交成本`, '逐笔链上成交价格与时间'], bid: [`${marketName} 历史挂单`, '过滤明显偏离成交区间的挂单'], hybrid: [`${marketName} 成交成本 + 挂单`, timelineAsset === 'all' ? 'NFT 与矿机四条序列共用时间轴与对数价格轴' : '成交与挂单使用独立颜色，并共用时间轴'] };
  $('#timelineChartTitle').textContent = titles[historySeries][0];
  $('#timelineChartSubtitle').textContent = titles[historySeries][1];
  $('#timelineChartTitle').previousElementSibling.className = `legend-dot ${historySeries === 'bid' ? 'bid-dot' : 'trade-dot'}`;
  timelineView = { tradeView, volumeView, markets: marketData, trades: visibleTradeRows, startTime, endTime };
  const visibleBids = marketKeys.flatMap((key) => marketData[key].bidPlot);
  const excludedBids = marketKeys.reduce((sum, key) => sum + marketData[key].excluded, 0);
  const perMarketText = (field, formatter) => marketKeys.map((key) => `${key === 'relic' ? 'NFT' : '矿机'} ${formatter(field(key))}`).join(' · ');
  $('#timelineSample').textContent = timelineAsset === 'all'
    ? `NFT ${marketData.relic.tradePlot.length.toLocaleString()} / ${marketData.relic.bidPlot.length.toLocaleString()} · 矿机 ${marketData.loom.tradePlot.length.toLocaleString()} / ${marketData.loom.bidPlot.length.toLocaleString()}`
    : `${visibleTradeRows.length.toLocaleString()} 笔成交 · ${visibleBids.length.toLocaleString()} 笔有效挂单`;
  const summaryTrades = allTrades.filter((row) => row[1] > 0).sort((a, b) => a[0] - b[0]);
  const firstTrade = summaryTrades[0]; const lastTrade = summaryTrades[summaryTrades.length - 1];
  const summaryPrices = summaryTrades.map((row) => row[1]);
  const average = summaryPrices.length ? summaryPrices.reduce((sum, value) => sum + value, 0) / summaryPrices.length : null;
  const marketSummary = (key) => {
    const rows = marketData[key].trades.filter((row) => row[1] > 0).sort((a, b) => a[0] - b[0]);
    const prices = rows.map((row) => row[1]);
    const bounds = prices.reduce((range, value) => [Math.min(range[0], value), Math.max(range[1], value)], [Infinity, -Infinity]);
    return { first: rows[0], last: rows[rows.length - 1], count: rows.length, avg: prices.length ? prices.reduce((sum, value) => sum + value, 0) / prices.length : null, median: prices.length ? medianValue(prices) : null, min: prices.length ? bounds[0] : null, max: prices.length ? bounds[1] : null, bids: marketData[key].bidPlot.length };
  };
  const summaries = Object.fromEntries(marketKeys.map((key) => [key, marketSummary(key)]));
  const pair = (formatter) => marketKeys.map((key) => `${key === 'relic' ? 'NFT' : '矿机'} ${formatter(summaries[key])}`).join(' / ');
  $('#firstTradePrice').textContent = timelineAsset === 'all' ? pair((summary) => summary.first ? summary.first[1].toFixed(2) : '—') + ' USDT' : firstTrade ? `${firstTrade[1].toFixed(2)} USDT` : '—';
  $('#firstTradeAt').textContent = timelineAsset === 'all' ? pair((summary) => summary.first ? new Date(summary.first[0] * 1000).toLocaleDateString('zh-CN') : '—') : firstTrade ? new Date(firstTrade[0] * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';
  $('#lastTradePrice').textContent = timelineAsset === 'all' ? pair((summary) => summary.last ? summary.last[1].toFixed(2) : '—') + ' USDT' : lastTrade ? `${lastTrade[1].toFixed(2)} USDT` : '—';
  $('#lastTradeAt').textContent = timelineAsset === 'all' ? pair((summary) => summary.last ? new Date(summary.last[0] * 1000).toLocaleDateString('zh-CN') : '—') : lastTrade ? new Date(lastTrade[0] * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';
  $('#allTradeAverage').textContent = timelineAsset === 'all' ? pair((summary) => summary.avg === null ? '—' : summary.avg.toFixed(2)) + ' USDT' : average === null ? '—' : `${average.toFixed(2)} USDT`;
  $('#allTradeCount').textContent = timelineAsset === 'all' ? pair((summary) => `${summary.count.toLocaleString()} 笔`) : `${summaryTrades.length.toLocaleString()} 笔逐笔成交`;
  $('#allTradeMedian').textContent = timelineAsset === 'all' ? pair((summary) => summary.median === null ? '—' : summary.median.toFixed(2)) + ' USDT' : summaryPrices.length ? `${medianValue(summaryPrices).toFixed(2)} USDT` : '—';
  const priceRange = summaryPrices.reduce((range, value) => [Math.min(range[0], value), Math.max(range[1], value)], [Infinity, -Infinity]);
  $('#allTradeRange').textContent = timelineAsset === 'all' ? pair((summary) => `${summary.min?.toFixed(2) ?? '—'}–${summary.max?.toFixed(2) ?? '—'}`) + ' USDT' : `区间 ${summaryPrices.length ? priceRange[0].toFixed(2) : '—'} – ${summaryPrices.length ? priceRange[1].toFixed(2) : '—'} USDT`;
  $('#allBidCount').textContent = timelineAsset === 'all' ? pair((summary) => `${summary.bids}`) : allBids.length.toLocaleString();
  $('#visibleEventCount').textContent = `当前范围 ${visibleBids.length.toLocaleString()} 笔 · 已过滤极端挂单 ${excludedBids} 笔`;
  const rangeLabels = { all: '完整历史', '24h': '最近 24 小时', '6h': '最近 6 小时', '1h': '最近 1 小时' };
  $('#focusNote').textContent = '挂单按相邻成交中位价的 35%–175% 保留；成交气泡固定半径，挂单气泡按剩余数量映射';
  $('#timelineSnapshot').textContent = `${marketName} 横向对比 · ${rangeLabels[historyRange]} · ${priceScale === 'log' ? '对数价格轴' : '线性价格轴'} · 更新 ${new Date(timelineSnapshot.generatedAt).toLocaleString('zh-CN', { hour12: false })}`;
}

function showTimelineTooltip(event) {
  if (!timelineView) return;
  const canvas = event.currentTarget;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const { left, plotWidth } = timelineView.tradeView.bounds;
  const ratio = Math.max(0, Math.min(1, (x - left) / plotWidth));
  timelineCursorRatio = ratio;
  const targetTime = timelineView.startTime + ratio * (timelineView.endTime - timelineView.startTime);
  const findNearest = (rows) => {
    if (!rows.length) return null;
    let leftIndex = 0; let rightIndex = rows.length - 1;
    while (leftIndex < rightIndex) { const mid = (leftIndex + rightIndex) >>> 1; if (rows[mid][0] < targetTime) leftIndex = mid + 1; else rightIndex = mid; }
    return [rows[leftIndex], rows[Math.max(0, leftIndex - 1)]].filter(Boolean).reduce((best, item) => Math.abs(item[0] - targetTime) < Math.abs(best[0] - targetTime) ? item : best);
  };
  const bucketIndex = Math.max(0, Math.min(timelineView.volumeView.buckets.length - 1, Math.floor(ratio * timelineView.volumeView.buckets.length)));
  const bucket = timelineView.volumeView.buckets[bucketIndex];
  const tip = $('#timelineTooltip');
  tip.style.display = 'block';
  const boardRect = $('.timeline-board').getBoundingClientRect();
  tip.style.left = `${Math.min(boardRect.width - 250, Math.max(8, event.clientX - boardRect.left + 12))}px`;
  tip.style.top = `${Math.max(8, event.clientY - boardRect.top - 28)}px`;
  const closeTo = (row) => row && Math.abs(row[0] - targetTime) <= Math.max(3600, (timelineView.endTime - timelineView.startTime) / 70);
  const marketLabel = { relic: 'Relics', loom: 'Looms' };
  const rows = Object.entries(timelineView.markets).map(([key, data]) => {
    const trade = findNearest(data.tradePlot);
    const bid = findNearest(data.bidPlot);
    const tradeText = closeTo(trade) ? `${trade[1].toFixed(2)} USDT` : '—';
    const bidText = closeTo(bid) ? `${bid[1].toFixed(2)} USDT · ${bid[3]} NFT` : '—';
    return `<div><span>${marketLabel[key]} 成交 / 挂单</span><strong>${tradeText} / ${bidText}</strong></div>`;
  }).join('');
  tip.innerHTML = `<time>${new Date(targetTime * 1000).toLocaleString('zh-CN', { hour12: false })}</time>${rows}<div><span>VOL / 移动均值</span><strong>${bucket.count} NFT / ${Math.round(timelineView.volumeView.movingAverage[bucketIndex] || 0)} NFT</strong></div>`;
  const plotLeft = timelineView.tradeView.bounds.left;
  const cursorX = plotLeft + ratio * timelineView.tradeView.bounds.plotWidth;
  const volumeCursorX = timelineView.volumeView.pad.left + ratio * timelineView.volumeView.plotWidth;
  $$('.timeline-main-wrap .timeline-cursor').forEach((cursor) => { cursor.style.left = `${cursorX}px`; cursor.classList.add('visible'); });
  $$('.volume-card .timeline-cursor').forEach((cursor) => { cursor.style.left = `${volumeCursorX}px`; cursor.classList.add('visible'); });
}

function installTimelineInteractions() {
  $('.timeline-main-wrap').addEventListener('pointermove', showTimelineTooltip);
  $('.timeline-main-wrap').addEventListener('pointerleave', () => { $('#timelineTooltip').style.display = 'none'; $$('.timeline-cursor').forEach((cursor) => cursor.classList.remove('visible')); });
  $('#volumeTimeline').addEventListener('pointermove', showTimelineTooltip);
  $('#volumeTimeline').addEventListener('pointerleave', () => { $('#timelineTooltip').style.display = 'none'; $$('.timeline-cursor').forEach((cursor) => cursor.classList.remove('visible')); });
  if ('ResizeObserver' in window) {
    timelineResizeObserver = new ResizeObserver(() => renderTimeline());
    timelineResizeObserver.observe($('.timeline-board'));
  } else window.addEventListener('resize', renderTimeline);
  $$('[data-history-mode]').forEach((button) => button.onclick = () => {
    historyMode = button.dataset.historyMode;
    $$('[data-history-mode]').forEach((item) => item.classList.toggle('active', item === button));
    renderTimeline();
  });
  $$('[data-history-series]').forEach((button) => button.onclick = () => {
    historySeries = button.dataset.historySeries;
    $$('[data-history-series]').forEach((item) => item.classList.toggle('active', item === button));
    renderTimeline();
  });
  $$('[data-timeline-asset]').forEach((button) => button.onclick = () => {
    timelineAsset = button.dataset.timelineAsset;
    $$('[data-timeline-asset]').forEach((item) => item.classList.toggle('active', item === button));
    renderTimeline();
  });
  $$('[data-history-range]').forEach((button) => button.onclick = () => {
    historyRange = button.dataset.historyRange;
    $$('[data-history-range]').forEach((item) => item.classList.toggle('active', item === button));
    renderTimeline();
  });
  $$('[data-price-scale]').forEach((button) => button.onclick = () => {
    historyScale = button.dataset.priceScale;
    $$('[data-price-scale]').forEach((item) => item.classList.toggle('active', item === button));
    renderTimeline();
  });
  $('#sharedScale').onchange = renderTimeline;
  $$('[data-layout]').forEach((button) => button.onclick = () => {
    $('.timeline-board').dataset.layout = button.dataset.layout;
    $$('[data-layout]').forEach((item) => item.classList.toggle('active', item === button));
    renderTimeline();
  });
}

function render() {
  updateSummary();
  renderHolders();
  renderComparison();
  renderChart();
  renderTrades();
  renderTimeline();
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
installTimelineInteractions();
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
