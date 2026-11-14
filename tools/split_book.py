"""Режет fb2 первой книги на главы: тексты в <out>/text, рисунки в <out>/img, оглавление в файл.

Запуск: python -I tools/split_book.py <книга.fb2 или .fb2.zip> source docs/toc.md
Файл книги разбирается как данные: без XML-парсера, только разметка тегов.
"""
import base64
import html
import re
import sys
import zipfile
from pathlib import Path

TOKEN = re.compile(r"<(/?)([a-zA-Z][\w\-]*)([^>]*?)(/?)>|([^<]+)")


def load(path):
    path = Path(path)
    if path.suffix.lower() == ".zip":
        with zipfile.ZipFile(path) as z:
            name = [n for n in z.namelist() if n.lower().endswith(".fb2")][0]
            raw = z.read(name)
    else:
        raw = path.read_bytes()
    m = re.search(rb'encoding="([^"]+)"', raw[:200])
    return raw.decode(m.group(1).decode() if m else "utf-8", errors="replace")


def parse(fragment):
    """Дерево узлов: {'tag', 'attrs', 'kids'}; текст лежит строками в kids."""
    root = {"tag": "root", "attrs": "", "kids": []}
    stack = [root]
    for m in TOKEN.finditer(fragment):
        closing, tag, attrs, selfclose, text = m.groups()
        if text is not None:
            stack[-1]["kids"].append(html.unescape(text))
        elif closing:
            for i in range(len(stack) - 1, 0, -1):
                if stack[i]["tag"] == tag:
                    del stack[i:]
                    break
        else:
            node = {"tag": tag, "attrs": attrs, "kids": []}
            stack[-1]["kids"].append(node)
            if not selfclose:
                stack.append(node)
    return root


def inline(node):
    out = []
    for kid in node["kids"]:
        if isinstance(kid, str):
            out.append(kid)
        elif kid["tag"] == "a" and 'type="note"' in kid["attrs"]:
            out.append(" [прим. %s]" % re.sub(r"\D", "", inline(kid)))
        else:
            out.append(inline(kid))
    return re.sub(r"\s+", " ", "".join(out)).strip()


def title_of(section):
    for kid in section["kids"]:
        if not isinstance(kid, str) and kid["tag"] == "title":
            return [inline(p) for p in kid["kids"] if not isinstance(p, str)]
    return []


def subsections(section):
    return [k for k in section["kids"] if not isinstance(k, str) and k["tag"] == "section"]


def render(section, level, lines, images, notes):
    for kid in section["kids"]:
        if isinstance(kid, str):
            continue
        tag = kid["tag"]
        if tag == "title":
            lines.append("#" * level + " " + ". ".join(t for t in title_of(section) if t))
            lines.append("")
        elif tag == "section":
            render(kid, level + 1, lines, images, notes)
        elif tag == "p":
            text = inline(kid)
            notes.extend(re.findall(r"\[прим\. (\d+)\]", text))
            if text:
                lines.append(text)
                lines.append("")
        elif tag == "subtitle":
            lines.append("#" * (level + 1) + " " + inline(kid))
            lines.append("")
        elif tag == "image":
            m = re.search(r'href="#([^"]+)"', kid["attrs"])
            if m:
                images.append(m.group(1))
                lines.append("[рисунок %s]" % m.group(1))
                lines.append("")
        elif tag in ("poem", "stanza", "cite", "epigraph"):
            render(kid, level, lines, images, notes)
        elif tag == "v":
            lines.append(inline(kid))


def main():
    book, out, toc_path = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3])
    text = load(book)
    bodies = re.findall(r"<body[^>]*>.*?</body>", text, re.S)
    main_body = parse(bodies[0])["kids"][0]
    note_text = {}
    if len(bodies) > 1:
        for sec in subsections(parse(bodies[1])["kids"][0]):
            m = re.search(r'id="n_(\d+)"', sec["attrs"])
            if m:
                paras = [inline(k) for k in sec["kids"] if not isinstance(k, str) and k["tag"] == "p"]
                note_text[m.group(1)] = " ".join(paras)

    book1 = [s for s in subsections(main_body) if title_of(s) and title_of(s)[0].upper().startswith("ИГРЫ")][0]
    units = []  # (id, часть, заголовок, узел)
    for sec in subsections(book1):
        head = title_of(sec)
        first = head[0] if head else ""
        if first.startswith("Предисловие"):
            units.append(("preface", "", "Предисловие", sec))
        elif first.startswith("Введение"):
            units.append(("intro", "", "Введение", sec))
        elif first.startswith("Часть"):
            part = ". ".join(head)
            number = re.sub(r"\D", "", first)
            for ch in subsections(sec):
                ch_head = title_of(ch)
                if not ch_head:
                    continue
                if ch_head[0].startswith("Глава"):
                    units.append(("ch" + re.sub(r"\D", "", ch_head[0]), part, ". ".join(ch_head), ch))
                else:
                    slug = "intro" if ch_head[0].startswith("Введение") else "extra"
                    units.append(("part%s-%s" % (number, slug), part, ". ".join(ch_head), ch))

    (out / "text").mkdir(parents=True, exist_ok=True)
    (out / "img").mkdir(parents=True, exist_ok=True)
    rows = []
    for uid, part, head, node in units:
        lines, images, notes = [], [], []
        render(node, 1, lines, images, notes)
        seen = []
        for n in notes:
            if n not in seen:
                seen.append(n)
        if seen:
            lines.append("## Примечания издания")
            lines.append("")
            for n in seen:
                lines.append("[прим. %s] %s" % (n, note_text.get(n, "")))
                lines.append("")
        body = "\n".join(lines).strip() + "\n"
        with open(out / "text" / (uid + ".txt"), "w", encoding="utf-8", newline="\n") as f:
            f.write(body)
        subs = [". ".join(title_of(s)) for s in subsections(node) if title_of(s)]
        rows.append((uid, part, head, len(body), images, subs))

    for m in re.finditer(r'<binary id="([^"]+)"[^>]*>(.*?)</binary>', text, re.S):
        (out / "img" / m.group(1)).write_bytes(base64.b64decode(m.group(2)))

    toc = [
        "# Оглавление первой книги по изданию владельца",
        "",
        "Собрано `tools/split_book.py` из файла книги. Тексты глав лежат в `source/text/<id>.txt`.",
        "",
        "| id | Часть | Название в издании | Знаков | Рисунков | Подразделов |",
        "|---|---|---|---|---|---|",
    ]
    for uid, part, head, size, images, subs in rows:
        toc.append("| %s | %s | %s | %d | %d | %d |" % (uid, part, head, size, len(images), len(subs)))
    toc.append("")
    toc.append("## Подразделы и игры по главам")
    toc.append("")
    for uid, part, head, size, images, subs in rows:
        if subs:
            toc.append("- `%s`: %s" % (uid, "; ".join(subs)))
    toc.append("")
    with open(toc_path, "w", encoding="utf-8", newline="\n") as f:
        f.write("\n".join(toc))

    for uid, part, head, size, images, subs in rows:
        print("%-12s %7d зн. рис. %d подразд. %2d  %s" % (uid, size, len(images), len(subs), head))
    print("глав:", len(rows), "| рисунков в файле:", len(list((out / "img").iterdir())))


if __name__ == "__main__":
    main()
