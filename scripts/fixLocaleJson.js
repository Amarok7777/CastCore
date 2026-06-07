'use strict';
const fs = require('fs');

function fixFile(file) {
  let text = fs.readFileSync(file, 'utf8');

  // 1. Replace literal newlines inside JSON string values with \n
  //    (these break JSON - only allowed as \\n)
  //    We do this carefully: only inside quoted strings
  let result = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      result += ch;
      escaped = false;
      continue;
    }
    if (ch === '\\') {
      result += ch;
      escaped = true;
      continue;
    }
    if (ch === '"' && !escaped) {
      inString = !inString;
      result += ch;
      continue;
    }
    if (inString && (ch === '\n' || ch === '\r')) {
      result += (ch === '\n') ? '\\n' : '\\r';
      continue;
    }
    result += ch;
  }
  text = result;

  // 2. Fix ASCII " that closes a German opening quote „...
  //    „text" → „text" (closing " → U+201D right double quotation mark)
  text = text.replace(/(„[^"\\]*?)"/g, (m, before) => before + '”');

  // 3. Fix ASCII " before </strong> or </code>
  text = text.replace(/"(<\/(strong|code|b)>)/g, '”$1');

  try {
    const parsed = JSON.parse(text);
    fs.writeFileSync(file, text, 'utf8');
    console.log('OK:', file.split(/[/\\]/).pop(), Object.keys(parsed).length, 'keys');
  } catch (e) {
    const pos = parseInt((e.message.match(/position (\d+)/) || [])[1] || '0');
    const snippet = text.substring(Math.max(0, pos - 50), pos + 50);
    console.error('STILL INVALID:', e.message);
    console.error('Around pos', pos, ':\n', JSON.stringify(snippet));
  }
}

fixFile('./shared/locales/de.json');
fixFile('./shared/locales/en.json');
