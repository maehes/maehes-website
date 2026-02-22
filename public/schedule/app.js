/**
 * 予定インポーター - app.js
 * テキスト入力から予定を抽出してICSファイルを生成する
 */

document.addEventListener('DOMContentLoaded', () => {
    // ─── DOM References ───────────────────────────────────────────
    const textInput = document.getElementById('text-input');
    const extractBtn = document.getElementById('extract-btn');
    const resultSection = document.getElementById('result-section');
    const eventsContainer = document.getElementById('events-container');
    const addEventBtn = document.getElementById('add-event-btn');
    const downloadIcsBtn = document.getElementById('download-ics-btn');

    let eventsList = [];

    // ─── Extract Button ───────────────────────────────────────────
    extractBtn.addEventListener('click', () => {
        const rawText = textInput.value.trim();
        if (!rawText) {
            alert('テキストを入力してください。');
            return;
        }

        eventsList = parseTextAndExtractEvents(rawText);
        renderEvents();

        if (eventsList.length > 0) {
            resultSection.style.display = 'block';
            resultSection.scrollIntoView({ behavior: 'smooth' });
        } else {
            alert('予定が見つかりませんでした。\n\n【入力例】\n3月20日 15:00〜16:00 ピアノ @市民センター\n3/25 10:00-12:00 サッカー練習');
        }
    });

    addEventBtn.addEventListener('click', () => {
        const today = new Date().toISOString().split('T')[0];
        eventsList.push({ date: today, startTime: '10:00', endTime: '11:00', title: '新しい予定', location: '' });
        renderEvents();
        eventsContainer.querySelector('.event-card:last-child')?.scrollIntoView({ behavior: 'smooth' });
    });

    downloadIcsBtn.addEventListener('click', () => {
        if (eventsList.length === 0) { alert('予定がありません。'); return; }
        downloadICS();
    });

    // ─── Event Parsing ────────────────────────────────────────────
    function parseTextAndExtractEvents(text) {
        const events = [];
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

        const now = new Date();
        let ctxYear = now.getFullYear();
        let ctxMonth = now.getMonth() + 1;
        let ctxDate = null;

        // Patterns
        const reMonthOnly = /^[^\d]*(\d{1,2})\s*月/;
        const reDateFull = /(\d{4})[年\/\-.](\d{1,2})[月\/\-.](\d{1,2})/;
        const reDateShort = /(\d{1,2})[月\/](\d{1,2})/;
        const reDayJa = /^(\d{1,2})\s*日?\s*[（(]?[日月火水木金土]?[）)]?$/;
        const reTimeRange = /(\d{1,2})[:：](\d{2})\s*[〜~\-－]\s*(\d{1,2})[:：](\d{2})/;
        const reTimeSingle = /(\d{1,2})[:：](\d{2})/;
        const reLocation = /[＠@]([^\s　]+)/;

        for (const line of lines) {
            // ── Track month context ──
            const mMo = line.match(reMonthOnly);
            if (mMo) ctxMonth = parseInt(mMo[1]);

            // ── Parse date ──
            let evDate = null;
            const mFull = line.match(reDateFull);
            const mShort = !mFull && line.match(reDateShort);
            const mDay = !mFull && !mShort && line.match(reDayJa);

            if (mFull) {
                ctxYear = parseInt(mFull[1]);
                ctxMonth = parseInt(mFull[2]);
                evDate = makeDate(ctxYear, ctxMonth, parseInt(mFull[3]));
            } else if (mShort) {
                ctxMonth = parseInt(mShort[1]);
                evDate = makeDate(ctxYear, ctxMonth, parseInt(mShort[2]));
            } else if (mDay) {
                evDate = makeDate(ctxYear, ctxMonth, parseInt(mDay[1]));
            }

            if (evDate) ctxDate = evDate;

            // ── Parse time ──
            const mRange = line.match(reTimeRange);
            const mSingle = !mRange && line.match(reTimeSingle);
            let startTime = null, endTime = null;

            if (mRange) {
                startTime = `${pad(mRange[1])}:${mRange[2]}`;
                endTime = `${pad(mRange[3])}:${mRange[4]}`;
            } else if (mSingle) {
                startTime = `${pad(mSingle[1])}:${mSingle[2]}`;
                endTime = addHour(startTime, 1);
            }

            // ── Parse location ──
            let location = '';
            const mLoc = line.match(reLocation);
            if (mLoc) location = mLoc[1].trim();

            // ── Only emit if we have date+time ──
            if (!startTime) continue;
            const useDate = evDate || ctxDate;
            if (!useDate) continue;

            const title = extractTitle(line, location);

            events.push({
                date: useDate,
                startTime,
                endTime: endTime || addHour(startTime, 1),
                title: title || '予定',
                location,
            });
        }
        return events;
    }

    function extractTitle(line, location) {
        let t = line;
        // Remove location
        t = t.replace(/[＠@][^\s　]*/g, '');
        // Remove time range
        t = t.replace(/\d{1,2}[:：]\d{2}\s*[〜~\-－]\s*\d{1,2}[:：]\d{2}/g, '');
        // Remove single time
        t = t.replace(/\d{1,2}[:：]\d{2}/g, '');
        // Remove full date
        t = t.replace(/\d{4}[年\/\-.]\d{1,2}[月\/\-.]\d{1,2}[日]?/g, '');
        // Remove m/d or m月d日 style date
        t = t.replace(/\d{1,2}[月\/]\d{1,2}[日]?/g, '');
        // Remove "20日(土)" style pattern
        t = t.replace(/\d{1,2}\s*日?\s*[（(][日月火水木金土][）)]/g, '');
        t = t.replace(/\d{1,2}\s*日/g, '');
        // Remove standalone weekday in parens: (月) (火) etc.
        t = t.replace(/[（(][日月火水木金土][）)]/g, '');
        // Remove bare weekday characters that appear alone (e.g. "土" "日")
        t = t.replace(/\s[日月火水木金土]\s/g, ' ');
        // Remove bullet marks and common list prefixes
        t = t.replace(/[・•◆◇■□▶▷→➡※★☆●○]\s*/g, '');
        // Remove leftover punctuation
        t = t.replace(/[-－〜~、。（）「」【】\[\]()]/g, ' ');
        t = t.replace(/\s+/g, ' ').trim();
        return t.slice(0, 10);
    }

    function makeDate(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
    function pad(n) { return String(n).padStart(2, '0'); }
    function addHour(time, h) {
        const [hh, mm] = time.split(':').map(Number);
        return `${pad((hh + h) % 24)}:${pad(mm)}`;
    }

    // ─── Render Events ────────────────────────────────────────────
    function renderEvents() {
        eventsContainer.innerHTML = '';
        eventsList.forEach((ev, idx) => eventsContainer.appendChild(createEventCard(ev, idx)));
    }

    function createEventCard(ev, idx) {
        const card = document.createElement('div');
        card.className = 'event-card';
        card.innerHTML = `
      <div class="event-header">
        <span class="event-num">予定 ${idx + 1}</span>
        <button class="btn-danger" data-idx="${idx}" title="削除">✕</button>
      </div>
      <div class="event-fields">
        <div class="event-field">
          <label>タイトル</label>
          <input type="text" id="ev-title-${idx}" value="${esc(ev.title)}" maxlength="50" />
        </div>
        <div class="event-field">
          <label>日付</label>
          <input type="date" id="ev-date-${idx}" value="${ev.date}" />
        </div>
        <div class="event-field">
          <label>時間</label>
          <div class="time-fields">
            <input type="time" id="ev-start-${idx}" value="${ev.startTime}" />
            <span class="time-sep">〜</span>
            <input type="time" id="ev-end-${idx}" value="${ev.endTime}" />
          </div>
        </div>
        <div class="event-field">
          <label>場所</label>
          <input type="text" id="ev-loc-${idx}" value="${esc(ev.location)}" />
        </div>
      </div>
    `;

        card.querySelectorAll('input').forEach(inp => {
            inp.addEventListener('change', () => syncCard(idx));
        });
        card.querySelector('[data-idx]').addEventListener('click', () => {
            eventsList.splice(idx, 1);
            renderEvents();
        });
        return card;
    }

    function syncCard(idx) {
        eventsList[idx] = {
            title: document.getElementById(`ev-title-${idx}`)?.value || '',
            date: document.getElementById(`ev-date-${idx}`)?.value || '',
            startTime: document.getElementById(`ev-start-${idx}`)?.value || '00:00',
            endTime: document.getElementById(`ev-end-${idx}`)?.value || '01:00',
            location: document.getElementById(`ev-loc-${idx}`)?.value || '',
        };
    }

    function esc(str) {
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    // ─── ICS Generation ───────────────────────────────────────────
    function downloadICS() {
        // Sync latest edits from DOM
        eventsList.forEach((_, idx) => syncCard(idx));

        const now = new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15) + 'Z';
        const escIcs = s => String(s).replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');

        const lines = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//Schedule Importer for Kids//JA',
            'CALSCALE:GREGORIAN',
            'X-WR-CALNAME:習い事スケジュール',
            'X-WR-TIMEZONE:Asia/Tokyo',
        ];

        eventsList.forEach((ev, i) => {
            if (!ev.date || !ev.startTime) return;
            const dtStart = ev.date.replace(/-/g, '') + 'T' + ev.startTime.replace(':', '') + '00';
            const dtEnd = ev.date.replace(/-/g, '') + 'T' + (ev.endTime || addHour(ev.startTime, 1)).replace(':', '') + '00';
            lines.push(
                'BEGIN:VEVENT',
                `UID:${now}-${i}@schedule-importer`,
                `DTSTAMP:${now}`,
                `DTSTART;TZID=Asia/Tokyo:${dtStart}`,
                `DTEND;TZID=Asia/Tokyo:${dtEnd}`,
                `SUMMARY:${escIcs(ev.title)}`,
                ...(ev.location ? [`LOCATION:${escIcs(ev.location)}`] : []),
                'END:VEVENT',
            );
        });

        lines.push('END:VCALENDAR');
        const content = lines.join('\r\n');
        const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement('a'), { href: url, download: '習い事スケジュール.ics' });
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
});
