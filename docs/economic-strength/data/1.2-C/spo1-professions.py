"""1.2-C: разбор СПО-1 (2021/22 и 2024/25) по пяти рабочим профессиям.

Запуск из корня репозитория:
    python docs/economic-strength/data/1.2-C/spo1-professions.py

Скачивает архивы СПО-1 с docs.edu.gov.ru (если их нет в raw), распаковывает
главные своды СВОД_СПО1_ВСЕГО.xls и собирает:
  - spo1-five-professions-2021-2024.csv — приём/выпуск по 5 профессиям, 2021 vs 2024;
  - spo1-totals-2021-2024.csv — итоги по программам специалистов и рабочих.

Источник: Минпросвещения России, форма № СПО-1 на начало 2021/22 и 2024/25 уч. годов.
"""
from __future__ import annotations

import csv
import os
import sys
import urllib.request
import zipfile

import xlrd

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
RAW = os.path.join(ROOT, 'data', 'economic-strength', '1.2-C', 'raw')
OUT = os.path.dirname(os.path.abspath(__file__))

SOURCES = {
    2021: {
        'url': 'https://docs.edu.gov.ru/document/018f742a9e7aadf586319ff435a4c8ec/download/4445/',
        'archive': os.path.join(RAW, 'SPO-1_2021-22.bin'),
        'main': os.path.join(RAW, 'spo1-2021', 'main', 'СВОД_СПО1_ВСЕГО.xls'),
    },
    2024: {
        'url': 'https://docs.edu.gov.ru/document/2488e3f241e60f3324d5d170f732deb3/download/7126/',
        'archive': os.path.join(RAW, 'SPO-1_2024-25.bin'),
        'main': os.path.join(RAW, 'spo1-2024', 'main', 'СВОД_СПО1_ВСЕГО.xls'),
    },
}

# Профессия плана -> коды перечня СПО. Часть кодов заменена в 2022 г.,
# поэтому агрегируем все действующие варианты и фиксируем это в оговорках.
PROFESSIONS = [
    ('Наладчик станков с ЧПУ', ['15.01.23', '15.01.38']),
    ('Сварщик', ['15.01.05']),
    ('Электромонтажник', ['08.01.18', '08.01.31']),
    ('Слесарь-ремонтник', ['15.01.35']),
    ('Оператор линии', ['15.01.32', '35.01.04']),
]

def download(year: int) -> None:
    src = SOURCES[year]
    os.makedirs(RAW, exist_ok=True)
    if os.path.exists(src['archive']):
        return
    req = urllib.request.Request(src['url'], headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=300) as r, open(src['archive'], 'wb') as f:
        f.write(r.read())
    print(f'{year}: скачан архив {os.path.getsize(src["archive"]):,} байт')

def extract_main(year: int) -> None:
    src = SOURCES[year]
    if os.path.exists(src['main']):
        return
    os.makedirs(os.path.dirname(src['main']), exist_ok=True)
    with zipfile.ZipFile(src['archive']) as z:
        for name in z.namelist():
            raw = name
            if all(ord(ch) < 256 for ch in name):
                try:
                    raw = name.encode('cp437').decode('cp866')
                except Exception:
                    pass
            if raw == 'СВОД_СПО1_ВСЕГО.xls':
                with z.open(name) as fsrc, open(src['main'], 'wb') as fdst:
                    fdst.write(fsrc.read())
                return
    raise RuntimeError(f'{year}: в архиве нет СВОД_СПО1_ВСЕГО.xls')

def section_rows(sh, col):
    out = []
    for i in range(11, sh.nrows):
        name = str(sh.cell_value(i, 0)).strip()
        if name.lower().startswith('программы подготовки') and 'всего' in name.lower():
            out.append((name, sh.cell_value(i, col)))
    return out

def sum_codes(sh, codes, col):
    total = demo = gia = target = 0.0
    for i in range(11, sh.nrows):
        if str(sh.cell_value(i, 2)).strip() not in codes:
            continue
        try:
            total += float(sh.cell_value(i, col))
        except Exception:
            pass
        if sh.ncols > 17:
            for idx, acc in ((15, 'demo'), (16, 'gia'), (17, 'target')):
                try:
                    v = float(sh.cell_value(i, idx))
                except Exception:
                    v = 0.0
                if acc == 'demo':
                    demo += v
                elif acc == 'gia':
                    gia += v
                else:
                    target += v
    return total, demo, gia, target

def parse_year(year: int):
    download(year)
    extract_main(year)
    wb = xlrd.open_workbook(SOURCES[year]['main'])
    adm = wb.sheet_by_name('Р2_1_1')
    grad = wb.sheet_by_name('Р2_1_3(1)')
    totals = []
    for label, sh, col in (('приём', adm, 5), ('выпуск', grad, 3)):
        for name, val in section_rows(sh, col):
            totals.append((label, name, val))
    profs = {}
    for label, codes in PROFESSIONS:
        a, *_ = sum_codes(adm, codes, 5)
        g, demo, gia, target = sum_codes(grad, codes, 3)
        profs[label] = {'приём': a, 'выпуск': g, 'демо': demo, 'гиа': gia, 'целевой': target}
    return totals, profs

def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    data = {year: parse_year(year) for year in (2021, 2024)}

    # итоги
    rows = []
    for year in (2021, 2024):
        for label, name, val in data[year][0]:
            rows.append({'год': year, 'показатель': label, 'раздел': name, 'чел.': int(val)})
    with open(os.path.join(OUT, 'spo1-totals-2021-2024.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=['год', 'показатель', 'раздел', 'чел.'], delimiter=';')
        w.writeheader()
        w.writerows(rows)

    # пять профессий: 2021 vs 2024
    rows = []
    for label, codes in PROFESSIONS:
        a21, a24 = data[2021][1][label]['приём'], data[2024][1][label]['приём']
        g21, g24 = data[2021][1][label]['выпуск'], data[2024][1][label]['выпуск']
        g24d = data[2024][1][label]
        rows.append({
            'профессия': label,
            'коды': ', '.join(codes),
            'приём_2021': int(a21),
            'выпуск_2020_21': int(g21),
            'приём_2024': int(a24),
            'выпуск_2023_24': int(g24),
            'Δприём_%': round(100 * (a24 / a21 - 1), 1) if a21 else '',
            'Δвыпуск_%': round(100 * (g24 / g21 - 1), 1) if g21 else '',
            'гиа_демо_2024_%': round(100 * g24d['гиа'] / g24, 1) if g24 else 0.0,
            'целевые_2024_%': round(100 * g24d['целевой'] / g24, 1) if g24 else 0.0,
        })
    with open(os.path.join(OUT, 'spo1-five-professions-2021-2024.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=';')
        w.writeheader()
        w.writerows(rows)

    print('\nИтоги СПО-1 (приём / выпуск фактический):')
    for year in (2021, 2024):
        print(f'  {year}:')
        for label, name, val in data[year][0]:
            if 'Всего по программам' in name:
                print(f'    {label:7s} | {name[:74]:74s} | {int(val):>9,d}')
    print('\nПять профессий, 2021 → 2024:')
    for r in rows:
        print(f"  {r['профессия']:24s} | приём {r['приём_2021']:>6,d} → {r['приём_2024']:>6,d} ({r['Δприём_%']:>+6.1f}%) "
              f"| выпуск {r['выпуск_2020_21']:>6,d} → {r['выпуск_2023_24']:>6,d} ({r['Δвыпуск_%']:>+6.1f}%) "
              f"| ГИА-демо {r['гиа_демо_2024_%']:>4.1f}%")
    print('\nCSV: spo1-totals-2021-2024.csv, spo1-five-professions-2021-2024.csv')

if __name__ == '__main__':
    main()
