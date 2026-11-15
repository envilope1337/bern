// Оглавление. Новая глава: файл content/<id>.js с BOOK.unit({...}),
// её id в units нужного раздела ниже и в списке content/files.js.
window.BOOK = {
  title: 'Берн. Игры, в которые играют люди',
  sections: [
    { id: 'intro', title: 'Введение', units: ['intro'] },
    { id: 'part1', title: 'Часть 1. Анализ игр', units: ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'] },
    { id: 'part2', title: 'Часть 2. Тезаурус игр', units: ['part2-intro'] }
  ],
  units: {},
  sectionQuiz: {},
  unit: function (u) { this.units[u.id] = u; },
  quizFor: function (sectionId, questions) { this.sectionQuiz[sectionId] = questions; }
};
