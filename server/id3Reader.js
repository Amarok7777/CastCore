const jsmediatags = require('jsmediatags');
const fs = require('fs');
const path = require('path');

class ID3Reader {
  async readMetadata(filePath) {
    return new Promise((resolve, reject) => {
      if (!filePath || filePath.trim() === '') {
        return reject(new Error('Kein Dateipfad angegeben'));
      }

      const ext = path.extname(filePath).toLowerCase();

      // Nicht-Audio-Dateien: Fallback auf Dateinamen
      const supportedFormats = ['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wma'];
      if (!supportedFormats.includes(ext)) {
        const filename = path.basename(filePath, ext) || path.basename(filePath);
        return resolve({ title: filename, artist: '', album: '', year: '', genre: '', track: '', filename: path.basename(filePath), filepath: filePath });
      }

      // Prüfe ob Datei existiert
      if (!fs.existsSync(filePath)) {
        return reject(new Error(`Datei nicht gefunden: ${filePath}`));
      }

      try {
        jsmediatags.read(filePath, {
          onSuccess: (tag) => {
            const tags = tag.tags;
            const metadata = {
              title:    this.getString(tags, 'title'),
              artist:   this.getString(tags, 'artist'),
              album:    this.getString(tags, 'album'),
              year:     this.getString(tags, 'year'),
              genre:    this.getString(tags, 'genre'),
              track:    this.getString(tags, 'track'),
              filename: path.basename(filePath),
              filepath: filePath,
              coverArt: this.getCoverArt(tags),
            };
            resolve(metadata);
          },
          onError: (error) => {
            // Wenn Tags nicht gelesen werden können, nutze Dateinamen
            const filename = path.basename(filePath, ext);
            const metadata = {
              title: filename,
              artist: '',
              album: '',
              year: '',
              genre: '',
              track: '',
              filename: path.basename(filePath),
              filepath: filePath,
            };
            resolve(metadata);
          },
        });
      } catch (err) {
        reject(new Error(`Fehler beim Lesen von ${filePath}: ${err.message}`));
      }
    });
  }

  getCoverArt(tags) {
    const pic = tags?.picture;
    if (!pic?.data) return null;
    try {
      const mime = pic.format || 'image/jpeg';
      const bytes = Array.isArray(pic.data) ? Buffer.from(pic.data) : Buffer.from(Object.values(pic.data));
      return `data:${mime};base64,${bytes.toString('base64')}`;
    } catch {
      return null;
    }
  }

  getString(tags, key) {
    const value = tags?.[key];
    if (typeof value === 'string') {
      return value.trim();
    }
    if (value?.data) {
      return String(value.data).trim();
    }
    return '';
  }

  async readDuration(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    try {
      if (ext === '.wav') return this._wavDuration(filePath);
      if (ext === '.flac') return this._flacDuration(filePath);
      return null;
    } catch {
      return null;
    }
  }

  _wavDuration(filePath) {
    const fd = fs.openSync(filePath, 'r');
    try {
      const head = Buffer.alloc(12);
      if (fs.readSync(fd, head, 0, 12, 0) < 12) return null;
      if (head.slice(0, 4).toString('ascii') !== 'RIFF') return null;
      if (head.slice(8, 12).toString('ascii') !== 'WAVE') return null;

      const chunk = Buffer.alloc(8);
      let pos = 12;
      let byteRate = 0;
      let dataSize = 0;
      let iters = 0;

      while (iters++ < 100) {
        if (fs.readSync(fd, chunk, 0, 8, pos) < 8) break;
        const tag = chunk.slice(0, 4).toString('ascii');
        const size = chunk.readUInt32LE(4);
        if (tag === 'fmt ') {
          const fmt = Buffer.alloc(Math.min(size, 16));
          fs.readSync(fd, fmt, 0, fmt.length, pos + 8);
          byteRate = fmt.readUInt32LE(8);
        } else if (tag === 'data') {
          dataSize = size;
          break;
        }
        pos += 8 + size + (size & 1); // RIFF chunks are word-aligned
      }

      if (!byteRate || !dataSize) return null;
      return dataSize / byteRate;
    } finally {
      fs.closeSync(fd);
    }
  }

  _flacDuration(filePath) {
    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(42);
      if (fs.readSync(fd, buf, 0, 42, 0) < 42) return null;
      if (buf.slice(0, 4).toString('ascii') !== 'fLaC') return null;
      // STREAMINFO data starts at file offset 8 (4 magic + 4 block header)
      // Packed 64-bit field at offset 18–25:
      //   bits 63–44 = sample rate (20 bits)
      //   bits 43–41 = channels – 1 (3 bits)
      //   bits 40–36 = BPS – 1 (5 bits)
      //   bits 35–0  = total samples (36 bits)
      const sampleRate = ((buf[18] << 12) | (buf[19] << 4) | (buf[20] >> 4)) & 0xFFFFF;
      const totalSamples = (buf[21] & 0x0F) * 0x100000000
        + (buf[22] * 0x1000000) + ((buf[23] << 16) | (buf[24] << 8) | buf[25]);
      if (!sampleRate || !totalSamples) return null;
      return totalSamples / sampleRate;
    } finally {
      fs.closeSync(fd);
    }
  }

  async readFromDirectory(dirPath, limit = 1) {
    try {
      if (!fs.existsSync(dirPath)) {
        throw new Error(`Verzeichnis nicht gefunden: ${dirPath}`);
      }

      const files = fs.readdirSync(dirPath);
      const supportedFormats = ['.mp3', '.flac', '.ogg', '.m4a', '.aac', '.wma'];
      const audioFiles = files
        .filter((f) => supportedFormats.includes(path.extname(f).toLowerCase()))
        .slice(0, limit);

      if (audioFiles.length === 0) {
        return [];
      }

      const results = [];
      for (const file of audioFiles) {
        try {
          const fullPath = path.join(dirPath, file);
          const metadata = await this.readMetadata(fullPath);
          results.push(metadata);
        } catch (err) {
          console.warn(`[ID3Reader] Fehler bei ${file}:`, err.message);
        }
      }

      return results;
    } catch (err) {
      throw new Error(`Fehler beim Lesen des Verzeichnisses: ${err.message}`);
    }
  }
}

module.exports = new ID3Reader();
