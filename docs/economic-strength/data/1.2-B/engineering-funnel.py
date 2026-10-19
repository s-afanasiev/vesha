#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
1.2-B. Инженерная воронка — сборка данных ВПО-1 (Минобрнауки).

Что делает (режим по умолчанию):
  1. Скачивает и распаковывает архивы ВПО-1 за 2020–2025 гг. (только главный свод
     «СВОД_ВПО1_ВСЕГО.xls/xlsx»; с --capitals — ещё региональные файлы Москвы и СПб).
  2. Парсит листы: 2.1.1 «Принято всего», 2.1.2(1) «1-й и 2-й курс», 2.1.3(1)
     «Выпуск фактический всего» по укрупнённым группам (первые две цифры кода).
  3. Собирает воронки (база когорты → выпуск; переход 1→2 курс) по 5 инженерным
     группам и уровням (бакалавриат / специалитет / магистратура).
  4. Пишет CSV: engineering-funnel.csv, engineering-capitals.csv (при --capitals).

Требования: Python 3.10+; pip install xlrd openpyxl.
Запуск из корня репозитория:
  python docs/economic-strength/data/1.2-B/engineering-funnel.py [--census] [--capitals]
"""
import argparse
import csv
import json
import os
import re
import sys
import urllib.parse
import urllib.request
import zipfile

import xlrd

sys.stdout.reconfigure(encoding="utf-8")

RAW = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "data", "economic-strength", "1.2-B", "raw"))
OUTDIR = os.path.abspath(os.path.dirname(__file__))

URLS = {
    2020: "https://minobrnauki.gov.ru/upload/2020/12/VPO-1_za_2020_g.zip",
    2021: "https://minobrnauki.gov.ru/upload/2021/12/Своды%20ВПО-1%202021%20г.zip",
    2022: "https://minobrnauki.gov.ru/upload/2022/12/ВПО-1%202022.zip",
    2023: "https://minobrnauki.gov.ru/upload/2023/12/Своды%20ВПО-1%202023%20г.zip",
    2024: "https://minobrnauki.gov.ru/upload/2024/12/Своды%20ВПО-1%202024%20г.zip",
    2025: "https://minobrnauki.gov.ru/upload/2025/12/Своды%20ВПО-1%202025.zip",
}

MAIN_RE = re.compile(r"^СВОД[ _-]?ВПО[ _-]?1[ _-]?ВСЕГО\.(xls|xlsx)$", re.IGNORECASE)
CAPITAL_RE = re.compile(r"^(г\.\s*)?(Москва|Санкт-Петербург)_", re.IGNORECASE)
CAPITAL_EXCLUDE_RE = re.compile(r"(Аттестация|Сведения)", re.IGNORECASE)
NUMBER_RE = re.compile(r"\d\.\d(?:\.\d)?\.")
CODE_RE = re.compile(r"^\d{2}\.\d{2}\.\d{2}$")

GROUPS = {
    "09": "ИТ и вычислительная техника",
    "15": "Машиностроение",
    "11": "Электроника и радиотехника",
    "13": "Электро- и теплоэнергетика",
    "04": "Химия",
    "18": "Химические технологии",
}

LEVELS = {
    "бакалавриат": "Программы бакалавриата",
    "специалитет": "Программы специалитета",
    "магистратура": "Программы магистратуры",
}


# ---------------------------------------------------------------- загрузка
def decode_zip_name(name: str) -> str:
    if re.search(r"[А-Яа-яЁё]", name):
        return name
    for enc in ("cp437", "cp1252"):
        try:
            cand = name.encode(enc).decode("cp866")
            if re.search(r"[А-Яа-яЁё]", cand):
                return cand
        except Exception:
            pass
    return name


def download(year: int) -> str:
    os.makedirs(RAW, exist_ok=True)
    out = os.path.join(RAW, f"VPO1-{year}.zip")
    if os.path.exists(out) and os.path.getsize(out) > 1_000_000:
        print(f"[{year}] архив уже есть: {os.path.getsize(out)} байт")
        return out
    url = urllib.parse.quote(URLS[year], safe=":/%")
    print(f"[{year}] качаю: {urllib.parse.unquote(url).split('/')[-1]}")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=600) as r, open(out, "wb") as f:
        total = 0
        while True:
            chunk = r.read(1024 * 1024)
            if not chunk:
                break
            f.write(chunk)
            total += len(chunk)
    print(f"[{year}] готово: {os.path.getsize(out)} байт")
    return out


def extract(year: int, zip_path: str, capitals: bool = False) -> str:
    """Распаковывает главный свод (и, при capitals=True, файлы столиц).
    2022: zip-в-zip — обрабатывается рекурсией."""
    dest = os.path.join(RAW, f"vpo1-{year}")
    os.makedirs(dest, exist_ok=True)
    wanted = []
    nested = []
    with zipfile.ZipFile(zip_path) as z:
        for info in z.infolist():
            if info.is_dir():
                continue
            raw_name = info.filename
            name = decode_zip_name(raw_name.split("/")[-1])
            if name.lower().endswith(".zip"):
                nested.append(info)
                continue
            take = bool(MAIN_RE.match(name)) or (
                capitals and CAPITAL_RE.match(name) and not CAPITAL_EXCLUDE_RE.search(name)
            )
            if take:
                parts = [decode_zip_name(p) for p in raw_name.split("/")]
                parts[-1] = name
                target = os.path.join(dest, *parts)
                os.makedirs(os.path.dirname(target), exist_ok=True)
                with z.open(info) as src, open(target, "wb") as out:
                    out.write(src.read())
                wanted.append(os.path.relpath(target, dest))
    if not wanted and nested:
        inner_name = decode_zip_name(nested[0].filename.split("/")[-1])
        inner_path = os.path.join(dest, inner_name)
        with zipfile.ZipFile(zip_path) as z, z.open(nested[0]) as src, open(inner_path, "wb") as out:
            out.write(src.read())
        print(f"[{year}] вложенный архив: {inner_name} ({os.path.getsize(inner_path)} байт)")
        result = extract(year, inner_path, capitals)
        os.remove(inner_path)
        return result
    if not wanted:
        raise RuntimeError(f"[{year}] в архиве не найден главный свод")
    print(f"[{year}] распаковано файлов: {len(wanted)}")
    return dest


def find_mains(root: str):
    mains = []
    for cur, _, files in os.walk(root):
        for f in files:
            if MAIN_RE.match(f):
                mains.append(os.path.join(cur, f))
    return mains


def find_capitals(root: str):
    out = []
    for cur, _, files in os.walk(root):
        for f in files:
            if CAPITAL_RE.match(f) and not CAPITAL_EXCLUDE_RE.search(f):
                out.append(os.path.join(cur, f))
    return out


# ---------------------------------------------------------------- чтение таблиц
class SheetWrap:
    def __init__(self, name, nrows, ncols, getter):
        self.name = name
        self.nrows = nrows
        self.ncols = ncols
        self._get = getter

    def cell(self, r, c):
        v = self._get(r, c)
        if v is None:
            return ""
        if isinstance(v, float) and v == int(v):
            return int(v)
        return v


def open_workbook(path):
    if path.lower().endswith(".xlsx"):
        import openpyxl
        wb = openpyxl.load_workbook(path, data_only=True)
        sheets = []
        for ws in wb.worksheets:
            sheets.append(SheetWrap(ws.title, ws.max_row, ws.max_column,
                                    lambda r, c, w=ws: w.cell(row=r + 1, column=c + 1).value))
        return sheets
    wb = xlrd.open_workbook(path)
    return [SheetWrap(sh.name, sh.nrows, sh.ncols, lambda r, c, s=sh: s.cell_value(r, c)) for sh in wb.sheets()]


def header_text(sh, col, maxr=15):
    parts = []
    for r in range(min(maxr, sh.nrows)):
        v = str(sh.cell(r, col)).replace("\n", " ").strip()
        if v and not re.match(r"^\d+([.,]\d+)?$", v):
            parts.append(v)
    return " ".join(parts)


def find_sheet(sheets, code, must=None):
    for sh in sheets:
        title = ""
        for r in range(min(12, sh.nrows)):
            for c in range(min(2, sh.ncols)):
                v = str(sh.cell(r, c)).replace("\n", " ").strip()
                if NUMBER_RE.search(v):
                    title = v
                    break
            if title:
                break
        if code in title:
            if must:
                probe_cols = range(min(sh.ncols, 20))
                if not any(must.lower() in header_text(sh, c).lower() for c in probe_cols):
                    continue
            return sh
    raise RuntimeError(f"не найден лист {code}")


def detect_col(sh, *needles):
    """индекс колонки, чей заголовок содержит все подстроки needles"""
    for c in range(sh.ncols):
        t = header_text(sh, c).lower()
        if all(n.lower() in t for n in needles):
            return c
    return None


def parse_sheet_rows(sh, code_col, val_col):
    """{level: {group: value}} по строкам-специальностям (сумма по группам УГСН).

    Секции «Программы бакалавриата / специалитета / магистратуры» задают уровень;
    любая другая секция «Программы …» (аспирантура, ординатура и т.п.) уровень сбрасывает.
    """
    data = {lv: {} for lv in LEVELS}
    level = None
    for r in range(sh.nrows):
        name = str(sh.cell(r, 0)).strip()
        if name.startswith("Программы"):
            level = None
            for lv, prefix in LEVELS.items():
                if name.startswith(prefix):
                    level = lv
                    break
            continue
        if level is None:
            continue
        code = str(sh.cell(r, code_col)).strip()
        if not CODE_RE.match(code):
            continue
        grp = code[:2]
        if grp not in GROUPS:
            continue
        v = sh.cell(r, val_col)
        v = float(v) if isinstance(v, (int, float)) else 0.0
        data[level][grp] = data[level].get(grp, 0.0) + v
    return data


def parse_year_file(path):
    """Разбор главного свода года → приём / 1 курс / 2 курс / выпуск.

    Архив 2020 не содержит листа 2.1.1 (форма не собирала приём) — admission=None.
    """
    sheets = open_workbook(path)
    result = {}

    # приём: 2.1.1, колонка «Принято … всего (сумма»
    try:
        sh = find_sheet(sheets, "2.1.1.", must="всего (сумма")
        code_col = detect_col(sh, "Код направ")
        val_col = detect_col(sh, "принято", "всего (сумма")
        if code_col is None or val_col is None:
            raise RuntimeError(f"2.1.1 — не найдены колонки (код={code_col}, значение={val_col})")
        result["admission"] = parse_sheet_rows(sh, code_col, val_col)
    except RuntimeError as e:
        print(f"  примечание: {os.path.basename(path)} — приём не разобран ({e})")
        result["admission"] = None
        sh = None

    # численность: 2.1.2, вариант с 1-м и 2-м курсом
    sh2 = find_sheet(sheets, "2.1.2.", must="Численность студентов 1 курса")
    code_col2 = detect_col(sh2, "Код направ")
    v1 = detect_col(sh2, "Численность студентов 1 курса", "всего")
    v2 = detect_col(sh2, "Численность студентов 2 курса", "всего")
    if code_col2 is None or v1 is None:
        raise RuntimeError(f"{path}: 2.1.2 — не найдены колонки (код={code_col2}, 1к={v1})")
    result["first_course"] = parse_sheet_rows(sh2, code_col2, v1)
    result["second_course"] = parse_sheet_rows(sh2, code_col2, v2) if v2 is not None else None

    # выпуск: 2.1.3
    sh3 = find_sheet(sheets, "2.1.3.", must="Выпуск фактический")
    code_col3 = detect_col(sh3, "Код направ")
    vg = detect_col(sh3, "выпуск фактический", "всего (сумма")
    if vg is None:
        vg = detect_col(sh3, "выпуск фактический", "всего")
    if code_col3 is None or vg is None:
        raise RuntimeError(f"{path}: 2.1.3 — не найдены колонки (код={code_col3}, выпуск={vg})")
    result["graduation"] = parse_sheet_rows(sh3, code_col3, vg)

    result["_meta"] = {
        "file": os.path.basename(path),
        "sheet_211": sh.name if sh else "",
        "sheet_212": sh2.name, "sheet_213": sh3.name,
        "cols_211": [code_col, val_col] if sh else [],
        "cols_212": [code_col2, v1, v2], "cols_213": [code_col3, vg],
    }
    return result


# ---------------------------------------------------------------- сборка воронки
def levels_groups(d):
    for lv in LEVELS:
        for grp in GROUPS:
            yield lv, grp


def build(years, capitals=False):
    parsed = {}
    for year in years:
        z = download(year)
        root = extract(year, z, capitals=capitals)
        mains = find_mains(root)
        if not mains:
            print(f"[{year}] главный свод не найден — пропуск")
            continue
        main = sorted(mains, key=lambda p: "ВСЕГО.xls" in p)[-1]
        print(f"[{year}] парсинг: {os.path.basename(main)}")
        parsed[year] = parse_year_file(main)
        with open(os.path.join(RAW, f"parse-{year}.json"), "w", encoding="utf-8") as f:
            json.dump(parsed[year], f, ensure_ascii=False, indent=1)

    # --- воронки когортного типа ---
    rows = []
    cohort_plan = [
        ("бакалавриат", 2020, "приём", 2024, "выпуск", "бакалавриат 4 года"),
        ("бакалавриат", 2021, "приём", 2025, "выпуск", "бакалавриат 4 года"),
        ("специалитет", 2020, "приём", 2025, "выпуск", "специалитет 5 лет"),
        ("магистратура", 2022, "приём", 2024, "выпуск", "магистратура 2 года"),
        ("магистратура", 2023, "приём", 2025, "выпуск", "магистратура 2 года"),
    ]
    for lv, byear, bkind, gyear, gkind, note in cohort_plan:
        if byear not in parsed or gyear not in parsed:
            continue
        bdata = parsed[byear]["admission"] if bkind == "приём" else parsed[byear]["first_course"]
        gdata = parsed[gyear]["graduation"]
        if bdata is None:
            continue
        for grp, gname in GROUPS.items():
            b = bdata.get(lv, {}).get(grp)
            g = gdata.get(lv, {}).get(grp)
            if b is None or g is None:
                continue
            rows.append({
                "series": "cohort", "level": lv, "group": gname,
                "base_year": byear, "base_kind": bkind, "base_value": round(b),
                "next_year": gyear, "next_kind": gkind, "next_value": round(g),
                "lost": round(b - g), "lost_pct": round((b - g) / b * 100, 1) if b else "",
                "note": note,
            })

    # --- переход 1→2 курс ---
    for lv in LEVELS:
        for byear in range(2020, 2025):
            gyear = byear + 1
            if byear not in parsed or gyear not in parsed:
                continue
            f = parsed[byear]["first_course"]
            s = parsed[gyear]["second_course"]
            if f is None or s is None:
                continue
            for grp, gname in GROUPS.items():
                b = f.get(lv, {}).get(grp)
                n = s.get(lv, {}).get(grp)
                if b is None or n is None:
                    continue
                rows.append({
                    "series": "transition_1_2", "level": lv, "group": gname,
                    "base_year": byear, "base_kind": "1 курс", "base_value": round(b),
                    "next_year": gyear, "next_kind": "2 курс", "next_value": round(n),
                    "lost": round(b - n), "lost_pct": round((b - n) / b * 100, 1) if b else "",
                    "note": "переход 1→2 курс (без поправки на переводы и восстановления)",
                })

    out = os.path.join(OUTDIR, "engineering-funnel.csv")
    with open(out, "w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=";")
        w.writeheader()
        w.writerows(rows)
    print(f"готово: {out} ({len(rows)} строк)")

    # --- столицы vs регионы (выпуск и приём) ---
    if capitals:
        for year in years:
            caps = find_capitals(os.path.join(RAW, f"vpo1-{year}"))
            if not caps:
                continue
            city_data = {}
            for p in caps:
                name = os.path.basename(p)
                city = "Москва" if "Москв" in name else "Санкт-Петербург"
                d = parse_year_file(p)
                agg = city_data.setdefault(city, {"admission": {}, "graduation": {}})
                for kind in ("admission", "graduation"):
                    src = d.get(kind) or {}
                    for lv in LEVELS:
                        for grp in GROUPS:
                            v = src.get(lv, {}).get(grp)
                            if v is not None:
                                agg[kind].setdefault(lv, {})
                                agg[kind][lv][grp] = agg[kind][lv].get(grp, 0.0) + v

            # Россия (главный свод) и «прочие регионы» = Россия − Москва − Санкт-Петербург
            ru = parsed.get(year, {})
            ru_adm = ru.get("admission") or {}
            ru_grad = ru.get("graduation") or {}
            others_adm, others_grad = {}, {}
            for lv in LEVELS:
                others_adm[lv], others_grad[lv] = {}, {}
                for grp in GROUPS:
                    ra = ru_adm.get(lv, {}).get(grp)
                    rg = ru_grad.get(lv, {}).get(grp)
                    ca = sum(city_data[c]["admission"].get(lv, {}).get(grp) or 0 for c in city_data)
                    cg = sum(city_data[c]["graduation"].get(lv, {}).get(grp) or 0 for c in city_data)
                    if ra is not None:
                        others_adm[lv][grp] = ra - ca
                    if rg is not None:
                        others_grad[lv][grp] = rg - cg

            combos = [("Россия", ru_adm, ru_grad)]
            for city in sorted(city_data):
                combos.append((city, city_data[city]["admission"], city_data[city]["graduation"]))
            combos.append(("Прочие регионы (Россия − Москва − СПб)", others_adm, others_grad))

            rows2 = []
            for city, adm, grad in combos:
                for lv in LEVELS:
                    for grp, gname in GROUPS.items():
                        a = adm.get(lv, {}).get(grp)
                        g = grad.get(lv, {}).get(grp)
                        rows2.append({"year": year, "city": city, "level": lv, "group": gname,
                                      "admission": round(a) if a is not None else "",
                                      "graduation": round(g) if g is not None else ""})
            out2 = os.path.join(OUTDIR, f"engineering-capitals-{year}.csv")
            if rows2:
                with open(out2, "w", encoding="utf-8-sig", newline="") as f:
                    w = csv.DictWriter(f, fieldnames=list(rows2[0].keys()), delimiter=";")
                    w.writeheader()
                    w.writerows(rows2)
                print(f"готово: {out2} ({len(rows2)} строк)")


# ---------------------------------------------------------------- разведка
def census(years):
    for year in years:
        z = download(year)
        root = extract(year, z)
        mains = find_mains(root)
        if not mains:
            print(f"[{year}] главный свод не найден")
            continue
        for main in sorted(mains):
            sheets = open_workbook(main)
            print(f"\n===== {year}: {os.path.basename(main)} | листов: {len(sheets)} =====")
            for sh in sheets:
                title = ""
                for r in range(min(12, sh.nrows)):
                    for c in range(min(2, sh.ncols)):
                        v = str(sh.cell(r, c)).replace("\n", " ").strip()
                        if NUMBER_RE.search(v):
                            title = v
                            break
                    if title:
                        break
                if re.search(r"2\.1\.[123]\.", title):
                    print(f"  {sh.name} | {sh.nrows}x{sh.ncols} | {title[:100]}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--census", action="store_true")
    ap.add_argument("--capitals", action="store_true", help="докачать и разобрать файлы Москвы/СПб")
    ap.add_argument("--years", default="2020,2021,2022,2023,2024,2025")
    args = ap.parse_args()
    years = [int(y) for y in args.years.split(",") if y.strip()]
    if args.census:
        census(years)
    else:
        build(years, capitals=args.capitals)


if __name__ == "__main__":
    main()
