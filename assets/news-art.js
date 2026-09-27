(() => {
  const svgNS = 'http://www.w3.org/2000/svg';
  const themes = [
    ['#171626', '#3c3452', '#d98266', '#f0c6a8'], ['#202332', '#39465c', '#d5a16e', '#f0d4ae'],
    ['#29202e', '#654454', '#e3947d', '#f4c7b1'], ['#202a3b', '#435872', '#c894a9', '#e5c9db'],
    ['#30241e', '#665044', '#d89a55', '#eed6a0'], ['#241c32', '#514267', '#cf8e9e', '#edc4cc'],
    ['#26242b', '#544953', '#dd9c73', '#efd0b1'], ['#1d2932', '#405564', '#d49b82', '#e9c8b1']
  ];
  let instance = 0;
  function themeFor(item) {
    const text = `${item?.title || ''} ${item?.category || ''} ${item?.summary || ''}`.toLocaleLowerCase('pt-BR');
    if (/chip|hardware|sil[ií]cio|semicondutor/.test(text)) return 1;
    if (/programa[cç][aã]o|github|software|c[oó]digo|desenvolvimento/.test(text)) return 2;
    if (/pesquisa|cient[ií]fic|research|laborat[oó]rio|infraestrutura|servidor|data center|nuvem|comput/.test(text)) return 3;
    if (/imagem|v[ií]deo|arte|criativ|gera[cç][aã]o/.test(text)) return 5;
    if (/pol[ií]tic|regula[cç][aã]o|seguran[cç]a|tribunal|lei /.test(text)) return 6;
    if (/agente|agent/.test(text)) return 7;
    if (/mercado|pre[cç]o|modelo|llm/.test(text)) return 4;
    const region = `${item?.region || ''}`.toLocaleLowerCase('pt-BR');
    if (region.includes('china')) return 1;
    if (region.includes('europa')) return 5;
    return [...String(item?.id || item?.title || 'ia')].reduce((sum, char) => sum + char.charCodeAt(0), 0) % themes.length;
  }
  function svgNode(name, attributes = {}) {
    const element = document.createElementNS(svgNS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  }
  window.createNewsFallback = function createNewsFallback(item, className = 'news-art-fallback') {
    const [dark, mid, accent, light] = themes[themeFor(item)];
    const id = `news-art-${++instance}`;
    const art = document.createElement('div');
    art.className = `${className} theme-${themeFor(item)}`;
    art.setAttribute('role', 'img');
    art.setAttribute('aria-label', `Ilustração editorial para a notícia: ${item?.title || 'inteligência artificial'}`);
    const svg = svgNode('svg', { class: 'news-art-fallback__graphic', viewBox: '0 0 1000 600', 'aria-hidden': 'true', focusable: 'false' });
    const defs = svgNode('defs');
    const bg = svgNode('linearGradient', { id: `${id}-bg`, x1: '0', y1: '0', x2: '1', y2: '1' });
    bg.append(svgNode('stop', { offset: '0%', 'stop-color': dark }), svgNode('stop', { offset: '100%', 'stop-color': mid }));
    const glow = svgNode('radialGradient', { id: `${id}-glow`, cx: '40%', cy: '30%', r: '75%' });
    glow.append(svgNode('stop', { offset: '0%', 'stop-color': light }), svgNode('stop', { offset: '52%', 'stop-color': accent }), svgNode('stop', { offset: '100%', 'stop-color': mid }));
    const dots = svgNode('pattern', { id: `${id}-dots`, width: '28', height: '28', patternUnits: 'userSpaceOnUse' });
    dots.append(svgNode('circle', { cx: '2', cy: '2', r: '1.2', fill: '#fff', opacity: '.36' }));
    defs.append(bg, glow, dots); svg.append(defs);
    svg.append(svgNode('rect', { width: '1000', height: '600', fill: `url(#${id}-bg)` }));
    svg.append(svgNode('path', { d: 'M0 480 C180 420 290 660 540 548 S830 390 1000 510 V600 H0Z', fill: dark, opacity: '.44' }));
    svg.append(svgNode('rect', { width: '1000', height: '600', fill: `url(#${id}-dots)`, opacity: '.2' }));
    svg.append(svgNode('circle', { cx: '660', cy: '292', r: '224', fill: 'none', stroke: light, 'stroke-width': '1', opacity: '.30' }));
    svg.append(svgNode('circle', { cx: '660', cy: '292', r: '188', fill: 'none', stroke: light, 'stroke-width': '1', opacity: '.19' }));
    svg.append(svgNode('ellipse', { cx: '660', cy: '292', rx: '258', ry: '102', transform: 'rotate(-27 660 292)', fill: 'none', stroke: light, 'stroke-width': '2', opacity: '.72' }));
    svg.append(svgNode('circle', { cx: '660', cy: '292', r: '137', fill: `url(#${id}-glow)` }));
    svg.append(svgNode('path', { d: 'M568 338 C618 256 700 213 762 228 C736 291 666 357 568 338Z', fill: light, opacity: '.25' }));
    svg.append(svgNode('circle', { cx: '458', cy: '405', r: '7', fill: light, opacity: '.9' }));
    svg.append(svgNode('circle', { cx: '875', cy: '170', r: '5', fill: light, opacity: '.8' }));
    svg.append(svgNode('circle', { cx: '808', cy: '435', r: '4', fill: accent, opacity: '.95' }));
    svg.append(svgNode('path', { d: 'M90 122 H250 M90 138 H190 M90 154 H220', stroke: light, 'stroke-width': '2', opacity: '.34' }));
    art.append(svg);
    const brand = document.createElement('span'); brand.className = 'news-art-fallback__brand'; brand.textContent = 'ESTADO DA ARTE  ·  INTELIGÊNCIA EM MOVIMENTO';
    const topic = document.createElement('span'); topic.className = 'news-art-fallback__topic'; topic.textContent = item?.category || 'INTELIGÊNCIA ARTIFICIAL';
    art.append(brand, topic);
    return art;
  };
})();
