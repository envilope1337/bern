// Проверка материала глав. Запуск из корня репозитория:
//   node tools/check-content.js                 — все правила, код выхода 1 при любом замечании
//   node tools/check-content.js --dump <файл>   — весь текст материала одним файлом для сканера
//   node tools/check-content.js --blind <id> <файл> — вопросы без отметки верного ответа
//   node tools/check-content.js --grade <id> <файл> — сверить ответы решавшего вслепую с ключом
//   ключ --only <id> в любом режиме берёт один файл content/<id>.js: так главу проверяют,
//   пока соседние файлы пишут другие исполнители
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const RU = 'а-яёА-ЯЁ';
let only = null;
if (args.includes('--only')) only = args.splice(args.indexOf('--only'), 2)[1];

// ---------- загрузка ----------

const ctx = { window: {}, self: {} };
vm.createContext(ctx);
function run(file) {
  vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), ctx, { filename: file });
}
run('content/book.js');
ctx.BOOK = ctx.window.BOOK;
const SERVICE = ['book.js', 'files.js'];
const files = fs.readdirSync(path.join(root, 'content'))
  .filter((f) => f.endsWith('.js') && !SERVICE.includes(f) && (!only || f === only + '.js')).sort();
files.forEach((f) => run('content/' + f));
const BOOK = ctx.BOOK;

const quizzes = []; // { label, id, source, list }
Object.values(BOOK.units).forEach((u) => quizzes.push({ label: u.id, id: u.id, list: u.quiz || [] }));
Object.entries(BOOK.sectionQuiz).forEach(([id, list]) => quizzes.push({ label: 'раздел ' + id, id: 'section-' + id, list }));

function notesText(unit, withSimple) {
  const out = [];
  (unit.notes || []).forEach((b) => {
    if (b.h) out.push(b.h);
    else if (b.p) out.push(b.p);
    else if (b.list) out.push(...b.list);
    else if (b.term) out.push(b.term + '. ' + b.def + (withSimple && b.simple ? ' ' + b.simple : ''));
    else if (b.ex) out.push(b.ex);
    else if (b.dia) out.push(b.dia.caption || '');
    else if (b.game) out.push(Object.values(b.game).flat().filter((v) => typeof v === 'string').join(' '));
  });
  return out;
}

function unitStrings(unit) {
  const out = notesText(unit, true);
  (unit.quiz || []).forEach((q) => out.push(q.q, ...q.options.map((o) => o.t + ' ' + (o.why || '')), q.explain || ''));
  (unit.write || []).forEach((w) => out.push(w.q, w.model, ...w.points));
  (unit.cards || []).forEach((c) => out.push(c.q + '. ' + c.a));
  return out;
}

// ---------- служебные режимы ----------

if (args[0] === '--dump') {
  const out = [];
  Object.values(BOOK.units).forEach((u) => out.push('# ' + u.title, '', ...unitStrings(u).map((s) => s + '\n')));
  Object.values(BOOK.sectionQuiz).forEach((list) => list.forEach((q) => {
    out.push(q.q, ...q.options.map((o) => o.t + ' ' + (o.why || '')), q.explain || '', '');
  }));
  fs.writeFileSync(args[1], out.join('\n'), 'utf8');
  console.log('текст выгружен:', args[1], 'знаков', out.join('\n').length);
  process.exit(0);
}

if (args[0] === '--blind') {
  const quiz = quizzes.find((x) => x.id === args[1]);
  if (!quiz) { console.error('нет теста с id', args[1]); process.exit(2); }
  // Варианты переставлены по алфавиту: порядок в данных выдаёт верный ответ.
  const blind = quiz.list.map((q, i) => ({
    n: i + 1,
    q: q.q,
    options: q.options.map((o) => o.t).sort((a, b) => a.localeCompare(b, 'ru'))
  }));
  fs.writeFileSync(args[2], JSON.stringify(blind, null, 2), 'utf8');
  console.log('вопросов без ответов:', blind.length, '→', args[2]);
  process.exit(0);
}

if (args[0] === '--grade') {
  const quiz = quizzes.find((x) => x.id === args[1]);
  if (!quiz) { console.error('нет теста с id', args[1]); process.exit(2); }
  const answers = JSON.parse(fs.readFileSync(args[2], 'utf8'));
  let bad = 0;
  quiz.list.forEach((q, i) => {
    const given = answers.find((a) => a.n === i + 1);
    const key = q.options[q.correct].t;
    if (!given) { bad += 1; console.log('вопрос ' + (i + 1) + ': нет ответа'); return; }
    if (given.answer !== key) {
      bad += 1;
      console.log('вопрос ' + (i + 1) + ': ответ не совпал с ключом\n  вопрос: ' + q.q + '\n  ключ: ' + key + '\n  решавший: ' + given.answer + '\n  довод: ' + (given.note || ''));
    }
    if (given.also && given.also.length) {
      bad += 1;
      console.log('вопрос ' + (i + 1) + ': решавший считает верными ещё и: ' + given.also.join(' | ') + '\n  вопрос: ' + q.q + '\n  довод: ' + (given.note || ''));
    }
  });
  console.log(args[1] + ': спорных вопросов ' + bad + ' из ' + quiz.list.length);
  process.exit(bad ? 1 : 0);
}

// ---------- правила ----------

const remarks = [];
const say = (where, text) => remarks.push(where + ': ' + text);

// 1, 3, 4. Тесты
quizzes.forEach(({ label, list }) => {
  let longest = 0;
  let ratio = 0;
  let cases = 0;
  list.forEach((q, i) => {
    const where = label + ', вопрос ' + (i + 1);
    if (!Array.isArray(q.options) || q.options.length !== 4) { say(where, 'вариантов не четыре'); return; }
    if (!q.options[q.correct]) { say(where, 'нет верного варианта'); return; }
    q.options.forEach((o, j) => { if (j !== q.correct && !o.why) say(where, 'у неверного варианта ' + (j + 1) + ' нет объяснения'); });
    if (!q.explain) say(where, 'нет разбора');
    if (q.kind !== 'case' && q.kind !== 'fact') say(where, 'нет пометки kind: case или fact');
    if (q.kind === 'case') cases += 1;
    const lens = q.options.map((o) => o.t.length);
    const wrong = lens.filter((_, j) => j !== q.correct);
    if (lens[q.correct] > Math.max(...wrong)) longest += 1;
    ratio += lens[q.correct] / (wrong.reduce((a, b) => a + b, 0) / wrong.length);
  });
  if (!list.length) return;
  if (longest > list.length / 3) say(label, 'верный вариант самый длинный в ' + longest + ' вопросах из ' + list.length + ', можно не больше трети');
  if (ratio / list.length > 1.25) say(label, 'верный вариант в среднем длиннее неверных в ' + (ratio / list.length).toFixed(2) + ' раза, можно до 1,25');
  if (list.length >= 6 && cases < list.length / 2) say(label, 'вопросов-ситуаций ' + cases + ' из ' + list.length + ', нужно не меньше половины');
});

// 10. Форма не выдаёт ответ: слова-абсолюты и оговорки стоят в верных и неверных вариантах
// одинаково часто. Грубая сетка: нелепые варианты и пересказ условия ловит только решение
// теста без книги (шаг конвейера), это правило его не заменяет.
const ABSOLUTE = /(^|[^а-яё])(всегда|никогда|только|лишь|никто|ничего|ничто|никак|навсегда|ровно|постоянно|обязательно|вообще|полностью|никак(ой|ая|ое|ие|ого|их|ую)|люб(ой|ая|ое|ые|ого|ую|ых|ым))(?![а-яё])/i;
const HEDGE = /(^|[^а-яё])(может|могут|обычно|бывает|бывают|иногда|порой|часто|чаще|в основном|как правило|скорее)(?![а-яё])/i;
quizzes.forEach(({ label, list }) => {
  const n = list.length;
  if (n < 6) return;
  const hits = { absRight: 0, absWrong: 0, hedgeRight: 0, hedgeWrong: 0 };
  list.forEach((q) => {
    if (!Array.isArray(q.options) || !q.options[q.correct]) return;
    q.options.forEach((o, j) => {
      const side = j === q.correct ? 'Right' : 'Wrong';
      if (ABSOLUTE.test(o.t)) hits['abs' + side] += 1;
      if (HEDGE.test(o.t)) hits['hedge' + side] += 1;
    });
  });
  if (hits.absWrong / (3 * n) - hits.absRight / n > 0.1) {
    say(label, 'слова вроде «всегда», «только», «никак» стоят в ' + hits.absWrong + ' неверных вариантах из ' + 3 * n +
      ' и в ' + hits.absRight + ' верных из ' + n + ': неверные снимаются по форме');
  }
  if (hits.hedgeRight / n - hits.hedgeWrong / (3 * n) > 0.1) {
    say(label, 'оговорки вроде «может», «обычно», «бывает» стоят в ' + hits.hedgeRight + ' верных вариантах из ' + n +
      ' и в ' + hits.hedgeWrong + ' неверных из ' + 3 * n + ': верный узнаётся по осторожному тону');
  }
});

// 2. id: уникальны и не пропадают относительно последнего коммита
const ids = new Map();
Object.values(BOOK.units).forEach((u) => {
  [...(u.cards || []), ...(u.write || [])].forEach((item) => {
    if (!item.id) { say(u.id, 'карточка или письменный вопрос без id'); return; }
    if (ids.has(item.id)) say(u.id, 'повтор id ' + item.id);
    ids.set(item.id, u.id);
    if (!item.id.startsWith(u.id + '-')) say(u.id, 'id ' + item.id + ' не начинается с id главы');
  });
});
files.forEach((f) => {
  let old = '';
  try {
    old = execSync('git show HEAD:content/' + f, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) { return; }
  (old.match(/id: '[^']+-[cw]\d+'/g) || []).forEach((m) => {
    const id = m.slice(5, -1);
    if (!ids.has(id)) say('content/' + f, 'пропал id ' + id + ': прогресс по нему на телефоне потеряется');
  });
});

// 5. Термины: есть в словаре, к каждому есть карточка
const glossaryPath = path.join(root, 'docs', 'glossary.md');
let glossary = null;
if (fs.existsSync(glossaryPath)) {
  glossary = new Set(fs.readFileSync(glossaryPath, 'utf8').split('\n')
    .filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
    .map((line) => line.split('|')[1].trim().toLowerCase()));
} else {
  say('docs/glossary.md', 'словаря нет');
}
Object.values(BOOK.units).forEach((u) => {
  (u.notes || []).filter((b) => b.term).forEach((b) => {
    const term = b.term.toLowerCase();
    if (glossary && !glossary.has(term)) say(u.id, 'термина «' + b.term + '» нет в docs/glossary.md');
    const stem = term.slice(0, Math.max(4, term.length - 2));
    if (!(u.cards || []).some((c) => c.q.toLowerCase().includes(stem))) say(u.id, 'к термину «' + b.term + '» нет карточки');
  });
});

// 6. Обращение к читателю и эталонные ответы без рода (реплики в «…» не считаются)
const NOUNS = ['дела', 'тела', 'числа', 'стола', 'угла', 'зла', 'села', 'школа', 'сила', 'правила', 'начала', 'стимул', 'сигнал', 'материал'];
const genderVerb = new RegExp('(?<![' + RU + '])(ты|я)\\s+(?:[' + RU + ']+[,:]?\\s+){0,4}?([' + RU + ']{3,}(?:л|ла|лся|лась))(?![' + RU + '])', 'gi');
const genderSelf = new RegExp('(?<![' + RU + '])(ты|я)\\s+(?:[' + RU + ']+[,:]?\\s+){0,3}?(сам|сама)(?![' + RU + '])', 'gi');
function genderCheck(where, text) {
  // «состояние Я» — термин, а не местоимение
  const plain = text.replace(/«[^»]*»/g, ' ').replace(/(состояни[а-яё]*)\s+Я(?![а-яё])/gi, '$1');
  let m;
  genderVerb.lastIndex = 0;
  while ((m = genderVerb.exec(plain))) {
    if (!NOUNS.includes(m[2].toLowerCase())) say(where, 'обращение по роду: «' + m[0] + '»');
  }
  genderSelf.lastIndex = 0;
  while ((m = genderSelf.exec(plain))) say(where, 'обращение по роду: «' + m[0] + '»');
}
Object.values(BOOK.units).forEach((u) => unitStrings(u).forEach((s) => genderCheck(u.id, s)));
Object.entries(BOOK.sectionQuiz).forEach(([id, list]) => list.forEach((q) => {
  [q.q, q.explain, ...q.options.map((o) => o.t + ' ' + (o.why || ''))].forEach((s) => genderCheck('раздел ' + id, s || ''));
}));

// 7. Конспект пересказывает, а не переписывает книгу
function words(text) {
  return text.toLowerCase().replace(/ё/g, 'е').replace(/[^а-яa-z0-9]+/g, ' ').trim().split(' ');
}
const RUN = 14; // общий с книгой кусок длиннее этого числа слов подряд считается списанным
Object.values(BOOK.units).forEach((u) => {
  const srcPath = path.join(root, 'source', 'text', u.id + '.txt');
  if (!fs.existsSync(srcPath)) return;
  const src = fs.readFileSync(srcPath, 'utf8');
  // Конспект — опора для повторения, а не замена книги: читатель главу уже прочёл.
  const own = notesText(u, false).join(' ');
  const all = notesText(u, true).join(' ');
  const share = src.length < 10000 ? 0.3 : 0.25;
  const limit = Math.round(src.length * share);
  const limitAll = Math.round(src.length * 0.4);
  if (own.length > limit) say(u.id, 'конспект без строк «Проще» ' + own.length + ' знаков, предел ' + limit + ' (' + share * 100 + '% главы)');
  if (all.length > limitAll) say(u.id, 'конспект вместе с «Проще» ' + all.length + ' знаков, предел ' + limitAll + ' (40% главы)');
  const srcWords = words(src);
  const grams = new Set();
  for (let i = 0; i + RUN <= srcWords.length; i++) grams.add(srcWords.slice(i, i + RUN).join(' '));
  unitStrings(u).forEach((s) => {
    const w = words(s);
    for (let i = 0; i + RUN <= w.length; i++) {
      const gram = w.slice(i, i + RUN).join(' ');
      if (grams.has(gram)) { say(u.id, 'кусок дословно из книги: «' + gram + '…»'); break; }
    }
  });
});

// 8. Карточки
Object.values(BOOK.units).forEach((u) => (u.cards || []).forEach((c) => {
  if (c.a.length > 200) say(u.id, 'ответ карточки ' + c.id + ' длиннее 200 знаков: ' + c.a.length);
}));

// 9. Список глав для страницы совпадает с файлами
const listPath = path.join(root, 'content', 'files.js');
if (!only && fs.existsSync(listPath)) {
  run('content/files.js');
  const listed = (ctx.self.BOOK_FILES || []).map((id) => id + '.js').sort();
  files.forEach((f) => { if (!listed.includes(f)) say('content/files.js', 'нет файла ' + f + ': глава не попадёт на страницу'); });
  listed.forEach((f) => { if (!files.includes(f)) say('content/files.js', 'в списке есть ' + f + ', а файла нет'); });
}
if (!only) {
  BOOK.sections.forEach((s) => s.units.forEach((id) => {
    if (!BOOK.units[id]) say('content/book.js', 'в разделе ' + s.id + ' указана глава ' + id + ', а её нет');
  }));
}

// ---------- итог ----------

Object.values(BOOK.units).forEach((u) => {
  console.log(u.id + ': блоков ' + (u.notes || []).length + ', вопросов ' + (u.quiz || []).length +
    ', письменных ' + (u.write || []).length + ', карточек ' + (u.cards || []).length);
});
Object.entries(BOOK.sectionQuiz).forEach(([id, list]) => console.log('раздел ' + id + ': вопросов ' + list.length));
remarks.forEach((r) => console.log('ЗАМЕЧАНИЕ ' + r));
console.log('замечаний: ' + remarks.length);
process.exit(remarks.length ? 1 : 0);
