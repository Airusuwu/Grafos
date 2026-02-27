const EPSILON = 'ε';
const EMPTY = '∅';

const ui = {
  alphabetInput: document.getElementById('alphabetInput'),
  addStateBtn: document.getElementById('addStateBtn'),
  deleteSelectedBtn: document.getElementById('deleteSelectedBtn'),
  sourceSelect: document.getElementById('sourceSelect'),
  targetSelect: document.getElementById('targetSelect'),
  labelInput: document.getElementById('labelInput'),
  addTransitionBtn: document.getElementById('addTransitionBtn'),
  exportBtn: document.getElementById('exportBtn'),
  importInput: document.getElementById('importInput'),
  runArdenBtn: document.getElementById('runArdenBtn'),
  regexOutput: document.getElementById('regexOutput'),
  copyRegexBtn: document.getElementById('copyRegexBtn'),
  processLog: document.getElementById('processLog')
};

const cy = cytoscape({
  container: document.getElementById('cy'),
  elements: [],
  style: [
    {
      selector: 'node',
      style: {
        'background-color': '#2f72ff',
        label: 'data(label)',
        color: '#fff',
        'text-valign': 'center',
        'text-halign': 'center',
        'font-weight': 600,
        width: 50,
        height: 50,
        'border-color': '#1f4fd2',
        'border-width': 2
      }
    },
    {
      selector: 'node[final = "true"]',
      style: {
        'border-width': 6,
        'border-color': '#0fba81'
      }
    },
    {
      selector: 'node[initial = "true"]',
      style: {
        'background-color': '#ff8a00'
      }
    },
    {
      selector: 'edge',
      style: {
        width: 2,
        'line-color': '#4f6580',
        'target-arrow-color': '#4f6580',
        'target-arrow-shape': 'triangle',
        'curve-style': 'bezier',
        label: 'data(label)',
        'font-size': 12,
        'text-background-color': '#fff',
        'text-background-opacity': 1,
        'text-background-padding': '2px'
      }
    }
  ]
});

let stateCounter = 0;

function addState(id = null, position = null, initial = false, final = false) {
  const stateId = id ?? `q${stateCounter++}`;
  const exists = cy.getElementById(stateId).length > 0;
  if (exists) return;

  cy.add({
    group: 'nodes',
    data: { id: stateId, label: stateId, initial: String(initial), final: String(final) },
    position: position ?? { x: 120 + Math.random() * 320, y: 120 + Math.random() * 220 }
  });
  if (id?.startsWith('q')) {
    const n = Number(id.replace('q', ''));
    if (!Number.isNaN(n)) stateCounter = Math.max(stateCounter, n + 1);
  }
  refreshStateSelectors();
}

function refreshStateSelectors() {
  const nodes = cy.nodes().map(n => n.id());
  [ui.sourceSelect, ui.targetSelect].forEach(select => {
    const current = select.value;
    select.innerHTML = '';
    nodes.forEach(id => {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = id;
      select.appendChild(option);
    });
    if (nodes.includes(current)) select.value = current;
  });
}

function upsertEdge(source, target, label) {
  const edgeId = `${source}->${target}`;
  const edge = cy.getElementById(edgeId);
  const cleaned = normalizeLabelList(label).join(',');
  if (!cleaned) return;

  if (edge.length > 0) {
    const oldLabels = normalizeLabelList(edge.data('label'));
    const merged = [...new Set([...oldLabels, ...normalizeLabelList(label)])];
    edge.data('label', merged.join(','));
    return;
  }

  cy.add({
    group: 'edges',
    data: { id: edgeId, source, target, label: cleaned }
  });
}

function normalizeLabelList(raw) {
  return [...new Set(String(raw || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => (s === 'e' ? EPSILON : s)))];
}

function getInitialState() {
  return cy.nodes().filter(n => n.data('initial') === 'true')[0]?.id() ?? null;
}

function getFinalStates() {
  return new Set(cy.nodes().filter(n => n.data('final') === 'true').map(n => n.id()));
}

function parseAlphabet() {
  return [...new Set(ui.alphabetInput.value.split(',').map(s => s.trim()).filter(Boolean))];
}

function buildUnitTransitions() {
  const transitions = [];
  cy.edges().forEach(edge => {
    const labels = normalizeLabelList(edge.data('label'));
    labels.forEach(symbol => {
      transitions.push({ from: edge.source().id(), to: edge.target().id(), symbol });
    });
  });
  return transitions;
}

function adjacencyFromUnitTransitions(states, unitTransitions) {
  const adj = {};
  states.forEach(q => { adj[q] = {}; });
  unitTransitions.forEach(({ from, to, symbol }) => {
    if (!adj[from][symbol]) adj[from][symbol] = new Set();
    adj[from][symbol].add(to);
  });
  return adj;
}

function epsilonClosure(state, adj) {
  const stack = [state];
  const seen = new Set([state]);
  while (stack.length) {
    const cur = stack.pop();
    const next = adj[cur]?.[EPSILON] ?? new Set();
    next.forEach(v => {
      if (!seen.has(v)) {
        seen.add(v);
        stack.push(v);
      }
    });
  }
  return seen;
}

function unionExpr(...parts) {
  const flat = parts.flatMap(p => String(p || '').split('|').map(x => x.trim())).filter(Boolean);
  const filtered = flat.filter(x => x !== EMPTY);
  const uniq = [...new Set(filtered)];
  if (!uniq.length) return EMPTY;
  if (uniq.length === 1) return uniq[0];
  return uniq.join('|');
}

function needsParen(expr) {
  return expr.includes('|') && !(expr.startsWith('(') && expr.endsWith(')'));
}

function concatExpr(a, b) {
  if (a === EMPTY || b === EMPTY) return EMPTY;
  if (a === EPSILON) return b;
  if (b === EPSILON) return a;
  const aa = needsParen(a) ? `(${a})` : a;
  const bb = needsParen(b) ? `(${b})` : b;
  return `${aa}${bb}`;
}

function starExpr(a) {
  if (a === EMPTY || a === EPSILON) return EPSILON;
  if (a.endsWith('*')) return a;
  return needsParen(a) ? `(${a})*` : `${a}*`;
}

function equationToString(name, eq) {
  const terms = Object.entries(eq.terms).map(([v, c]) => `${c}${v}`);
  const rhs = unionExpr(eq.const, ...terms);
  return `${name} = ${rhs}`;
}

function runArden() {
  const states = cy.nodes().map(n => n.id());
  const initial = getInitialState();
  const finals = getFinalStates();
  const alphabet = parseAlphabet();
  const unitTransitions = buildUnitTransitions();

  if (!states.length) throw new Error('Debes crear al menos un estado.');
  if (!initial) throw new Error('Debes marcar exactamente un estado inicial (doble click).');
  if (!finals.size) throw new Error('Debes marcar al menos un estado final (click).');

  const log = [];
  log.push('=== 1) PREPROCESAMIENTO AFN-ε -> AFN SIN ε ===');
  log.push(`Estados: ${states.join(', ')}`);
  log.push(`Alfabeto: ${alphabet.join(', ') || '(vacío)'}`);

  const adj = adjacencyFromUnitTransitions(states, unitTransitions);
  const closures = {};
  states.forEach(q => {
    closures[q] = epsilonClosure(q, adj);
    log.push(`ε-closure(${q}) = {${[...closures[q]].join(', ')}}`);
  });

  const newFinals = new Set();
  states.forEach(q => {
    if ([...closures[q]].some(x => finals.has(x))) newFinals.add(q);
  });
  log.push(`Finales originales: {${[...finals].join(', ')}}`);
  log.push(`Finales tras ε-closure: {${[...newFinals].join(', ')}}`);

  const noEpsTransitions = [];
  states.forEach(q => {
    alphabet.forEach(sym => {
      const reached = new Set();
      closures[q].forEach(p => {
        (adj[p]?.[sym] ?? new Set()).forEach(t => {
          closures[t].forEach(c => reached.add(c));
        });
      });
      reached.forEach(r => noEpsTransitions.push({ from: q, to: r, symbol: sym }));
      if (reached.size) log.push(`δ'(${q}, ${sym}) = {${[...reached].join(', ')}}`);
    });
  });

  log.push('\n=== 2) SISTEMA DE ECUACIONES REGULARES ===');
  const eqs = {};
  states.forEach(q => {
    eqs[q] = { const: newFinals.has(q) ? EPSILON : EMPTY, terms: {} };
  });

  noEpsTransitions.forEach(({ from, to, symbol }) => {
    eqs[from].terms[to] = eqs[from].terms[to]
      ? unionExpr(eqs[from].terms[to], symbol)
      : symbol;
  });

  states.forEach(q => log.push(equationToString(q, eqs[q])));

  log.push('\n=== 3) RESOLUCIÓN CON LEMA DE ARDEN ===');
  for (let k = states.length - 1; k >= 0; k--) {
    const xk = states[k];
    const eqK = eqs[xk];
    const selfCoeff = eqK.terms[xk] ?? EMPTY;

    if (selfCoeff !== EMPTY) {
      const factor = starExpr(selfCoeff);
      eqK.const = concatExpr(factor, eqK.const);
      Object.keys(eqK.terms).forEach(v => {
        if (v !== xk) eqK.terms[v] = concatExpr(factor, eqK.terms[v]);
      });
      delete eqK.terms[xk];
      log.push(`Arden en ${xk}: ${xk} = ${selfCoeff}${xk} ∪ B  =>  ${xk} = ${factor}B`);
      log.push(`  ${equationToString(xk, eqK)}`);
    }

    for (let i = 0; i < k; i++) {
      const xi = states[i];
      const coeff = eqs[xi].terms[xk];
      if (!coeff) continue;

      eqs[xi].const = unionExpr(eqs[xi].const, concatExpr(coeff, eqK.const));
      Object.entries(eqK.terms).forEach(([v, c]) => {
        const prod = concatExpr(coeff, c);
        eqs[xi].terms[v] = eqs[xi].terms[v] ? unionExpr(eqs[xi].terms[v], prod) : prod;
      });
      delete eqs[xi].terms[xk];
      log.push(`Sustitución de ${xk} en ${xi} con coeficiente ${coeff}:`);
      log.push(`  ${equationToString(xi, eqs[xi])}`);
    }
  }

  const finalRegex = eqs[initial].const;
  log.push('\n=== 4) RESULTADO ===');
  log.push(`Regex(${initial}) = ${finalRegex}`);

  return { finalRegex, log: log.join('\n') };
}

function exportJson() {
  const data = {
    alphabet: parseAlphabet(),
    nodes: cy.nodes().map(n => ({
      id: n.id(),
      position: n.position(),
      initial: n.data('initial') === 'true',
      final: n.data('final') === 'true'
    })),
    edges: cy.edges().map(e => ({
      source: e.source().id(),
      target: e.target().id(),
      label: e.data('label')
    }))
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'automata-afne.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

function importJson(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const parsed = JSON.parse(reader.result);
    cy.elements().remove();
    ui.alphabetInput.value = (parsed.alphabet || []).join(',');

    (parsed.nodes || []).forEach(n => addState(n.id, n.position, n.initial, n.final));
    (parsed.edges || []).forEach(e => upsertEdge(e.source, e.target, e.label));
    cy.layout({ name: 'preset' }).run();
    refreshStateSelectors();
  };
  reader.readAsText(file);
}

ui.addStateBtn.addEventListener('click', () => addState());
ui.deleteSelectedBtn.addEventListener('click', () => {
  cy.$(':selected').remove();
  refreshStateSelectors();
});
ui.addTransitionBtn.addEventListener('click', () => {
  upsertEdge(ui.sourceSelect.value, ui.targetSelect.value, ui.labelInput.value);
  ui.labelInput.value = '';
});
ui.exportBtn.addEventListener('click', exportJson);
ui.importInput.addEventListener('change', e => {
  const file = e.target.files[0];
  if (file) importJson(file);
});
ui.runArdenBtn.addEventListener('click', () => {
  try {
    const { finalRegex, log } = runArden();
    ui.regexOutput.textContent = finalRegex;
    ui.processLog.textContent = log;
  } catch (err) {
    ui.processLog.textContent = `Error: ${err.message}`;
  }
});
ui.copyRegexBtn.addEventListener('click', async () => {
  const text = ui.regexOutput.textContent;
  await navigator.clipboard.writeText(text);
  ui.copyRegexBtn.textContent = 'Copiado';
  setTimeout(() => (ui.copyRegexBtn.textContent = 'Copiar'), 1200);
});

cy.on('tap', 'node', evt => {
  const node = evt.target;
  node.data('final', node.data('final') === 'true' ? 'false' : 'true');
});

cy.on('dbltap', 'node', evt => {
  cy.nodes().forEach(n => n.data('initial', 'false'));
  evt.target.data('initial', 'true');
});

// Estado inicial de demostración
addState('q0', { x: 180, y: 200 }, true, false);
addState('q1', { x: 420, y: 200 }, false, true);
upsertEdge('q0', 'q1', `a,${EPSILON}`);
upsertEdge('q1', 'q1', 'b');
ui.alphabetInput.value = 'a,b';
