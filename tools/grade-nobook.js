// Сверка ответов «без книги» с ключом: какие вопросы угадываются по форме (шаг 7 конвейера).
// Запуск из корня проекта: node tools/grade-nobook.js source/blind/<файл ответов>.json
// Файл ответов: { "<id главы>" | "section-<id раздела>": [{ n, answer, confidence, cue: [], note }] }
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const root = process.cwd();
global.window = global;
global.self = global;
vm.runInThisContext(fs.readFileSync(path.join(root, 'content', 'book.js'), 'utf8'));
// Все файлы глав из папки, а не из списка: новую главу проверяют до подключения к странице.
fs.readdirSync(path.join(root, 'content'))
  .filter((f) => f.endsWith('.js') && f !== 'book.js' && f !== 'files.js')
  .forEach((f) => vm.runInThisContext(fs.readFileSync(path.join(root, 'content', f), 'utf8')));

const answers = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
// Брак — подсказки формы. Сюжет ситуации обязан показывать понятие, это не брак.
const GOOD = ['знание', 'наугад', 'сюжет', 'прошлый тест'];
const SOFT = ['пересказ', 'здравый смысл', 'антиподсказка'];
let totalAll = 0;
let flaggedAll = 0;

Object.keys(answers).forEach((id) => {
  const quiz = BOOK.units[id] ? BOOK.units[id].quiz : BOOK.sectionQuiz[id.replace(/^section-/, '')];
  if (!quiz) { console.log(id + ': теста нет'); return; }
  let right = 0;
  let lost = 0;
  const flagged = [];
  answers[id].forEach((a) => {
    const q = quiz.find((item) => item.options.some((o) => o.t === a.answer));
    if (!q) { lost += 1; return; }
    const ok = q.options[q.correct].t === a.answer;
    if (ok) right += 1;
    const cues = (a.cue || []).filter((c) => !GOOD.includes(c));
    if (ok && cues.length && a.confidence !== 'наугад') {
      const hard = cues.some((c) => !SOFT.includes(c));
      flagged.push('  ' + (hard ? 'ФОРМА ' : 'мягко ') + (quiz.indexOf(q) + 1) + ' [' + a.confidence + '; ' + cues.join(', ') + '] ' + (a.note || ''));
    }
  });
  totalAll += quiz.length;
  flaggedAll += flagged.length;
  console.log(id + ': вопросов ' + quiz.length + ', без книги верно ' + right + ', не найдено в ключе ' + lost +
    ', угадано по форме ' + flagged.length);
  flagged.forEach((line) => console.log(line));
});
console.log('итого: по форме угадано ' + flaggedAll + ' из ' + totalAll);
