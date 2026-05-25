'use strict';
const QRCode = require('qrcode');
const { BrowserWindow } = require('electron');

async function generateDataUrl(text) {
  return QRCode.toDataURL(text, { width: 200, margin: 1 });
}

async function openStickerSheet(ipads) {
  const stickers = await Promise.all(
    ipads.map(async ip => ({ ...ip, qr: await generateDataUrl(ip.asset_tag) }))
  );
  const win = new BrowserWindow({ show: true, width: 920, height: 740, title: 'iPad-Aufkleber drucken' });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildHtml(stickers)));
}

function buildHtml(stickers) {
  const items = stickers.map(s =>
    `<div class="sticker"><img src="${s.qr}" /><div class="tag">${s.asset_tag}</div><div class="model">${(s.model||'').slice(0,24)}</div></div>`
  ).join('');
  return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Aufkleber</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:Arial,sans-serif;background:#fff}
.bar{display:flex;align-items:center;gap:12px;padding:10px 16px;background:#f1f5f9;border-bottom:1px solid #e2e8f0}
.bar button{padding:6px 18px;background:#2563eb;color:#fff;border:none;border-radius:4px;font-size:13px;cursor:pointer}
.bar button:hover{background:#1d4ed8}
.bar span{font-size:13px;color:#64748b}
.sheet{display:flex;flex-wrap:wrap;gap:4mm;padding:10mm}
.sticker{border:1px dashed #94a3b8;padding:3mm;text-align:center;width:42mm;height:42mm;display:flex;flex-direction:column;align-items:center;justify-content:center}
.sticker img{width:28mm;height:28mm}
.tag{font-size:8.5pt;font-weight:bold;margin-top:1mm}
.model{font-size:6.5pt;color:#555;margin-top:.5mm}
@media print{.bar{display:none}@page{margin:5mm}}
</style></head><body>
<div class="bar"><button onclick="window.print()">&#128438; Drucken</button><span>${stickers.length} Aufkleber &mdash; je ca. 42&times;42 mm</span></div>
<div class="sheet">${items}</div></body></html>`;
}

module.exports = { generateDataUrl, openStickerSheet };
