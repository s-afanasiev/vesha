"""1.2-C: рыночные прокси — зарплаты по профессиональным группам и вакансии hh.ru.

Запуск из корня репозитория:
    python docs/economic-strength/data/1.2-C/market-proxies.py

Выходы:
  - rosstat-wages-groups.csv — средняя зарплата по профессиональным группам,
    2015/2017/2019/2021/2023/2025 + рост 2021→2025;
  - hh-vacancies-2026.csv — снимок вакансий hh.ru по 5 профессиям (2026-10-19)
    и отношение вакансий к годовому выпуску СПО.

Источники: Росстат, «Средняя начисленная заработная плата работников по
профессиональным группам» (sr-zpl6_2025.xlsx); hh.ru, поиск вакансий по России.
"""
from __future__ import annotations

import csv
import os
import re
import ssl
import sys
import urllib.parse
import urllib.request

import openpyxl

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..', '..'))
RAW = os.path.join(ROOT, 'data', 'economic-strength', '1.2-C', 'raw', 'rosstat')
OUT = os.path.dirname(os.path.abspath(__file__))
WAGE_FILE = os.path.join(RAW, 'sr-zpl6_2025.xlsx')
WAGE_URL = 'https://rosstat.gov.ru/storage/mediabank/sr-zpl6_2025.xlsx'
CTX = ssl._create_unverified_context()

QUERIES = [
    ('Наладчик станков с ЧПУ', 'наладчик станков с ЧПУ'),
    ('Сварщик', 'сварщик'),
    ('Электромонтажник', 'электромонтажник'),
    ('Слесарь-ремонтник', 'слесарь-ремонтник'),
    ('Оператор линии', 'оператор линии'),
]

def download_wages() -> None:
    os.makedirs(RAW, exist_ok=True)
    if os.path.exists(WAGE_FILE):
        return
    req = urllib.request.Request(WAGE_URL, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=120, context=CTX) as r, open(WAGE_FILE, 'wb') as f:
        f.write(r.read())

def wages() -> None:
    wb = openpyxl.load_workbook(WAGE_FILE, data_only=True)
    ws = wb.worksheets[1]
    rows = []
    for r in ws.iter_rows(min_row=1, values_only=True):
        name = str(r[0]).strip() if r[0] else ''
        if not name or name.startswith('Средняя') or name.startswith('(по результатам'):
            continue
        if len(r) < 7 or not isinstance(r[4], (int, float)) or not isinstance(r[6], (int, float)):
            continue
        y2021, y2023, y2025 = float(r[4]), float(r[5]) if isinstance(r[5], (int, float)) else None, float(r[6])
        rows.append({
            'группа': name,
            '2021': int(y2021),
            '2023': int(y2023) if y2023 else '',
            '2025': int(y2025),
            'рост_2021_2025_%': round(100 * (y2025 / y2021 - 1), 1),
        })
    with open(os.path.join(OUT, 'rosstat-wages-groups.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=';')
        w.writeheader()
        w.writerows(rows)
    print('\nЗарплаты по профессиональным группам, руб./мес (октябрь):')
    for r in rows:
        print(f"  {r['группа'][:62]:62s} | 2021 {r['2021']:>7,d} | 2025 {r['2025']:>7,d} | {r['рост_2021_2025_%']:>5.1f}%")

def hh() -> None:
    counts = {}
    for label, q in QUERIES:
        url = 'https://hh.ru/search/vacancy?' + urllib.parse.urlencode({'text': q, 'area': 113, 'search_field': 'name'})
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})
        try:
            d = urllib.request.urlopen(req, timeout=60, context=CTX).read().decode('utf-8', 'ignore')
            m = re.search(r'([\d\s\u00a0]+)\s+ваканс', d)
            count = int(re.sub(r'\D', '', m.group(1))) if m else None
        except Exception as e:
            print(f'  {label}: ошибка hh.ru — {e}')
            count = None
        counts[label] = count

    # выпуск из spo1-five-professions-2024.csv
    grad = {}
    path = os.path.join(OUT, 'spo1-five-professions-2021-2024.csv')
    if os.path.exists(path):
        with open(path, encoding='utf-8-sig') as f:
            for row in csv.DictReader(f, delimiter=';'):
                grad[row['профессия']] = int(row['выпуск_2023_24'])

    rows = []
    for label, q in QUERIES:
        c = counts.get(label)
        g = grad.get(label)
        rows.append({
            'профессия': label,
            'запрос_hh': q,
            'вакансий_2026_10_19': c if c is not None else '',
            'выпуск_спо_2023_24': g if g is not None else '',
            'вакансий_на_выпускника': round(c / g, 1) if c and g else '',
        })
    with open(os.path.join(OUT, 'hh-vacancies-2026.csv'), 'w', encoding='utf-8-sig', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()), delimiter=';')
        w.writeheader()
        w.writerows(rows)
    print('\nВакансии hh.ru (Россия, поиск по названию, 2026-10-19):')
    for r in rows:
        print(f"  {r['профессия']:24s} | {r['вакансий_2026_10_19']:>7} | выпуск {r['выпуск_спо_2023_24']:>6} | на выпускника {r['вакансий_на_выпускника']}")

def main() -> None:
    sys.stdout.reconfigure(encoding='utf-8')
    download_wages()
    wages()
    hh()
    print('\nCSV: rosstat-wages-groups.csv, hh-vacancies-2026.csv')

if __name__ == '__main__':
    main()
