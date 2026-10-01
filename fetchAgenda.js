const { google } = require("googleapis");

const TZ = "America/Detroit";

function todayInDetroit() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

// Detroit local date + time -> ISO string (handles DST)
function detroitToISO(dateStr, time) {
  const guess = new Date(`${dateStr}T${time}Z`);
  const tzDate = new Date(guess.toLocaleString("en-US", { timeZone: TZ }));
  return new Date(guess.getTime() + (guess.getTime() - tzDate.getTime())).toISOString();
}

async function fetchTodaysEvents() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN } = process.env;
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REFRESH_TOKEN) {
    throw new Error("Missing GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET or GOOGLE_REFRESH_TOKEN");
  }

  const auth = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
  const calendar = google.calendar({ version: "v3", auth });

  const date = todayInDetroit();
  const res = await calendar.events.list({
    calendarId: "primary",
    timeMin: detroitToISO(date, "00:00:00"),
    timeMax: detroitToISO(date, "23:59:59"),
    singleEvents: true,
    orderBy: "startTime",
  });

  return { date, events: res.data.items || [] };
}

module.exports = { fetchTodaysEvents, TZ };

// Quick test: node fetchAgenda.js
if (require.main === module) {
  fetchTodaysEvents()
    .then(({ date, events }) => {
      console.log(`Date (Detroit): ${date}`);
      console.log(`Events found: ${events.length}`);
      events.forEach((e) =>
        console.log({
          start: e.start.dateTime || e.start.date,
          title: e.summary,
          location: e.location,
          description: e.description,
        })
      );
    })
    .catch((err) => {
      console.error("Calendar fetch failed:", err.message);
      process.exit(1);
    });
}
