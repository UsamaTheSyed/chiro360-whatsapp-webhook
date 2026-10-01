const fs = require("fs");

const TZ = "America/Detroit";

async function main() {
  const base = process.env.RENDER_BASE_URL;
  const secret = process.env.AGENDA_UPLOAD_SECRET;
  if (!base || !secret) throw new Error("Missing RENDER_BASE_URL or AGENDA_UPLOAD_SECRET");

  const pdfBase64 = fs.readFileSync("agenda.pdf").toString("base64");
  const dateLabel = new Date().toLocaleDateString("en-US", {
    timeZone: TZ, weekday: "long", month: "long", day: "numeric", year: "numeric",
  });

  // Render can be asleep, so retry a few times
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${base}/send-agenda`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-upload-secret": secret },
        body: JSON.stringify({ pdfBase64, dateLabel }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.success) {
        console.log("Agenda sent. Message SID:", data.messageSid);
        return;
      }
      throw new Error(`HTTP ${res.status}: ${data.error || "unknown error"}`);
    } catch (err) {
      console.error(`Attempt ${attempt} failed: ${err.message}`);
      if (attempt === 3) throw err;
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
}

main().catch(() => process.exit(1));
