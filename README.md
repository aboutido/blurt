# Blurt!

A free, open source live quiz game. The host puts the questions on a big screen, everyone answers on their phone, and the fastest right answers win.

- **No accounts, no ads, no tracking.** Players join with a 6-digit PIN or a QR code and a nickname.
- **No player limits.** Bring the whole class, the whole office or the whole hall.
- **Six question types:** multiple choice (one or several right answers), type the answer, put in order, slider, poll and word cloud.
- **Teams, homework, results spreadsheets, music, and a quiz library**, all free.

## Run it

Blurt is a website, not an app: nothing to install on phones. You run one small server, and everyone opens it in a browser. Pick whichever of these suits you.

### On your own computer, for one room

Good for trying it out, or for a classroom where everyone is on the same Wi-Fi. You need [Node.js](https://nodejs.org) 20 or newer.

```
npm install
npm start
```

Open http://localhost:3000 on your computer to host. Players can't use `localhost` (that means *their* phone), so find your computer's network address (on a Mac: `ipconfig getifaddr en0`; on Windows: `ipconfig`) and tell them to open `http://THAT-ADDRESS:3000`. School and office Wi-Fi sometimes blocks this; if phones can't connect, use one of the hosted options below.

### Railway (easiest hosted option, about $5 a month)

1. Fork this repository on GitHub.
2. On [railway.com](https://railway.com), sign in with GitHub, choose **New Project**, then **Deploy from GitHub repo**, and pick your fork. It finds `railway.json` and starts.
3. In the service's **Settings**, under Networking, click **Generate Domain**. That's your web address.
4. For homework: add a **Volume** mounted at `/data`, and in **Variables** add `DATA_DIR=/data` and `TRUST_PROXY=1`.

Every time you push to GitHub, Railway updates the site.

### Render (about $7 a month)

1. Fork this repository.
2. On [render.com](https://render.com), choose **New**, then **Blueprint**, and pick your fork. It reads `render.yaml`, which sets up the server and a 1 GB disk for homework.

Render's free plan works for a quick test, but it sleeps when nobody is using it (so the first game takes up to a minute to load) and has no disk, so homework is switched off.

### Fly.io (pay as you go, a few dollars a month)

With the [Fly command-line tool](https://fly.io/docs/flyctl/install/):

```
fly launch --copy-config --no-deploy    # pick a unique app name when asked
fly volumes create blurt_data --size 1
fly deploy
```

### Docker, on any server

```
docker build -t blurt .
docker run -d -p 3000:3000 -v blurt-data:/data --restart unless-stopped blurt
```

Put it behind a web server that handles HTTPS (Caddy does this automatically) and make sure it passes WebSocket connections through.

### Settings

All optional. Set them as environment variables on your host.

| Variable | What it does |
|---|---|
| `PORT` | Port to listen on (default 3000) |
| `DATA_DIR` | Where homework results are saved (default `./data`). Must survive restarts, so use your host's disk or volume. If it can't be written, Blurt still runs and simply hides homework. |
| `AI_API_KEY` | Turns on "Make with AI". Any OpenAI-compatible API works. Without it the button doesn't appear. |
| `AI_BASE_URL` | API address (default `https://api.openai.com/v1`) |
| `AI_MODEL` | Model name (default `gpt-4.1-mini`) |
| `TRUST_PROXY` | Set to `1` on Railway, Render, Fly or behind any proxy, so rate limits see real addresses |

Live games are held in memory, so restarting the server ends games in progress. Homework is saved to disk and deleted 30 days after its deadline. One small server comfortably runs many games at once.

## What's in it

**Making quizzes**
- Editor with all six question types, double or no points per question, time limits up to 4 minutes
- Pictures (upload or link) and YouTube clips, including a start time
- Import from a spreadsheet (CSV, or paste rows straight from Excel or Google Sheets), from a Blurt file, or from plain text
- Optional AI: make a quiz from a topic or a pasted text
- Folders, duplicate, share links (the whole quiz is in the link) and file download
- A built-in library of ready-made quizzes

**Hosting**
- QR code and PIN to join, lobby music and sound effects (all generated in the browser, no audio files)
- Teams (2 to 6, picked automatically, scored by average so team size doesn't matter)
- Random friendly nicknames, a rude-word filter, and click-to-remove in the lobby
- Lock the game, shuffle answers or questions, pause, add 10 seconds, skip
- Big-screen-only mode, where phones just show the coloured buttons
- Streak bonuses, leaderboard after every question, podium with confetti
- Download results as a spreadsheet, and see which questions the room found hardest

**Homework**
- Set a deadline and send a link. Students type their name and play alone, at their own pace.
- Answers are checked on the server one question at a time, so the answers can't be found in the page.
- A private results page with a question-by-question breakdown and a spreadsheet download
- Share buttons for Google Classroom and Microsoft Teams

## Writing quizzes as text

One question per block, a blank line between questions.

```
title: Space

Which planet is known as the Red Planet?
- Venus
* Mars
- Jupiter
time: 20
points: double

Type the answer: the name of our galaxy?
= Milky Way
= The Milky Way

Put these in order, closest to the Sun first
> Mercury
> Venus
> Earth

In which year did people first walk on the Moon?
range: 1950 to 2000
answer: 1969
margin: 2

Favourite planet?
type: poll
- Mars
- Saturn

One word for space
type: cloud
```

`*` marks a right answer (you can mark several), `=` an accepted typed answer, `>` an item in the right order. `time:`, `points:` (standard, double or none), `image:` and `video:` (a YouTube link) are optional.

## Spreadsheets

Columns: question, answer 1, answer 2, answer 3, answer 4, time limit, correct answer(s). The correct answer is a number from 1 to 4, or several, like `1,3`. A header row is optional.

## How scoring works

A right answer scores 500 to 1000 points: 1000 for an instant answer, falling to 500 as the clock runs out. Double-points questions score twice that. Each right answer in a row after the first adds a 100-point streak bonus, up to 500. Wrong answers, polls and word clouds score nothing. A question ends early once everyone connected has answered.

## For teachers

- Students need no account or email. Nicknames only exist for the length of the game.
- Turn on random nicknames to avoid silly names altogether.
- If a phone locks or drops off the Wi-Fi, it rejoins automatically with its score.
- If the host's page reloads, the game carries on where it was.

## Add a quiz to the library

Put a `.json` quiz in `public/library/`, add a line for it to `public/library/index.json`, run `npm test` (it checks every library quiz), and open a pull request.

## Development

```
npm test
```

- `server.js`: web server, WebSocket game server and the small JSON API
- `src/game.js`: live game rules (no networking, fully tested)
- `src/homework.js`: homework assignments and scoring
- `src/names.js`: nickname filter and random names
- `src/ai.js`: optional AI quiz writer
- `public/quiz.js`: quiz format, validation, text and spreadsheet import, shared by server and browser
- `public/*.html`, `public/*.js`: the pages, in plain JavaScript with no build step

## Licence

MIT. The QR code generator in `public/vendor/qrcode.js` is by Kazuhiko Arase, also MIT. Blurt is an independent project and is not affiliated with any other quiz game.
