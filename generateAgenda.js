const fs = require("fs");
const puppeteer = require("puppeteer");
const { fetchTodaysEvents, TZ } = require("./fetchAgenda");

const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function parseEvent(e) {
  const title = e.summary || "";
  const desc = (e.description || "").replace(/\s+/g, " ").trim();

  const phoneMatch = title.match(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/);
  const dolMatch = title.match(/DOL[:\s-]*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i);

  let name = title;
  if (phoneMatch) name = name.replace(phoneMatch[0], "");
  if (dolMatch) name = name.replace(dolMatch[0], "");
  name = name.replace(/\s+/g, " ").replace(/[-–,·]+\s*$/, "").trim();

  const all = `${title} ${desc}`;
  const isNew = /\bnew\s*(patient|pt)\b/i.test(all);
  const needsTransport = /transport|pick\s?-?up|\bride\b/i.test(all);

  const time = e.start.dateTime
    ? new Date(e.start.dateTime).toLocaleTimeString("en-US", { timeZone: TZ, hour: "numeric", minute: "2-digit" })
    : "All day";

  const parts = [];
  if (phoneMatch) parts.push(`Phone: ${phoneMatch[0]}`);
  if (dolMatch) parts.push(`DOL: ${dolMatch[1]}`);
  let note = parts.join(" · ");
  if (desc) note += (note ? " — " : "") + desc;

  return { time, name: name || "(no name)", isNew, needsTransport, note, address: (e.location || "").trim() };
}

function buildHtml(items, dateLabel) {
  let logo = `<div class="logo-text">Chiro360</div>`;
  if (fs.existsSync("logo.png")) {
    const b64 = fs.readFileSync("logo.png").toString("base64");
    logo = `<img src="data:image/png;base64,${b64}" style="height:60px">`;
  }

  const newCount = items.filter((i) => i.isNew).length;
  const transCount = items.filter((i) => i.needsTransport).length;

  const cards = items.length
    ? items.map((i) => `
      <div class="card">
        <div class="time">${esc(i.time)}</div>
        <div class="body">
          <div class="row">
            <div class="name">${esc(i.name)}</div>
            <div>
              ${i.isNew ? '<span class="badge new">New Patient</span>' : ""}
              ${i.needsTransport ? '<span class="badge trans">Transportation Required</span>' : ""}
            </div>
          </div>
          ${i.note ? `<div class="box note"><div class="lbl">NOTE</div>${esc(i.note)}</div>` : ""}
          ${i.address ? `<div class="box ${i.needsTransport ? "pickup" : "addr"}"><div class="lbl">${i.needsTransport ? "PICKUP ADDRESS" : "ADDRESS"}</div>${esc(i.address)}</div>` : ""}
        </div>
      </div>`).join("")
    : `<div class="empty">No appointments scheduled today.</div>`;

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:Helvetica,Arial,sans-serif;background:#f5f7fb;margin:0;padding:40px;color:#222}
    .head{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #2b4a9c;padding-bottom:20px}
    .logo-text{font-size:40px;font-weight:700;color:#2b4a9c}
    .right{text-align:right}.tag{color:#2bbcc4;font-weight:700;font-size:13px;letter-spacing:1px}
    .date{color:#1e3a6e;font-size:20px;font-weight:700;margin-top:4px}
    .chips{display:flex;gap:12px;margin:24px 0}
    .chip{background:#fff;border:1px solid #e3e7ef;border-radius:10px;padding:10px 16px;color:#666;font-size:14px}
    .chip b{color:#1e3a6e}
    .card{display:flex;background:#fff;border:1px solid #e3e7ef;border-left:5px solid #2bbcc4;border-radius:10px;padding:14px 20px;margin-bottom:14px;page-break-inside:avoid}
    .time{width:110px;color:#2b4a9c;font-weight:700;font-size:16px}
    .body{flex:1}.row{display:flex;justify-content:space-between;align-items:center}
    .name{font-size:18px;font-weight:700}
    .badge{font-size:12px;font-weight:700;border-radius:12px;padding:4px 10px;margin-left:6px}
    .new{background:#fde8e1;color:#c0552f}.trans{background:#fdf0cf;color:#9a6b00}
    .box{border-radius:8px;padding:10px 14px;margin-top:10px;font-size:14px}
    .lbl{font-size:11px;font-weight:700;letter-spacing:1px;margin-bottom:4px}
    .note{background:#e0f4f8;color:#555}.note .lbl{color:#2bbcc4}
    .pickup{background:#fdf0cf;color:#9a6b00}.addr{background:#eef1f7;color:#555}
    .empty{background:#fff;border-radius:10px;padding:30px;text-align:center;color:#666}
    .foot{text-align:center;color:#777;font-size:13px;margin-top:24px}
  </style></head><body>
    <div class="head">${logo}<div class="right"><div class="tag">DAILY PATIENT AGENDA</div><div class="date">${esc(dateLabel)}</div></div></div>
    <div class="chips">
      <div class="chip"><b>${items.length}</b> appointment${items.length === 1 ? "" : "s"} today</div>
      <div class="chip"><b>${newCount}</b> new patient${newCount === 1 ? "" : "s"}</div>
      <div class="chip"><b>${transCount}</b> need transportation</div>
    </div>
    ${cards}
    <div class="foot">Pulled from Google Calendar · Chiro360</div>
  </body></html>`;
}

(async () => {
  const { events } = await fetchTodaysEvents();
  const items = events.map(parseEvent);

  const dateLabel = new Date()
    .toLocaleDateString("en-US", { timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric" })
    .replace(/^(\w+),/, "$1 ·");

  const browser = await puppeteer.launch({ args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  const page = await browser.newPage();
  await page.setContent(buildHtml(items, dateLabel), { waitUntil: "load" });
  await page.pdf({ path: "agenda.pdf", format: "A4", printBackground: true });
  await browser.close();

  console.log(`PDF created with ${items.length} appointment(s).`);
})().catch((err) => {
  console.error("PDF generation failed:", err.message);
  process.exit(1);
});
