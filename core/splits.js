const fs   = require('fs');
const path = require('path');
const { XMLParser, XMLBuilder } = require('fast-xml-parser');
const { atomicWrite, atomicWriteJson } = require('./fileUtils');

const DATA_DIR = path.join(__dirname, '..', 'data', 'splits');

// Ensure directory exists
fs.mkdirSync(DATA_DIR, { recursive: true });

// ─── Profile schema ────────────────────────────────────────────────────────────
//
// {
//   id:         string  (slug, used as filename)
//   game:       string
//   category:   string
//   attempts:   number
//   finished:   number
//   splits: [
//     { name, pb, gold, sobTime }   // all times in seconds
//   ]
// }

function profilePath(id) {
  // Prevent path traversal: id must be a safe slug (alphanumeric, hyphens, underscores)
  if (!id || !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
    throw new Error(`Invalid profile id: ${JSON.stringify(id)}`);
  }
  const p = path.join(DATA_DIR, `${id}.json`);
  // Defense in depth: resolved path must stay inside DATA_DIR
  if (!p.startsWith(DATA_DIR + path.sep)) {
    throw new Error(`Invalid profile id: ${JSON.stringify(id)}`);
  }
  return p;
}

function getAllProfiles() {
  const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
  return files.map(f => {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
      return { id: raw.id, game: raw.game, category: raw.category, attempts: raw.attempts };
    } catch {
      return null;
    }
  }).filter(Boolean);
}

function validateProfile(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Ungültiges Profil-Format');
  // Ensure required fields have correct types
  if (typeof raw.id !== 'string' || !raw.id) throw new Error('Profil hat keine ID');
  if (!Array.isArray(raw.splits)) raw.splits = [];
  raw.attempts       = Math.max(0, Number(raw.attempts)       || 0);
  raw.finished       = Math.max(0, Number(raw.finished)       || 0);
  raw.game           = String(raw.game     || '').slice(0, 500);
  raw.category       = String(raw.category || '').slice(0, 500);
  // Normalise each split — coerce numeric fields, cap string lengths
  raw.splits = raw.splits.map(s => ({
    name:    String(s.name    || '').slice(0, 200),
    pb:      (s.pb    != null && Number.isFinite(+s.pb))    ? +s.pb    : null,
    gold:    (s.gold  != null && Number.isFinite(+s.gold))  ? +s.gold  : null,
    sobTime: (s.sobTime != null && Number.isFinite(+s.sobTime)) ? +s.sobTime : null,
  }));
  return raw;
}

function loadProfile(id) {
  const p = profilePath(id);
  if (!fs.existsSync(p)) throw new Error(`Profile not found: ${id}`);
  return validateProfile(JSON.parse(fs.readFileSync(p, 'utf8')));
}

function saveProfile(data) {
  if (!data.id) {
    // Auto-generate slug from game + category
    data.id = slugify(`${data.game}-${data.category}`);
  }
  atomicWriteJson(profilePath(data.id), data);
  return data.id;
}

function deleteProfile(id) {
  const p = profilePath(id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// ─── LiveSplit .lss import ─────────────────────────────────────────────────────

function importLSS(filePath) {
  const xml = fs.readFileSync(filePath, 'utf8');
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const doc = parser.parse(xml);

  const run = doc.Run;
  const game     = run.GameName     || 'Unknown Game';
  const category = run.CategoryName || 'Any%';
  const attempts = parseInt(run['@_attempts'] || '0', 10);

  const segList = [].concat(run.Segments?.Segment || []);

  const splits = segList.map(seg => {
    const name = seg.Name || '';

    // fast-xml-parser returns a plain object for single-child nodes — [].concat() normalises both cases
    const splitTimes = [].concat(seg.SplitTimes?.SplitTime || []);
    const pbEntry    = splitTimes.find(t => t['@_name'] === 'Personal Best');
    const pbTime     = parseLSSTime(pbEntry?.RealTime);
    const goldSeg    = parseLSSTime(seg.BestSegmentTime?.RealTime);

    return {
      name,
      pb:      pbTime,
      gold:    goldSeg,
      sobTime: goldSeg,
    };
  });

  // Convert cumulative PB times to segment durations.
  // prev must only advance when a non-null PB is consumed; otherwise the
  // next valid segment would subtract an already-skipped gap and produce a
  // wrong (too-small) duration.
  let prev = 0;
  for (const s of splits) {
    if (s.pb !== null) {
      const seg = s.pb - prev;
      prev      = s.pb;   // advance only here, not when pb === null
      s.pb      = seg;
    }
  }

  const profile = {
    id:       slugify(`${game}-${category}`),
    game,
    category,
    attempts,
    finished: 0,
    splits,
  };

  // If a profile with the same slug already exists, preserve its attempt
  // counters so a re-import doesn't silently wipe run history.
  const existing = (() => {
    try { return loadProfile(profile.id); } catch { return null; }
  })();
  if (existing) {
    profile.attempts = existing.attempts;
    profile.finished = existing.finished;
  }

  saveProfile(profile);
  return profile;
}

// ─── LiveSplit .lss export ─────────────────────────────────────────────────────

function exportLSS(id, destPath) {
  const profile = loadProfile(id);
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@_', format: true });

  // Re-accumulate split times to get cumulative (LSS stores cumulative)
  let cumPb   = 0;
  const segments = profile.splits.map(s => {
    cumPb += (s.pb || 0);
    return {
      Name: s.name,
      SplitTimes: {
        SplitTime: { '@_name': 'Personal Best', RealTime: formatLSSTime(cumPb) },
      },
      BestSegmentTime: { RealTime: formatLSSTime(s.gold) },
      SegmentHistory: {},
    };
  });

  const doc = {
    Run: {
      '@_version': '1.7.0',
      '@_attempts': profile.attempts,
      GameIcon: '',
      GameName: profile.game,
      CategoryName: profile.category,
      Offset: '00:00:00',
      // AttemptCount as child element removed — LiveSplit reads the @attempts
      // attribute on <Run>; having both caused duplicate data in third-party parsers.
      AttemptHistory: {},
      Segments: { Segment: segments },
      AutoSplitterSettings: {},
    },
  };

  atomicWrite(destPath, builder.build(doc));
  return true;
}

// ─── Utilities ─────────────────────────────────────────────────────────────────

/** Parse "H:MM:SS.mmmmmmm" → seconds */
function parseLSSTime(str) {
  if (!str) return null;
  const m = str.match(/^(\d+):(\d{2}):(\d{2})\.(\d+)$/);
  if (!m) return null;
  return (
    parseInt(m[1], 10) * 3600 +
    parseInt(m[2], 10) * 60 +
    parseInt(m[3], 10) +
    parseFloat('0.' + m[4])
  );
}

/** seconds → "H:MM:SS.0000000" */
function formatLSSTime(secs) {
  if (secs === null || secs === undefined) return '00:00:00';
  const h  = Math.floor(secs / 3600);
  const m  = Math.floor((secs % 3600) / 60);
  const s  = secs % 60;
  return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(7).padStart(9, '0')}`;
}

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = { getAllProfiles, loadProfile, saveProfile, deleteProfile, importLSS, exportLSS };
