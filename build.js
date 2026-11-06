// src/* 를 하나의 HTML(dist/worktime.html)로 묶고, 웹 배포용 docs/ 를 만든다
const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
const script = (code) => `<script>\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;
const d = new Date(), p = (n) => String(n).padStart(2, '0');
const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;

const js = ['src/holidays.js', 'src/core.js', 'src/xlsx.js', 'src/app.js', 'src/main.js'].map(read).join('\n').replace('__BUILD__', stamp);
const html = read('src/app.html').replace('<!--JS-->', () => script(js));

fs.mkdirSync(path.join(__dirname, 'dist'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'dist/worktime.html'), html);

// 웹 배포용(GitHub Pages가 docs/ 폴더를 올림): 같은 HTML + 홈 화면 앱(manifest)·오프라인(sw.js) 파일
fs.mkdirSync(path.join(__dirname, 'docs'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'docs/index.html'),
  html.replace('</head>', '<link rel="manifest" href="manifest.webmanifest">\n<link rel="icon" href="icon-192.png">\n</head>'));
for (const f of fs.readdirSync(path.join(__dirname, 'web'))) fs.copyFileSync(path.join(__dirname, 'web', f), path.join(__dirname, 'docs', f));

console.log('dist/worktime.html', (Buffer.byteLength(html) / 1024).toFixed(0) + 'KB', stamp);
