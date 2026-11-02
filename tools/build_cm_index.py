#!/usr/bin/env python3
"""Build the set-code -> Cardmarket product index used by the YGO Scanner.

Inputs (all public):
  * Cardmarket product catalog + price guide for Yu-Gi-Oh! (game id 3)
    https://downloads.s3.cardmarket.com/productCatalog/...
  * YGOPRODeck card database and set list (https://ygoprodeck.com/api-guide/)

Cardmarket's catalog has product ids, card names and expansion ids, but no expansion
names or card numbers. So each YGOPRODeck set is matched to the Cardmarket expansion
whose card list fits it best: highest share of the set's cards, then closest list
overlap, then closest release date.

Output: ygo-scanner/data/cm/<PREFIX>.json, one file per set-code prefix ("LOB", "MAGO", ...):
  { "LOB-EN001": [["Blue-Eyes White Dragon", "Legend of Blue Eyes White Dragon",
                   [[idProduct, low, trend], ...]]], ... }
More than one product means Cardmarket lists several versions of that card in the set.

Usage: python3 tools/build_cm_index.py [output_dir]
"""
import collections
import datetime as dt
import json
import os
import re
import shutil
import sys
import urllib.request

CM = 'https://downloads.s3.cardmarket.com/productCatalog/'
YGO = 'https://db.ygoprodeck.com/api/v7/'
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'ygo-scanner', 'data', 'cm')
PLACEHOLDER_DATE = '2007-01-01'  # Cardmarket's dateAdded for everything listed before 2007
MIN_CONTAINMENT = 0.6


def fetch(url):
    req = urllib.request.Request(url, headers={'User-Agent': 'ygo-scanner-index/1.0 (+https://zetsuu123.github.io/ygo-scanner/)'})
    with urllib.request.urlopen(req, timeout=300) as r:
        return json.load(r)


def norm(name):
    return re.sub(r'[^a-z0-9]', '', name.lower())


def days(a, b):
    return abs((dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days)


def main():
    print('downloading…', flush=True)
    products = fetch(CM + 'productList/products_singles_3.json')['products']
    prices = {p['idProduct']: p for p in fetch(CM + 'priceGuide/price_guide_3.json')['priceGuides']}
    cards = fetch(YGO + 'cardinfo.php')['data']
    sets = {s['set_name']: s for s in fetch(YGO + 'cardsets.php')}

    # Cardmarket side
    exp_names = collections.defaultdict(set)
    exp_start = {}
    name_exps = collections.defaultdict(set)
    prods = collections.defaultdict(list)
    for p in products:
        n, e = norm(p['name']), p['idExpansion']
        exp_names[e].add(n)
        name_exps[n].add(e)
        prods[(e, n)].append(p['idProduct'])
        d = (p.get('dateAdded') or PLACEHOLDER_DATE)[:10]
        exp_start[e] = min(exp_start.get(e, d), d)

    # YGOPRODeck side
    set_cards = collections.defaultdict(set)
    code_entries = collections.defaultdict(set)  # code -> {(card name, set name)}
    for c in cards:
        for s in c.get('card_sets') or []:
            set_cards[s['set_name']].add(norm(c['name']))
            code_entries[s['set_code'].upper()].add((c['name'], s['set_name']))

    # Match each YGOPRODeck set to a Cardmarket expansion
    set_exp = {}
    for set_name, names in set_cards.items():
        overlap = collections.Counter()
        for n in names:
            for e in name_exps.get(n, ()):
                overlap[e] += 1
        if not overlap:
            continue
        tcg = (sets.get(set_name) or {}).get('tcg_date') or PLACEHOLDER_DATE

        def score(e):
            contain = overlap[e] / len(names)
            jaccard = overlap[e] / len(names | exp_names[e])
            start = exp_start[e]
            if start == PLACEHOLDER_DATE and tcg <= PLACEHOLDER_DATE:
                gap = 0
            else:
                gap = days(start, max(tcg, PLACEHOLDER_DATE) if start == PLACEHOLDER_DATE else tcg)
            return (round(contain, 2), round(jaccard, 2), -gap)

        best = max(overlap, key=score)
        if score(best)[0] >= MIN_CONTAINMENT:
            set_exp[set_name] = best

    # Build per-prefix shards
    def price(pid):
        g = prices.get(pid) or {}
        return [pid, g.get('low'), g.get('trend')]

    shards = collections.defaultdict(dict)
    stats = collections.Counter()
    for code, entries in code_entries.items():
        out = []
        for card_name, set_name in sorted(entries):
            e = set_exp.get(set_name)
            ids = sorted(prods.get((e, norm(card_name)), [])) if e is not None else []
            if ids:
                out.append([card_name, set_name, [price(i) for i in ids]])
        if not out:
            stats['unmatched'] += 1
            continue
        stats['exact' if all(len(x[2]) == 1 for x in out) else 'versions'] += 1
        prefix = code.split('-')[0]
        if re.fullmatch(r'[A-Z0-9]{1,8}', prefix):
            shards[prefix][code] = out

    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    for prefix, data in shards.items():
        with open(os.path.join(OUT, prefix + '.json'), 'w') as f:
            json.dump(dict(sorted(data.items())), f, separators=(',', ':'), ensure_ascii=False)
    with open(os.path.join(OUT, 'meta.json'), 'w') as f:
        json.dump({'codes': sum(len(s) for s in shards.values()), 'files': len(shards), **stats}, f)
    print(f'{len(code_entries)} set codes: {dict(stats)}; {len(shards)} files -> {OUT}')


if __name__ == '__main__':
    main()
