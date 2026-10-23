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
let historyScale = 'focus';
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

function filteredTimelineRows(rows, newest) {
  if (historyRange === 'all' || !rows.length) return rows;
  const duration = ({ '24h': 86400, '6h': 21600, '1h': 3600 })[historyRange];
  return rows.filter((row) => row[0] >= newest - duration);
}

function quantile(sorted, fraction) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))];
}

function drawTimelineCanvas(canvas, rows, type, sharedDomain) {
  const context = canvas.getContext('2d');
  const bounds = canvas.getBoundingClientRect();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.max(1, bounds.width);
  const height = Math.max(1, bounds.height);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);

  const padding = { left: 54, right: 18, top: 18, bottom: 31 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  if (plotWidth <= 0 || plotHeight <= 0 || !rows.length) {
    context.fillStyle = '#77756d';
    context.font = '11px sans-serif';
    context.fillText('该时间范围内暂无记录', padding.left, height / 2);
    return { points: [], bounds: { ...padding, plotWidth, plotHeight }, domain: sharedDomain || [0, 1] };
  }

  const sortedPrices = rows.map((row) => row[1]).sort((a, b) => a - b);
  let minPrice = sharedDomain?.[0] ?? (historyScale === 'focus' ? quantile(sortedPrices, 0.01) : sortedPrices[0]);
  let maxPrice = sharedDomain?.[1] ?? (historyScale === 'focus' ? quantile(sortedPrices, 0.99) : sortedPrices.at(-1));
  if (minPrice === maxPrice) { minPrice *= 0.98; maxPrice *= 1.02; }
  const minTime = rows[0][0];
  const maxTime = Math.max(minTime + 1, rows.at(-1)[0]);
  const px = (timestamp) => padding.left + (timestamp - minTime) / (maxTime - minTime) * plotWidth;
  const py = (price) => padding.top + (maxPrice - price) / (maxPrice - minPrice) * plotHeight;

  context.font = '9px sans-serif';
  context.textAlign = 'right';
  context.textBaseline = 'middle';
  for (let index = 0; index <= 4; index += 1) {
    const y = padding.top + plotHeight * index / 4;
    const value = maxPrice - (maxPrice - minPrice) * index / 4;
    context.strokeStyle = '#262721';
    context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
    context.fillStyle = '#77756d';
    context.fillText(value.toFixed(asset === 'loom' ? 0 : 2), padding.left - 8, y);
  }
  const ticks = 4;
  context.textAlign = 'center';
  context.textBaseline = 'top';
  for (let index = 0; index <= ticks; index += 1) {
    const time = minTime + (maxTime - minTime) * index / ticks;
    const x = padding.left + plotWidth * index / ticks;
    context.fillStyle = '#77756d';
    context.fillText(new Date(time * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }), x, height - padding.bottom + 9);
  }

  if (type === 'trade') {
    if (historyMode !== 'bubble') {
      context.strokeStyle = '#d8bd72';
      context.lineWidth = 1.35;
      context.beginPath();
      rows.forEach((row, index) => {
        const x = px(row[0]); const y = py(row[1]);
        if (index) context.lineTo(x, y); else context.moveTo(x, y);
      });
      context.stroke();
    }
    if (historyMode !== 'line') {
      const stride = Math.max(1, Math.ceil(rows.length / Math.max(1000, plotWidth * 3)));
      context.fillStyle = '#f2d98e99';
      for (let index = 0; index < rows.length; index += stride) {
        context.beginPath(); context.arc(px(rows[index][0]), py(rows[index][1]), historyMode === 'hybrid' ? 1.7 : 2.4, 0, Math.PI * 2); context.fill();
      }
    }
  } else {
    const quantities = rows.map((row) => row[3]).filter((value) => value > 0).sort((a, b) => a - b);
    const q90 = Math.max(1, quantile(quantities, 0.9));
    rows.forEach((row) => {
      const status = row[4];
      context.fillStyle = status === 0 ? '#69b78fb8' : status === 1 ? '#b69555b8' : '#74756f91';
      const radius = 2.5 + Math.min(8, Math.sqrt(Math.max(0, row[3]) / q90) * 5);
      context.beginPath(); context.arc(px(row[0]), py(row[1]), radius, 0, Math.PI * 2); context.fill();
    });
  }
  return { points: rows, bounds: { ...padding, plotWidth, plotHeight, width, height }, domain: [minPrice, maxPrice], minTime, maxTime };
}

function renderTimeline() {
  if (!timelineSnapshot) return;
  const series = timelineSnapshot.assets[asset];
  const newest = Math.max(series.trades.at(-1)?.[0] ?? 0, series.bids.at(-1)?.[0] ?? 0);
  const trades = filteredTimelineRows(series.trades, newest);
  const bids = filteredTimelineRows(series.bids, newest);
  const tradePrices = trades.map((row) => row[1]);
  const bidPrices = bids.map((row) => row[1]);
  const combined = [...tradePrices, ...bidPrices].sort((a, b) => a - b);
  const commonDomain = $('#sharedScale').checked && combined.length
    ? [historyScale === 'focus' ? quantile(combined, 0.01) : combined[0], historyScale === 'focus' ? quantile(combined, 0.99) : combined.at(-1)]
    : null;
  const tradeView = drawTimelineCanvas($('#tradeTimeline'), trades, 'trade', commonDomain);
  const bidView = drawTimelineCanvas($('#bidTimeline'), bids, 'bid', commonDomain);
  timelineView = { tradeView, bidView, trades, bids };
  $('#timelineSample').textContent = `${trades.length.toLocaleString()} 笔成交 · ${bids.length.toLocaleString()} 笔挂单`;
  $('#firstTradePrice').textContent = series.summary.firstPrice === null ? '—' : `${series.summary.firstPrice.toFixed(2)} USDT`;
  $('#firstTradeAt').textContent = series.summary.firstAt ? new Date(series.summary.firstAt * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';
  $('#lastTradePrice').textContent = series.summary.lastPrice === null ? '—' : `${series.summary.lastPrice.toFixed(2)} USDT`;
  $('#lastTradeAt').textContent = series.summary.lastAt ? new Date(series.summary.lastAt * 1000).toLocaleString('zh-CN', { hour12: false }) : '—';
  $('#allTradeAverage').textContent = series.summary.average === null ? '—' : `${series.summary.average.toFixed(2)} USDT`;
  $('#allTradeCount').textContent = `${series.summary.tradeCount.toLocaleString()} 笔逐笔成交`;
  $('#allTradeMedian').textContent = series.summary.median === null ? '—' : `${series.summary.median.toFixed(2)} USDT`;
  $('#allTradeRange').textContent = `区间 ${series.summary.low?.toFixed(2) ?? '—'} – ${series.summary.high?.toFixed(2) ?? '—'} USDT`;
  $('#allBidCount').textContent = series.summary.bidCount.toLocaleString();
  $('#visibleEventCount').textContent = `当前范围 ${bids.length.toLocaleString()} 笔 · ${timelineSnapshot.statusLabels.join(' / ')}`;
  const rangeLabels = { all: '完整历史', '24h': '最近 24 小时', '6h': '最近 6 小时', '1h': '最近 1 小时' };
  $('#focusNote').textContent = historyScale === 'focus' ? '主要价格区间按 1%–99% 分位显示；悬停图点查看逐笔数据' : '价格轴覆盖所选时段全部价格；悬停图点查看逐笔数据';
  $('#timelineSnapshot').textContent = `${rangeLabels[historyRange]} · 数据区块 ${timelineSnapshot.indexedBlock.toLocaleString()} · 更新 ${new Date(timelineSnapshot.generatedAt).toLocaleString('zh-CN', { hour12: false })}`;
}

function showTimelineTooltip(event, type) {
  if (!timelineView) return;
  const canvas = event.currentTarget;
  const view = type === 'trade' ? timelineView.tradeView : timelineView.bidView;
  const points = view.points;
  if (!points.length) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const { left, plotWidth } = view.bounds;
  const ratio = Math.max(0, Math.min(1, (x - left) / plotWidth));
  const targetTime = view.minTime + ratio * (view.maxTime - view.minTime);
  let low = 0; let high = points.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (points[mid][0] < targetTime) low = mid + 1; else high = mid;
  }
  const candidates = [points[low], points[Math.max(0, low - 1)]];
  const row = candidates.reduce((best, item) => Math.abs(item[0] - targetTime) < Math.abs(best[0] - targetTime) ? item : best);
  const tip = $('#timelineTooltip');
  tip.style.display = 'block';
  const boardRect = $('.timeline-board').getBoundingClientRect();
  tip.style.left = `${Math.min(boardRect.width - 250, Math.max(8, event.clientX - boardRect.left + 12))}px`;
  tip.style.top = `${Math.max(8, event.clientY - boardRect.top - 28)}px`;
  if (type === 'trade') {
    tip.innerHTML = `<time>${new Date(row[0] * 1000).toLocaleString('zh-CN', { hour12: false })}</time><div>Token ID <strong>#${row[2]}</strong></div><div>成交成本 <strong>${row[1].toFixed(2)} USDT</strong></div><small>Bid #${row[3]}</small>`;
  } else {
    const status = timelineSnapshot.statusLabels[row[4]] || '未知';
    tip.innerHTML = `<time>${new Date(row[0] * 1000).toLocaleString('zh-CN', { hour12: false })}</time><div>订单 <strong>#${row[5]}</strong></div><div>挂单价 <strong>${row[1].toFixed(2)} USDT</strong></div><div>数量 <strong>${row[3].toLocaleString()} / ${row[2].toLocaleString()} NFT</strong></div><small>${status}</small>`;
  }
}

function installTimelineInteractions() {
  $('#tradeTimeline').addEventListener('pointermove', (event) => showTimelineTooltip(event, 'trade'));
  $('#bidTimeline').addEventListener('pointermove', (event) => showTimelineTooltip(event, 'bid'));
  $$('.timeline-board canvas').forEach((canvas) => canvas.addEventListener('pointerleave', () => { $('#timelineTooltip').style.display = 'none'; }));
  if ('ResizeObserver' in window) {
    timelineResizeObserver = new ResizeObserver(() => renderTimeline());
    timelineResizeObserver.observe($('.timeline-board'));
  } else window.addEventListener('resize', renderTimeline);
  $$('[data-history-mode]').forEach((button) => button.onclick = () => {
    historyMode = button.dataset.historyMode;
    $$('[data-history-mode]').forEach((item) => item.classList.toggle('active', item === button));
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
