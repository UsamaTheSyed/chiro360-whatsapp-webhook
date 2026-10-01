const { google } = require("googleapis");

const TZ = "America/Detroit";

// Returns "YYYY-MM-DD" for today in Detroit
function todayInDetroit() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

// Converts a Detroit local date + time to a UTC ISO string (handles DST)
function detroitToISO(dateStr, time) {
  const guess = new Date(`${dateStr}T${time}Z`);
  const tzDate = new Date(guess.toLocaleString("en-US", { timeZone: TZ }));
  const offset = guess.getTime() - tzDate.getTime();
  return new Date(guess.getTime() + offset).toISOString();
}

async function fetchTodaysEvents() {
  const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  if (!creds.client_email || !creds.private_key) {
    throw new Error(
      "Secret JSON is missing client_email or private_key. Re-paste the full key file."
    );
  }
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar.readonly"],
  });
  const calendar = google.calendar({ version: "v3", auth });

  const date = todayInDetroit();
  const res = await calendar.events.list({
    calendarId: process.env.GOOGLE_CALENDAR_ID,
    timeMin: detroitToISO(date, "00:00:00"),
    timeMax: detroitToISO(date, "23:59:59"),
    singleEvents: true,
    orderBy: "startTime",
  });

  return { date, events: res.data.items || [] };
}

module.exports = { fetchTodaysEvents, TZ };

// Run directly for a quick test: node fetchAgenda.js
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
