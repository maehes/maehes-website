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

    // ─── Event Parsing (multi-line aware) ─────────────────────────
    /**
     * LINE messages often split events across multiple lines:
     *   ◆3月8日(日)◆           ← date header
     *   ⚽️選抜・育成卒団式       ← title line
     *   11:15〜12:45            ← time line
     *   @バディーフィールド       ← location line
     *
     * Strategy: iterate lines, carry forward pending date/title/location.
     * When we find a time, emit an event using all accumulated context.
     */
    function parseTextAndExtractEvents(text) {
        const events = [];
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

        const now = new Date();
        let ctxYear = now.getFullYear();
        let ctxMonth = now.getMonth() + 1;

        let pendingDates = [];
        let pendingTitle = '';
        let pendingLocation = '';

        // Regex patterns
        const reMonthCtx = /(\d{1,2})\s*月/;
        const reDateFull = /(\d{4})[年\/\-.](\d{1,2})[月\/\-.](\d{1,2})/;
        const reDateMD = /(\d{1,2})[月\/](\d{1,2})/g;
        const reDateDay = /(\d{1,2})\s*日/g;
        const reTimeRange = /(\d{1,2})[:：](\d{2})\s*[〜~\-－]\s*(\d{1,2})[:：](\d{2})/;
        const reTimeSingle = /(\d{1,2})[:：](\d{2})/;
        const reLocation = /[＠@]\s*(.+)/;
        const reLocationWord = /場所\s*[：:]\s*(.+)/;
        const reDateHeader = /^[◆◇■□▶▷★☆●○]+.*[◆◇■□▶▷★☆●○]+$/;
        const reOFF = /活動\s*OFF|活動\s*お?休み|^OFF$/i;

        function extractDatesFromLine(line) {
            const dates = [];
            const mFull = line.match(reDateFull);
            if (mFull) {
                ctxYear = parseInt(mFull[1]);
                ctxMonth = parseInt(mFull[2]);
                dates.push(makeDate(ctxYear, ctxMonth, parseInt(mFull[3])));
                return dates;
            }
            const mdMatches = [...line.matchAll(reDateMD)];
            if (mdMatches.length > 0) {
                ctxMonth = parseInt(mdMatches[0][1]);
                mdMatches.forEach(m => dates.push(makeDate(ctxYear, parseInt(m[1]), parseInt(m[2]))));
                return dates;
            }
            const dayMatches = [...line.matchAll(reDateDay)];
            if (dayMatches.length > 0) {
                dayMatches.forEach(m => dates.push(makeDate(ctxYear, ctxMonth, parseInt(m[1]))));
                return dates;
            }
            return dates;
        }

        function isTitleCandidate(line) {
            if (reTimeRange.test(line) || reTimeSingle.test(line)) return false;
            if (/^[＠@]/.test(line)) return false;
            if (/^※/.test(line)) return false;
            if (/^場所/.test(line)) return false;
            if (reOFF.test(line)) return false;
            // Strip emoji and decorators, check for real text
            const stripped = line.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}◆◇■□▶▷★☆●○※]/gu, '').trim();
            if (stripped.length < 2) return false;
            if (/^\d{1,2}[月\/]\d{1,2}/.test(stripped)) return false;
            return /[\u3040-\u30FF\u4E00-\u9FFFA-Za-z]/.test(stripped);
        }

        // ── Main loop ──
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];

            // Track month context
            const mMonth = line.match(reMonthCtx);
            if (mMonth) ctxMonth = parseInt(mMonth[1]);

            // ── Date header detection ──
            const lineDates = extractDatesFromLine(line);
            if (lineDates.length > 0 && reDateHeader.test(line)) {
                // Pure date header (◆3月8日(日)◆) → new block
                pendingDates = lineDates;
                pendingTitle = '';
                pendingLocation = '';
                continue;
            }
            if (lineDates.length > 0 && !reTimeRange.test(line) && !reTimeSingle.test(line)) {
                // Date line without time → probably a header
                pendingDates = lineDates;
                pendingTitle = '';
                pendingLocation = '';
                // But check if there's also title content after the date
                const titlePart = cleanTitle(line);
                if (titlePart.length >= 2 && isTitleCandidate(titlePart)) {
                    pendingTitle = titlePart;
                }
                continue;
            }

            // ── OFF detection ──
            if (reOFF.test(line)) {
                pendingTitle = '';
                pendingLocation = '';
                continue;
            }

            // ── Location detection ──
            const mLoc = line.match(reLocation);
            if (mLoc && !reTimeRange.test(line) && !reTimeSingle.test(line)) {
                pendingLocation = mLoc[1].trim();
                continue;
            }
            const mLocWord = line.match(reLocationWord);
            if (mLocWord) {
                pendingLocation = mLocWord[1].trim();
                continue;
            }

            // ── Time detection → EMIT EVENT ──
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

            if (startTime && pendingDates.length > 0) {
                // Build title: prefer pending, fallback to this line's content
                let title = pendingTitle || cleanTitle(line);
                if (!title || title.length < 2) title = '予定';

                // Check inline location
                if (!pendingLocation && mLoc) {
                    pendingLocation = mLoc[1].trim();
                }

                // Look ahead for location
                if (!pendingLocation) {
                    for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
                        const ahead = lines[j];
                        if (reLocation.test(ahead)) {
                            pendingLocation = ahead.match(reLocation)[1].trim();
                            break;
                        }
                        // Stop look-ahead if we hit a new date header or time
                        if (reDateHeader.test(ahead) || extractDatesFromLine(ahead).length > 0) break;
                    }
                }

                // Emit for each pending date
                pendingDates.forEach(d => {
                    events.push({
                        date: d,
                        startTime,
                        endTime: endTime || addHour(startTime, 1),
                        title,
                        location: pendingLocation,
                    });
                });

                pendingTitle = '';
                pendingLocation = '';
                continue;
            }

            // ── Title candidate line ──
            if (isTitleCandidate(line) && pendingDates.length > 0) {
                pendingTitle = cleanTitle(line);

                // Handle "時間未定" — emit with placeholder time
                const nextLine = i + 1 < lines.length ? lines[i + 1] : '';
                if (/時間未定|時間調整中|時間は後日/.test(line) || /時間未定|時間調整中|時間は後日/.test(nextLine)) {
                    // Look ahead for location
                    for (let j = i + 1; j < lines.length && j <= i + 3; j++) {
                        if (reLocation.test(lines[j])) {
                            pendingLocation = lines[j].match(reLocation)[1].trim();
                            break;
                        }
                    }
                    pendingDates.forEach(d => {
                        events.push({
                            date: d,
                            startTime: '09:00',
                            endTime: '17:00',
                            title: pendingTitle || '予定',
                            location: pendingLocation,
                        });
                    });
                    pendingTitle = '';
                    pendingLocation = '';
                }
            }
        }
        return events;
    }

    function cleanTitle(raw) {
        let t = raw;
        // Remove emoji
        t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}]/gu, '');
        // Remove decorators and bullets
        t = t.replace(/[◆◇■□▶▷★☆●○※・•→➡]/g, '');
        // Remove time patterns
        t = t.replace(/\d{1,2}[:：]\d{2}\s*[〜~\-－]\s*\d{1,2}[:：]\d{2}/g, '');
        t = t.replace(/\d{1,2}[:：]\d{2}/g, '');
        // Remove date patterns
        t = t.replace(/\d{4}[年\/\-.]\d{1,2}[月\/\-.]\d{1,2}[日]?/g, '');
        t = t.replace(/\d{1,2}[月\/]\d{1,2}[日]?/g, '');
        t = t.replace(/\d{1,2}\s*日?\s*[（(][日月火水木金土祝]+[）)]/g, '');
        t = t.replace(/\d{1,2}\s*日/g, '');
        t = t.replace(/[（(][日月火水木金土祝]+[）)]/g, '');
        // Remove location
        t = t.replace(/[＠@][^\s　]*/g, '');
        // Remove punctuation
        t = t.replace(/[-－〜~、。（）「」【】\[\]()]/g, ' ');
        t = t.replace(/\s+/g, ' ').trim();
        return t.slice(0, 15);
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
