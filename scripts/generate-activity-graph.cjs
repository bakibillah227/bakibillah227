const fs = require("fs");
const path = require("path");

const USERNAME = process.env.GRAPH_USERNAME || "bakibillah227";
const TOKEN = process.env.GITHUB_TOKEN || "";
const DAYS = 31;
const WIDTH = 1000;
const HEIGHT = 300;
const PLOT_LEFT = 55;
const PLOT_RIGHT = 985;
const PLOT_TOP = 72;
const PLOT_BOTTOM = 250;

const theme = {
    bg: "#1a1b27",
    color: "#70a5fd",
    line: "#70a5fd",
    point: "#a9b1d6",
    area: "#70a5fd",
};

function todayUtc() {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function isoDateInWindow(index) {
    return new Date(todayUtc() - (DAYS - 1 - index) * 86400000).toISOString().slice(0, 10);
}

function emptyCounts() {
    const counts = [];
    for (let i = 0; i < DAYS; i++) counts.push({ date: isoDateInWindow(i), count: 0 });
    return counts;
}

async function fetchGraphQL() {
    const query = `
      query userInfo($LOGIN: String!, $FROM: DateTime!, $TO: DateTime!) {
        user(login: $LOGIN) {
          name
          contributionsCollection(from: $FROM, to: $TO) {
            contributionCalendar {
              weeks {
                contributionDays {
                  contributionCount
                  date
                }
              }
            }
          }
        }
      }
    `;
    const from = new Date(todayUtc() - (DAYS - 1) * 86400000).toISOString();
    const to = new Date(todayUtc() + 86400000).toISOString();
    const res = await fetch("https://api.github.com/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Authorization: `bearer ${TOKEN}`,
        },
        body: JSON.stringify({ query, variables: { LOGIN: USERNAME, FROM: from, TO: to } }),
    });
    const json = await res.json();
    if (!res.ok || json.errors || !json.data || !json.data.user) {
        throw new Error("GraphQL request failed");
    }
    const weeks = json.data.user.contributionsCollection.contributionCalendar.weeks;
    const counts = emptyCounts();
    const byDate = {};
    for (const week of weeks) {
        for (const day of week.contributionDays) byDate[day.date] = day.contributionCount;
    }
    for (const entry of counts) entry.count = byDate[entry.date] || 0;
    return counts;
}

async function fetchEventsRest() {
    const counts = emptyCounts();
    const byDate = {};
    for (let page = 1; page <= 4; page++) {
        const url = `https://api.github.com/users/${USERNAME}/events/public?per_page=100&page=${page}`;
        const headers = { "User-Agent": "activity-graph-generator", Accept: "application/vnd.github+json" };
        if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
        const res = await fetch(url, { headers });
        if (!res.ok) throw new Error(`Events request failed: ${res.status}`);
        const events = await res.json();
        if (!Array.isArray(events) || events.length === 0) break;
        for (const event of events) {
            const date = new Date(event.created_at).toISOString().slice(0, 10);
            if (date < fromDateString() || date > new Date(todayUtc()).toISOString().slice(0, 10)) continue;
            const value = event.type === "PushEvent" ? (event.payload && event.payload.size) || 1 : 1;
            byDate[date] = (byDate[date] || 0) + value;
        }
        if (new Date(events[events.length - 1].created_at).getTime() < todayUtc() - (DAYS - 1) * 86400000) break;
    }
    for (const entry of counts) entry.count = byDate[entry.date] || 0;
    return counts;
}

function fromDateString() {
    return new Date(todayUtc() - (DAYS - 1) * 86400000).toISOString().slice(0, 10);
}

function buildSvg(counts) {
    const maxCount = Math.max(1, ...counts.map((c) => c.count));
    const plotWidth = PLOT_RIGHT - PLOT_LEFT;
    const plotHeight = PLOT_BOTTOM - PLOT_TOP;
    const step = plotWidth / (DAYS - 1);

    const x = (i) => PLOT_LEFT + i * step;
    const y = (count) => PLOT_BOTTOM - (count / maxCount) * plotHeight;

    const gridLines = [];
    for (let i = 0; i < DAYS; i += 5) {
        gridLines.push(`<line class="ct-grid" x1="${x(i).toFixed(2)}" y1="${PLOT_TOP}" x2="${x(i).toFixed(2)}" y2="${PLOT_BOTTOM}"/>`);
    }
    const yLabels = [];
    for (let f = 0; f <= 1; f += 0.25) {
        const gy = PLOT_BOTTOM - f * plotHeight;
        gridLines.push(`<line class="ct-grid" x1="${PLOT_LEFT}" y1="${gy.toFixed(2)}" x2="${PLOT_RIGHT}" y2="${gy.toFixed(2)}"/>`);
        yLabels.push(`<text class="label" x="${(PLOT_LEFT - 8).toFixed(2)}" y="${(gy + 4).toFixed(2)}" text-anchor="end">${Math.round(maxCount * f)}</text>`);
    }

    const linePoints = counts.map((c, i) => `${x(i).toFixed(2)},${y(c.count).toFixed(2)}`).join(" ");
    let areaD = `M ${x(0).toFixed(2)} ${PLOT_BOTTOM} L ${x(0).toFixed(2)} ${y(counts[0].count).toFixed(2)}`;
    for (let i = 1; i < DAYS; i++) {
        areaD += ` L ${x(i).toFixed(2)} ${y(counts[i].count).toFixed(2)}`;
    }
    areaD += ` L ${x(DAYS - 1).toFixed(2)} ${PLOT_BOTTOM} Z`;

    const points = counts.map((c, i) => `<circle class="ct-point" cx="${x(i).toFixed(2)}" cy="${y(c.count).toFixed(2)}" r="4"/>`);

    const dateLabels = [];
    for (let i = 0; i < DAYS; i += 5) {
        const dayOfMonth = parseInt(counts[i].date.slice(8, 10), 10);
        dateLabels.push(`<text class="label" x="${x(i).toFixed(2)}" y="${(PLOT_BOTTOM + 22).toFixed(2)}" text-anchor="middle">${dayOfMonth}</text>`);
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" fill="none" role="img" aria-label="${USERNAME}'s Contribution Graph">
  <style>
    .header { font: 600 20px 'Segoe UI', Ubuntu, Sans-Serif; }
    .label { font: 600 12px 'Segoe UI', Ubuntu, Sans-Serif; fill: ${theme["color"]}; }
    .ct-grid { stroke: ${theme["color"]}; stroke-opacity: 0.3; stroke-width: 1px; stroke-dasharray: 2px; }
    .ct-area { fill: ${theme["line"]}; fill-opacity: 0.15; }
    .ct-line { stroke: ${theme["line"]}; stroke-width: 4px; stroke-linejoin: round; stroke-linecap: round; }
    .ct-point { fill: ${theme["point"]}; }
  </style>
  <rect x="0" y="0" width="${WIDTH}" height="${HEIGHT}" rx="4.5" fill="${theme["bg"]}"/>
  <foreignObject x="0" y="0" width="${WIDTH}" height="55">
    <h1 xmlns="http://www.w3.org/1999/xhtml" class="header" style="text-align:center; color:${theme["color"]}; margin:18px 0 0 0;">${USERNAME}'s Contribution Graph</h1>
  </foreignObject>
  <g>
    ${gridLines.join("\n    ")}
  </g>
  <path class="ct-area" d="${areaD}"/>
  <polyline class="ct-line" points="${linePoints}"/>
  <g>
    ${points.join("\n    ")}
  </g>
  <g>
    ${yLabels.join("\n    ")}
    ${dateLabels.join("\n    ")}
  </g>
</svg>
`;
}

async function main() {
    let counts;
    try {
        if (TOKEN) {
            counts = await fetchGraphQL();
        } else {
            counts = await fetchEventsRest();
        }
    } catch (err) {
        console.error(err.message);
        process.exitCode = 1;
        return;
    }

    const outDir = path.join(__dirname, "..", "profile");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "activity.svg");
    fs.writeFileSync(outFile, buildSvg(counts));
    const total = counts.reduce((sum, c) => sum + c.count, 0);
    console.log(`Wrote ${outFile} (${DAYS} days, ${total} total contributions)`);
}

main();