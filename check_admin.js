const fs = require('fs');
const content = fs.readFileSync('public/admin.html', 'utf-8');
const regex = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
let match;
const scripts = [];
while ((match = regex.exec(content)) !== null) {
  scripts.push(match[1]);
}
console.log('Found', scripts.length, 'script blocks');
for (let i = 0; i < scripts.length; i++) {
  console.log('Script', i, 'length:', scripts[i].length);
  try {
    new Function(scripts[i]);
    console.log('  -> OK');
  } catch(e) {
    console.log('  -> ERROR:', e.message);
  }
}