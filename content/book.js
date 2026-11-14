// Оглавление. Новая глава: файл content/<id>.js с BOOK.unit({...}),
// строка в units нужного раздела ниже, тег <script> в index.html и путь в списке FILES в sw.js.
window.BOOK = {
  title: 'Берн. Игры, в которые играют люди',
  sections: [
    { id: 'intro', title: 'Введение', units: ['intro'] },
    { id: 'part1', title: 'Часть первая. Анализ игр', units: ['ch1', 'ch2'] }
  ],
  units: {},
  sectionQuiz: {},
  unit: function (u) { this.units[u.id] = u; },
  quizFor: function (sectionId, questions) { this.sectionQuiz[sectionId] = questions; }
};
