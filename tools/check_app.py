"""Сквозной сценарий приложения на экране телефона и компьютера и работа без сети.

  python tools/check_app.py                      — поднимает свой сервер на свободном порту
  python tools/check_app.py --base <адрес>       — тот же сценарий по живой ссылке
  python tools/check_app.py --shots <папка>      — ещё и сохраняет снимки экранов

Сценарий берёт числа из самого материала (последняя глава в списке), поэтому новые главы
его не ломают. Части идут параллельно отдельными процессами.
"""
import argparse
import functools
import http.server
import os
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTS = ["375", "1440", "offline"]
SIZES = {"375": (375, 812), "1440": (1440, 900)}


def plural(n, one, few, many):
    a = abs(n) % 100
    b = a % 10
    if 10 < a < 20:
        return many
    if b == 1:
        return one
    if 2 <= b <= 4:
        return few
    return many


def cards_word(n):
    return plural(n, "карточка", "карточки", "карточек")


INFO_JS = """() => {
  const ids = [];
  BOOK.sections.forEach(s => s.units.forEach(id => { if (BOOK.units[id]) ids.push(id); }));
  const u = BOOK.units[ids[ids.length - 1]];
  const sec = BOOK.sections.find(s => BOOK.sectionQuiz[s.id]);
  return {
    book: BOOK.title, ids, titles: ids.map(id => BOOK.units[id].title),
    id: u.id, title: u.title, quiz: u.quiz.length, cards: u.cards.map(c => c.id),
    points: u.write[0].points.length,
    games: u.notes.filter(b => b.game).map(b => b.game.name),
    section: sec ? sec.id : null,
    sectionQuiz: sec ? BOOK.sectionQuiz[sec.id].length : 0,
  };
}"""

CORRECT_JS = """(q) => {
  const all = [];
  Object.values(BOOK.units).forEach(u => all.push(...u.quiz));
  Object.values(BOOK.sectionQuiz).forEach(l => all.push(...l));
  const item = all.find(x => x.q === q);
  return item.options[item.correct].t;
}"""

LAYOUT_JS = """() => {
  const small = [...document.querySelectorAll('a,button,textarea,label.check,summary')].filter(e => {
    const r = e.getBoundingClientRect();
    return r.width > 0 && (r.height < 44 || r.width < 24);
  }).map(e => e.textContent.trim().slice(0, 30) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
  const tiny = [...document.querySelectorAll('body *')].filter(e => {
    if (e.closest('svg')) return false;
    if (![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) return false;
    return parseFloat(getComputedStyle(e).fontSize) < 13;
  }).map(e => e.textContent.trim().slice(0, 30) + ' ' + getComputedStyle(e).fontSize);
  return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, small, tiny };
}"""


def run_part(part, base, shots):
    from playwright.sync_api import expect, sync_playwright

    problems = []

    def watch(page, tag):
        page.on("console", lambda m: m.type in ("error", "warning") and "blocked by Playwright" not in m.text
                and problems.append(f"{tag} консоль: {m.text}"))
        page.on("pageerror", lambda e: problems.append(f"{tag} ошибка страницы: {e}"))
        page.on("response", lambda r: r.status >= 400 and problems.append(f"{tag} ответ {r.status}: {r.url}"))

    with sync_playwright() as p:
        browser = p.chromium.launch()
        try:
            if part == "offline":
                ctx = browser.new_context(viewport={"width": 375, "height": 812})
                page = ctx.new_page()
                watch(page, "без сети")
                page.goto(base)
                expect(page.locator("h1")).to_be_visible()
                info = page.evaluate(INFO_JS)
                page.evaluate("() => navigator.serviceWorker.ready.then(() => true)")
                page.reload()
                page.wait_for_function("() => navigator.serviceWorker.controller !== null")
                ctx.set_offline(True)
                page.reload()
                expect(page.locator("h1")).to_have_text(info["book"])
                page.locator(f'a.row[href="#/u/{info["id"]}/notes"]').click()
                expect(page.locator("h1")).to_have_text(info["title"])
                expect(page.locator(".notes")).to_be_visible()
                ctx.close()
                print("без сети открывается: " + info["title"])
            else:
                width, height = SIZES[part]
                ctx = browser.new_context(viewport={"width": width, "height": height}, service_workers="block",
                                          device_scale_factor=2 if width < 500 else 1)
                page = ctx.new_page()
                watch(page, part)

                def step(name):
                    m = page.evaluate(LAYOUT_JS)
                    if m["sw"] > m["iw"] + 1:
                        problems.append(f"{part} {name}: прокрутка вбок {m['sw']} > {m['iw']}")
                    if m["small"]:
                        problems.append(f"{part} {name}: мелкие цели нажатия {m['small']}")
                    if m["tiny"]:
                        problems.append(f"{part} {name}: мелкий шрифт {m['tiny']}")
                    if shots:
                        page.screenshot(path=str(Path(shots) / f"{part}-{name}.png"))

                body = page.locator(".tab-body")
                page.goto(base)
                expect(page.locator("h1")).to_be_visible()
                info = page.evaluate(INFO_JS)
                uid, n, cards = info["id"], info["quiz"], info["cards"]
                # Строку главы ищем по ссылке: между главами на главной стоят строки тестов по разделам.
                row_meta = page.locator(f'a.row[href="#/u/{uid}/notes"] .row-meta')
                expect(page.locator("h1")).to_have_text(info["book"])
                expect(page.locator(".today")).to_contain_text("Повторять пока нечего")
                expect(page.locator(".row-meta").first).to_have_text("ещё не начата")
                step("01-home-empty")

                # конспект
                page.locator(f'a.row[href="#/u/{uid}/notes"]').click()
                expect(page.locator("h1")).to_have_text(info["title"])
                step("02-notes")

                # разбор игры: список игр ведёт к нужному разбору, разбор раскрывается и сворачивается
                games = info["games"]
                if games:
                    last = len(games) - 1
                    if last > 0:
                        jump = page.locator(".game-jump").nth(last)
                        expect(jump).to_contain_text(f"«{games[last]}»")
                        jump.click()
                    game = page.locator(f"#game-{last}")
                    if last > 0:
                        expect(page.locator(".game.is-current")).to_have_count(1)
                        expect(game).to_have_class("game is-current")
                    expect(game.locator(".game-name")).to_contain_text(games[last])
                    expect(game.locator(".game-name")).to_be_in_viewport()
                    under_tabs = page.evaluate(
                        """(i) => {
                          const h = document.querySelector('#game-' + i + ' .game-name').getBoundingClientRect();
                          const t = document.querySelector('.tabs').getBoundingClientRect();
                          return h.top < t.bottom - 1;
                        }""",
                        last,
                    )
                    if under_tabs:
                        problems.append(f"{part} разбор игры: название ушло под вкладки")
                    more = game.locator("details")
                    expect(more.locator("dl")).to_be_hidden()
                    more.locator("summary").click()
                    expect(more.locator("dl")).to_be_visible()
                    step("02-game-open")
                    more.locator("summary").click()
                    expect(more.locator("dl")).to_be_hidden()

                page.get_by_role("button", name="Отметить прочитанным").click()
                expect(page.locator(".done-line")).to_have_text("Конспект отмечен прочитанным")
                page.get_by_role("link", name="Перейти к тесту").click()

                # тест: первый ответ неверный и двойным нажатием, остальные верные
                expect(page.locator(".tab.is-current")).to_have_text("Тест")
                # на устройстве остался результат прежней версии теста, где вопросов было больше:
                # он не должен стать «лучшим» для нового теста
                page.evaluate(
                    """([id, total]) => {
                      const s = JSON.parse(localStorage.getItem('bern-progress-v1'));
                      s.quiz[id] = { best: total, last: total, total: total };
                      localStorage.setItem('bern-progress-v1', JSON.stringify(s));
                    }""",
                    [uid, n + 5],
                )
                page.reload()
                expect(body).to_contain_text(f"Лучший результат: {n + 5} из {n + 5}")
                page.get_by_role("button", name="Пройти тест ещё раз").click()
                for i in range(n):
                    expect(body.locator(".muted").first).to_have_text(f"Вопрос {i + 1} из {n}")
                    right = page.evaluate(CORRECT_JS, page.locator(".question").inner_text())
                    options = page.locator(".option")
                    if i == 0:
                        wrong = [options.nth(k) for k in range(4) if options.nth(k).inner_text() != right][0]
                        wrong.dblclick()
                        expect(page.locator(".verdict")).to_have_count(1)
                        expect(page.locator(".verdict")).to_have_text("Неверно")
                        expect(page.locator(".feedback")).to_contain_text("Почему не этот вариант")
                        expect(page.locator(".feedback")).to_contain_text("Разбор")
                        expect(page.locator(".option.is-right .option-tag")).to_have_text("верный ответ")
                        expect(page.locator(".option.is-wrong .option-tag")).to_have_text("твой ответ")
                        page.locator(".feedback").scroll_into_view_if_needed()
                        step("03-quiz-wrong")
                    else:
                        page.locator(".option", has_text=right).first.click()
                        expect(page.locator(".verdict")).to_have_text("Верно")
                        expect(page.locator(".feedback")).to_contain_text("Разбор")
                    page.locator(".feedback .btn-primary").click()
                    if i == 1:
                        # телефон выгрузил вкладку посреди теста: после перезагрузки тот же вопрос
                        expect(body.locator(".muted").first).to_have_text(f"Вопрос 3 из {n}")
                        page.reload()
                        expect(body.locator(".muted").first).to_have_text(f"Вопрос 3 из {n}")
                expect(body.locator("h2")).to_have_text(f"Результат: {n - 1} из {n}")
                step("04-quiz-result")
                page.reload()
                expect(body).to_contain_text(f"Лучший результат: {n - 1} из {n}")
                page.get_by_role("button", name="Пройти тест ещё раз").click()
                for i in range(n):
                    expect(body.locator(".muted").first).to_have_text(f"Вопрос {i + 1} из {n}")
                    right = page.evaluate(CORRECT_JS, page.locator(".question").inner_text())
                    options = page.locator(".option")
                    pick = [options.nth(k) for k in range(4) if (options.nth(k).inner_text() == right) != (i == 0)][0]
                    pick.click()
                    page.locator(".feedback .btn-primary").click()
                expect(body.locator("h2")).to_have_text(f"Результат: {n - 1} из {n}")
                page.get_by_role("button", name="Повторить вопросы с ошибкой").click()
                expect(body.locator(".muted").first).to_have_text("Вопрос 1 из 1")
                right = page.evaluate(CORRECT_JS, page.locator(".question").inner_text())
                page.locator(".option", has_text=right).first.click()
                page.locator(".feedback .btn-primary").click()
                expect(body).to_contain_text("Все вопросы с ошибкой теперь решены верно")

                # письменный вопрос
                answer = "Проверочный ответ: пара предложений своими словами."
                page.get_by_role("link", name="Письменно").click()
                first = page.locator(".write").first
                first.get_by_role("button", name="Сверить с эталоном").click()
                expect(first.locator(".field-hint").first).to_contain_text("Сначала напиши ответ")
                first.locator("textarea").fill(answer)
                first.get_by_role("button", name="Сверить с эталоном").click()
                expect(first.locator(".model")).to_contain_text("Эталонный ответ")
                first.locator(".check input").nth(0).check()
                first.locator(".check input").nth(info["points"] - 1).check()
                expect(first.locator(".model .muted")).to_have_text(f"Отмечено 2 из {info['points']}")
                first.locator(".model").scroll_into_view_if_needed()
                step("05-write")
                page.reload()
                first = page.locator(".write").first
                expect(first.locator("textarea")).to_have_value(answer)
                expect(first.locator(".model .muted")).to_have_text(f"Отмечено 2 из {info['points']}")

                # карточки
                total = len(cards)
                page.get_by_role("link", name="Карточки").click()
                expect(body.locator(".muted")).to_have_text(f"Осталось: {total} {cards_word(total)}")
                page.get_by_role("button", name="Показать ответ").click()
                expect(page.locator(".grade")).to_have_count(4)
                step("06-card")
                page.get_by_role("button", name="Снова").click()
                for left in range(total, 0, -1):
                    expect(body.locator(".muted")).to_have_text(f"Осталось: {left} {cards_word(left)}")
                    page.get_by_role("button", name="Показать ответ").click()
                    page.get_by_role("button", name="Хорошо").click()
                expect(body).to_contain_text("Все карточки этой главы на сегодня повторены. Ближайшее повторение:")
                page.get_by_role("button", name="Пройти все карточки вне расписания").click()
                page.get_by_role("button", name="Показать ответ").click()
                expect(page.locator(".grade")).to_have_count(2)

                # главная с прогрессом, общее повторение
                page.get_by_role("link", name="← Все главы").click()
                done = f"конспект прочитан, тест {n - 1} из {n}"
                expect(row_meta).to_have_text(done + ", карточки повторены")
                page.evaluate(
                    """(ids) => {
                      const s = JSON.parse(localStorage.getItem('bern-progress-v1'));
                      ids.forEach(id => { s.cards[id].due = Date.now() - 1000; });
                      localStorage.setItem('bern-progress-v1', JSON.stringify(s));
                    }""",
                    cards[:2],
                )
                page.reload()
                expect(page.locator(".today .btn")).to_have_text("Повторить 2 карточки")
                expect(row_meta).to_have_text(done + ", повторить 2 карточки")
                step("07-home-progress")
                page.locator(".today .btn").click()
                expect(page.locator("h1")).to_have_text("Повторение карточек")
                expect(page.locator(".flash-unit")).to_have_text(info["title"])
                for _ in range(2):
                    page.get_by_role("button", name="Показать ответ").click()
                    page.get_by_role("button", name="Легко").click()
                expect(body).to_contain_text("На сегодня всё повторено")
                page.get_by_role("link", name="К списку глав").click()

                # тест по разделу
                if info["section"]:
                    page.locator(f'a.row[href="#/s/{info["section"]}"]').click()
                    expect(page.locator("h1")).to_have_text("Тест по разделу")
                    page.get_by_role("button", name="Начать тест").click()
                    expect(body.locator(".muted").first).to_have_text(f"Вопрос 1 из {info['sectionQuiz']}")
                    step("08-section")

                # каждая глава открывается, схемы на месте
                for unit_id, title in zip(info["ids"], info["titles"]):
                    page.goto(base + f"#/u/{unit_id}/notes")
                    expect(page.locator("h1")).to_have_text(title)
                    expect(page.locator(".notes")).to_be_visible()
                    step(f"09-{unit_id}")
                    figures = page.locator(".figure")
                    for k in range(figures.count()):
                        figures.nth(k).scroll_into_view_if_needed()
                        expect(figures.nth(k).locator("svg")).to_be_visible()
                        if shots:
                            figures.nth(k).screenshot(path=str(Path(shots) / f"{part}-fig-{unit_id}-{k + 1}.png"))
                ctx.close()
                print(f"сценарий на {part} пройден: " + info["title"])
        finally:
            browser.close()

    for line in dict.fromkeys(problems):
        print("ПРОБЛЕМА " + line)
    return 1 if problems else 0


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--base")
    parser.add_argument("--shots")
    parser.add_argument("--part", choices=PARTS)
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    if args.part:
        sys.exit(run_part(args.part, args.base, args.shots))

    server = None
    base = args.base
    if not base:
        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *a, **k):
                pass

        handler = functools.partial(Quiet, directory=str(ROOT))
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        base = f"http://127.0.0.1:{server.server_address[1]}/"
    if args.shots:
        Path(args.shots).mkdir(parents=True, exist_ok=True)

    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    procs = []
    for part in PARTS:
        cmd = [sys.executable, str(Path(__file__).resolve()), "--part", part, "--base", base]
        if args.shots:
            cmd += ["--shots", args.shots]
        procs.append(subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                      encoding="utf-8", errors="replace", env=env))
    failed = False
    for part, proc in zip(PARTS, procs):
        out, _ = proc.communicate()
        print(out.strip())
        if proc.returncode:
            failed = True
            if "ПРОБЛЕМА" not in out:
                print(f"ПРОБЛЕМА часть {part} упала, вывод выше")
    if server:
        server.shutdown()
    print("ЕСТЬ ПРОБЛЕМЫ" if failed else "проблем нет")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
