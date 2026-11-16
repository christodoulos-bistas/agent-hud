// Pixel sprites for the HUD: the GR engine and the 12 class costumes, ported from the approved
// roster mockup (.superpowers/brainstorm/1378-1794812926/content/character-roster.html, lines 642-1174)
// plus the MOODS badge and zee sprites. DOM-free on purpose: Node imports spriteSvg for the app icon.
export const GR = (function () {
  // ---- shared materials: every class uses the same body, eyes, gold, wood, steel and parchment ----
  var PAL = {
    h: '#E8987C', o: '#D97757', O: '#B4593B',          // Claude's critter: highlight / base / shade
    k: '#1b120e',                                      // eye slits
    Y: '#f6dc9a', y: '#e0b45c', u: '#a77a35',          // gold & brass
    W: '#b47e4c', w: '#8a5a32', v: '#5b391e',          // wood & leather
    S: '#e4e9ed', s: '#a9b3bc', z: '#6c7782', Z: '#474f59', // steel
    P: '#fbf5e6', p: '#e8dbbd', q: '#b9a782',          // parchment & ivory
    '*': '#fffbea', '+': '#ffd877',                    // light (never outlined)
    ':': 'rgba(4,8,7,0.42)'                            // ground shadow
  };
  var LINE = '#140e0c';
  var GLOW = '*+';
  var SHADE = ':';

  function L(x, y, rows, cls) { return { x: x, y: y, rows: rows, cls: cls }; }

  // Copy a layer with single pixels changed: edits = [[x, y, ch], ...] in grid coordinates.
  function patch(layer, edits) {
    var rows = layer.rows.map(function (r) { return r.split(''); });
    edits.forEach(function (e) {
      var r = rows[e[1] - layer.y];
      if (r) { while (r.length <= e[0] - layer.x) r.push('.'); r[e[0] - layer.x] = e[2]; }
    });
    return L(layer.x, layer.y, rows.map(function (r) { return r.join(''); }));
  }

  var EYES = [[8, 14, 'k'], [8, 15, 'k'], [15, 14, 'k'], [15, 15, 'k']];
  var BODY = [patch(L(0, 12, [
    '.....hhhhhhhhhhhhho.....',
    '.....hooooooooooooO.....',
    '.....hooooooooooooO.....',
    '.....hooooooooooooO.....',
    '...oohooooooooooooOOO...',
    '.....hooooooooooooO.....',
    '.....hoooooooooooOO.....',
    '.....oOOOOOOOOOOOOO.....',
    '......O.O......O.O......',
    '......O.O......O.O......',
    '....::::::::::::::::....'
  ]), EYES)];

  function blank(w, h) { var g = []; for (var y = 0; y < h; y++) { g.push(new Array(w).fill(null)); } return g; }

  function stamp(grid, layer, dx, dy) {
    layer.rows.forEach(function (row, r) {
      for (var i = 0; i < row.length; i++) {
        var ch = row[i];
        if (ch === '.' || ch === ' ') continue;
        var X = layer.x + i + dx, Y = layer.y + r + dy;
        if (Y < 0 || Y >= grid.length || X < 0 || X >= grid[0].length) continue;
        grid[Y][X] = ch === '_' ? null : ch;
      }
    });
  }

  // Composite a group of layers, then wrap it in a 1-px outline.  Output canvas = art + 1px margin.
  function raster(layers, W, H, pal, glow, dx, dy) {
    var g = blank(W, H);
    layers.forEach(function (l) { stamp(g, l, dx, dy); });
    var OW = W + 2, OH = H + 2, out = blank(OW, OH), kind = blank(OW, OH);
    function solid(x, y) {
      if (y < 0 || y >= H || x < 0 || x >= W) return false;
      var c = g[y][x];
      return !!(c && pal[c] && glow.indexOf(c) < 0 && SHADE.indexOf(c) < 0);
    }
    for (var y = 0; y < OH; y++) for (var x = 0; x < OW; x++) {
      var ax = x - 1, ay = y - 1, c = (ay >= 0 && ay < H && ax >= 0 && ax < W) ? g[ay][ax] : null;
      if (c && pal[c]) { out[y][x] = pal[c]; kind[y][x] = glow.indexOf(c) >= 0 ? 'glow' : SHADE.indexOf(c) >= 0 ? 'shadow' : 'solid'; }
      if (!solid(ax, ay) && (solid(ax - 1, ay) || solid(ax + 1, ay) || solid(ax, ay - 1) || solid(ax, ay + 1))) {
        if (!c || SHADE.indexOf(c) >= 0) { out[y][x] = LINE; kind[y][x] = 'solid'; }
      }
    }
    return { w: OW, h: OH, px: out, kind: kind };
  }

  function rasterize(def) {
    var W = def.w || 24, H = def.h || 24;
    var pal = Object.assign({}, PAL, def.pal || {});
    var glow = GLOW + (def.glow || '');
    var dx = def.dx || 0, dy = def.dy || 0;
    var body = def.body || BODY;
    var main = (def.back || []).concat(def.noBody ? [] : body, def.front || []);
    var groups = [{ cls: 'base', r: raster(main, W, H, pal, glow, dx, dy) }];
    (def.fx || []).forEach(function (f) {
      groups.push({ cls: f.cls, r: raster(f.layers, W, H, pal, glow, dx + (f.dx || 0), dy + (f.dy || 0)) });
    });
    return { w: W + 2, h: H + 2, groups: groups };
  }

  // One <rect> per horizontal run of a single colour; shadows and glows get their own groups.
  function runs(r, want) {
    var s = '';
    for (var y = 0; y < r.h; y++) {
      var x = 0;
      while (x < r.w) {
        var c = r.px[y][x];
        if (!c || r.kind[y][x] !== want) { x++; continue; }
        var x0 = x;
        while (x < r.w && r.px[y][x] === c && r.kind[y][x] === want) x++;
        s += '<rect x="' + x0 + '" y="' + y + '" width="' + (x - x0) + '" height="1" fill="' + c + '"/>';
      }
    }
    return s;
  }

  // Shadow stays on the ground in its own group; everything else lives in .px-fig so it can bob.
  function svg(def, scale, cls) {
    var R = rasterize(def);
    var shadow = R.groups.map(function (g) { return runs(g.r, 'shadow'); }).join('');
    var fig = R.groups.map(function (g) {
      return '<g class="g-' + g.cls + '">' + runs(g.r, 'solid') + '<g class="px-glow">' + runs(g.r, 'glow') + '</g></g>';
    }).join('');
    return '<svg class="px ' + (cls || '') + '" viewBox="0 0 ' + R.w + ' ' + R.h + '" width="' + R.w * scale + '" height="' + R.h * scale +
      '" shape-rendering="crispEdges" aria-hidden="true" focusable="false">' +
      '<g class="px-shadow">' + shadow + '</g><g class="px-fig">' + fig + '</g></svg>';
  }

  return { PAL: PAL, L: L, patch: patch, BODY: BODY, EYES: EYES, rasterize: rasterize, svg: svg };
})();

const L = GR.L;

export const CLASSES = [];

// Ruler for the 24-px grid:  0123456789abcdefghijklmn   (a=10 ... n=23)
// Body: x 5-18, y 12-19 · arms y16 at x 3-4 / 19-20 · legs x 6,8,15,17 at y 20-21 · eyes x 8 & 15, y 14-15.
// Tones per material: 1 light · 2 base · 3 shade · 0 deepest.  Light comes from the top left.

CLASSES.push({
  id: 'pathfinder', name: 'Pathfinder',
  pal: { 1: '#a3c06c', 2: '#6f8f49', 3: '#4a6431', 0: '#2c3c22' },
  front: [
    L(0, 2, [
      '....................2...',
      '...................13...',
      '..................123...',
      '.................123....',
      '...............11223....',
      '.........111111222223...',
      '.......1122222222223....',
      '......122222222222223...',
      '.....1222222222222223...',
      '....12222222222222223...',
      '....1211111111111123....',
      '....1220000000000223....',
      '....12............23....',
      '...122............223...'
    ]),
    L(0, 16, [
      '.uu.',
      'uYyu',
      'y*+y',
      'y+*y',
      'uyyu'
    ])
  ]
});

CLASSES.push({
  id: 'star-reader', name: 'Star-Reader',
  pal: { 1: '#7d83d4', 2: '#4c519d', 3: '#33376f', 0: '#23254d' },
  front: [
    L(0, 0, [
      '...............23.......',
      '.............123........',
      '............123.........',
      '...........1223.........',
      '..........12Y23.........',
      '..........12223.........',
      '.........122223.........',
      '.........1222Y23........',
      '........12222223........',
      '........12Y222223.......',
      '.......Yyyyyyyyuu.......',
      '.....11111111111123.....',
      '....2333333333333330....',
      '......OOOOOOOOOOOO......'
    ]),
    L(0, 2, [
      '.Yyy.',
      'y...y',
      'y.*.y',
      'u...u',
      '.uyu.'
    ]),
    L(2, 7, ['w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'w', 'v'])
  ]
});

CLASSES.push({
  id: 'runesmith', name: 'Runesmith',
  pal: { 7: '#f8f1de', 8: '#e0cfa9', 9: '#a48f66' },
  front: [
    L(3, 5, ['7.', '78', '78', '78', '.78', '..8']),
    L(19, 5, ['.8', '78', '78', '78', '78.', '8..']),
    L(0, 8, [
      '.........SSsssz.........',
      '.......SSSssssszz.......',
      '......SSsssssssszz......',
      '.....SssssssssssszzZ....',
      '....zSzzzSzzzzSzzzSZ....',
      '...........sz...........',
      '...........sz...........'
    ]),
    L(7, 16, [
      'WWWWWWWWWW',
      'wwwwyywwwv',
      'wwwwwwwwwv',
      'vvvvvvvvvv'
    ]),
    L(20, 11, [
      'SSsz',
      's+sZ',
      's*sZ',
      'zzzZ',
      '.w..',
      '.w..',
      '.w..',
      '.w..',
      '.v..'
    ])
  ]
});

CLASSES.push({
  id: 'alchemist', name: 'Alchemist',
  pal: { 4: '#c9f4ea', 5: '#5fbfab', 6: '#2f7a6c', 7: '#d9fb9f', 8: '#86d86a', 9: '#3f9a4c', e: '#e2ffc4', r: '#e06a4f', R: '#9c3624' },
  glow: 'e',
  front: [
    L(5, 9, [
      '..yy....yy...',
      '.y45y..y45y..',
      '.y56yvvy56y..',
      'vvuuvvvvuuvv.'
    ]),
    L(0, 12, [
      '.w.',
      '.4.',
      '4rr',
      'rRR'
    ]),
    L(19, 7, [
      '..w..',
      '..4..',
      '..4..',
      '..5..',
      '.445.',
      '47889',
      '78889',
      '88899',
      '.899.'
    ])
  ],
  fx: [{ cls: 'bubbles', layers: [L(19, 1, ['..e..', '.....', '...e.', '.e...', '.....', '...e.'])] }]
});

CLASSES.push({
  id: 'hexbreaker', name: 'Hexbreaker', dx: 2,
  pal: { 1: '#7a6354', 2: '#4f3e34', 3: '#352a22', 0: '#241c17', 4: '#d36a4f', 5: '#b5442f', 6: '#7c2b1c', c: '#ff8a66' },
  glow: 'c',
  front: [
    L(0, 3, [
      '.........111112.........',
      '.........122223.........',
      '........12222223........',
      '........12222223........',
      '........12222223........',
      '........12222223........',
      '........45Yyyu56........',
      '........45y55u56........',
      '..11111111111111112223..',
      '...333333333333333330...',
      '......OOOOOOOOOOOO......'
    ]),
    // crossbow, held off-body (the whole figure sits 2px right to make room)
    L(-2, 13, [
      '..s..',
      '.sq..',
      's.q..',
      'Swwwv',
      's.q..',
      '.sq..',
      '..s..'
    ]),
    L(14, 17, ['c.', '.c'])
  ]
});

CLASSES.push({
  id: 'arbiter', name: 'Arbiter', dx: -2,
  pal: { 0: '#4a3f30' },
  front: [
    // Polish (spec §5): the peak is narrowed from a straight tent (2-4-6-8-12 px) to a slimmer
    // cowl (2-2-4-6-10 px); the shoulders, brim and gold ornament are unchanged.
    L(0, 5, [
      '...........PY...........',
      '...........Pq...........',
      '..........PYyq..........',
      '.........Pppppq.........',
      '.......PPpppppppq.......',
      '.....Pppppppppppppq.....',
      '....Ppppppppppppppqq....',
      '....Ppyyyyyyyyyyyyqq....',
      '....Pyu0000000000uyq....',
      '....Py............yq....'
    ]),
    L(17, 3, [
      '....Y....',
      '.yyyyyyy.',
      '.u..u..u.',
      '.u..u..u.',
      'yyy.u.yyy',
      '.u..u..u.',
      '....u....',
      '....u....',
      '....u....',
      '....u....',
      '....u....',
      '....u....',
      '....u....'
    ])
  ]
});

// Polish (spec §5): the Illuminator's comet-like streaks were the two brush strokes painted behind it
// in the roster's scene panel (CSS .sc-illuminator .gr-deco::before/::after), not pixels of this
// sprite. The HUD ports no scene panels, so they are dropped; the costume below is unchanged.
CLASSES.push({
  id: 'illuminator', name: 'Illuminator',
  pal: { 1: '#f19cb0', 2: '#c65d79', 3: '#8f3f58', a: '#e8b84f', b: '#6f92d6', c: '#8ec25a', d: '#ef6f86', e: '#fbf5e6' },
  front: [
    L(0, 8, [
      '............3...........',
      '........1111112.........',
      '.....11111111222222.....',
      '...11111111122222223....',
      '..12233333333333333.....',
      '..333...................'
    ]),
    L(0, 14, [
      '.WWW.',
      'WdWaW',
      'WbwcW',
      'wewwv',
      '.vv..'
    ]),
    L(20, 4, [
      '..YY',
      '..Yy',
      '..yu',
      '..ss',
      '..z.',
      '..w.',
      '..w.',
      '.w..',
      '.w..',
      '.w..',
      '.w..',
      '.w..',
      '.w..',
      '.w..',
      '.v..'
    ])
  ]
});

CLASSES.push({
  id: 'loremaster', name: 'Loremaster',
  // Polish (spec §5): the cap's three tones are lifted (was 1 #6d6a8f, 2 #433f60, 3 #2c2a43) so it
  // reads against the forest-night panel; same dusk-violet hue, same pixels.
  pal: { 1: '#a29ec8', 2: '#6c6896', 3: '#48456b', 4: '#a3473d', 5: '#73302a', 6: '#4c1d19', i: '#2a2238' },
  front: [
    L(0, 8, [
      '..........1112..........',
      '.......1111111222.......',
      '...1111111111Yy22222u3..',
      '.......2222222223....u..',
      '.....33333333333333..Y..',
      '......OOOOOOOOOOOO...y..'
    ]),
    L(20, 7, [
      '..P',
      '.PP',
      '.Pq',
      'Ppq',
      'Pq.',
      'Pq.',
      'q..',
      'u..',
      'i..'
    ])
  ],
  fx: [{ cls: 'tome', layers: [
    L(0, 2, [
      '.PPP.PPP.',
      'PqqqPqqqP',
      'PpppPpppP',
      'PqqpPqqpP',
      '444454555'
    ]),
    L(0, 0, ['..*......', '......+..'])
  ] }]
});

CLASSES.push({
  id: 'herald', name: 'Herald',
  pal: { 1: '#e07a5c', 2: '#b5442f', 3: '#7c2b1c' },
  front: [
    L(1, 2, [
      'PP......',
      'PPp.....',
      '.Ppq....',
      '.PPpq...',
      '..PPpq..',
      '...Ppqq.',
      '....Ppq.',
      '......q.'
    ]),
    L(0, 9, [
      '........1111122.........',
      '...12.1122222223........',
      '...1211222222222233.....',
      '....yyyyyyyyyyyyyyu.....',
      '......OOOOOOOOOOOO......'
    ]),
    L(19, 11, [
      '....Y',
      '...Yy',
      'Yyyyy',
      '...yu',
      '.122u',
      '.1y2.',
      '.122.',
      '.122.',
      '.2.3.'
    ])
  ]
});

CLASSES.push({
  id: 'cartographer', name: 'Cartographer',
  pal: { 1: '#8ea6c8', 2: '#4f6787', 3: '#364a63', 0: '#26354a', r: '#b5442f' },
  front: [
    L(0, 7, [
      '........12222223........',
      '...Y...1222222223..Y....',
      '...y222222222222222y....',
      '....y2222222222222yu....',
      '......yy33333333yy......',
      '........yy3333yy........',
      '..........yyyy..........'
    ]),
    L(0, 13, ['.q', 'Pp', 'Pp', 'rr', 'Pp', 'Pp', 'qq']),
    L(19, 11, [
      '.Yyu.',
      '*yyyz',
      '.yyu.',
      '..u..',
      '.w.w.',
      '.w.w.',
      'w.w.w',
      'w.w.w',
      'w.w.w',
      'v.v.v',
      'v.v.v'
    ])
  ]
});

CLASSES.push({
  id: 'vaultkeeper', name: 'Vaultkeeper',
  pal: { 1: '#56a29b', 2: '#2f7470', 3: '#1f4f4c', 0: '#163937', 4: '#a3adb3', 5: '#6b767e', 6: '#454d55' },
  front: [
    L(0, 8, [
      '.........111112.........',
      '.......1122222223.......',
      '......112222222223......',
      '.....11222222222233.....',
      '....1245454545454523....',
      '....1220000000000223....',
      '....12............23....',
      '...122............223...'
    ]),
    L(20, 12, [
      '.45.',
      '4..6',
      '4..6',
      '.56.',
      '.Y.Y',
      '.y.y',
      'uy.u',
      '.y..',
      'uy..'
    ]),
    L(0, 17, [
      '.WW.',
      'Wwwv',
      '5Y56',
      'wwwv',
      'vvvv'
    ])
  ]
});

CLASSES.push({
  id: 'summoner', name: 'Summoner',
  pal: { 1: '#a184da', 2: '#6a4cab', 3: '#45307a', 0: '#2a1d4d', e: '#f0dcff', c: '#a77cf5', C: '#e6d4ff' },
  glow: 'ecC',
  back: [
    L(0, 8, [
      '...1................3...',
      '...12..............23...',
      '...1200..........0023...',
      '....1200000000000023....'
    ]),
    L(0, 19, ['....cccccccccccccccc....'])
  ],
  front: [
    L(0, 10, [
      '...........ee...........',
      '..........yYyu..........',
      '....12yyyyyyyyyyyy23....',
      '....12............23....',
      '....12............23....',
      '....12............23....'
    ]),
    L(0, 20, [
      '..cc................cc..',
      '.c....................c.',
      '..cC................Cc..',
      '....ccCccccCCccccCcc....'
    ])
  ],
  fx: [
    { cls: 'fam-a', layers: [L(0, 2, ['.hhhhho.', '.hkookO.', 'oooooOOO', '..O..O..'])] },
    { cls: 'fam-b', layers: [L(16, 0, ['.hhhhho.', '.hkookO.', 'oooooOOO', '..O..O..'])] }
  ]
});

// ---- HUD mood marks. Badge and zee are copied from the roster's MOODS block (lines 1243-1252). ----
export const MOODS_BADGE = { w: 7, h: 7, noBody: true, front: [L(0, 0, [
  '..YYy..',
  '.YYkyy.',
  'YYykyyu',
  'Yyykyyu',
  'yyyyyyu',
  '.yykyu.',
  '..uuu..'
])] };
export const MOODS_ZEE = { w: 4, h: 4, noBody: true, front: [L(0, 0, ['PPPP', '..P.', '.P..', 'PPPP'])] };

// Done: the roster's done-mood pennant (green flag, ivory tick), cut down to a badge, with one sparkle.
export const MOODS_PENNANT = {
  w: 11, h: 9, noBody: true,
  pal: { 1: '#a3c06c', 2: '#6f8f49', 3: '#4a6431' },
  front: [L(0, 0, [
    '.Y......',
    '.w122222',
    '.w1222P2',
    '.w1P2P2.',
    '.w12P222',
    '.w233333',
    '.w......',
    '.w......',
    'ww......'
  ])],
  fx: [{ cls: 'tw', layers: [L(8, 0, ['.+.', '+*+', '.+.'])] }]
};

// A sub-agent familiar: the tiny critter from the layout mockup.
export const FAMILIAR = { w: 8, h: 4, noBody: true, front: [L(0, 0, ['.hhhhho.', '.hkookO.', 'oooooOOO', '..O..O..'])] };

const BY_ID = new Map(CLASSES.map((c) => [c.id, c]));

// The class sprite as an SVG string; an unknown id draws the Pathfinder (every session starts as one).
export function spriteSvg(classId, scale = 2) {
  return GR.svg(BY_ID.get(classId) || BY_ID.get('pathfinder'), scale);
}
